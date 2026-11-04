/* ECB receipt extraction: no paid API and no upload to an OCR server.
 * Tesseract runs locally in a browser Web Worker; PDFs parsed/rendered locally.
 * All extracted fields MUST be reviewed and confirmed before cloud saving.
 */
(function () {
  'use strict';
  let scanSerial = 0;
  let scriptPromises = Object.create(null);
  const MAX_ITEMS = 40;
  const MAX_PDF_PAGES = 3;

  function el(id) { return document.getElementById(id); }
  function show(message, error) {
    const node = el('receipt-ocr-status');
    if (!node) return;
    node.className = 'p-2.5 rounded-xl border text-[11px] ' +
      (error ? 'bg-rose-50 border-rose-200 text-rose-800' :
        'bg-emerald-50 border-emerald-200 text-emerald-900');
    node.textContent = message;
  }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[ch]);
  }
  function loadScript(url, globalName) {
    if (window[globalName]) return Promise.resolve(window[globalName]);
    if (!scriptPromises[url]) {
      scriptPromises[url] = new Promise((resolve,reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => window[globalName]
          ? resolve(window[globalName])
          : reject(new Error('Die OCR-Bibliothek wurde nicht geladen.'));
        script.onerror = () => reject(new Error('Die OCR-Bibliothek konnte nicht geladen werden. Bitte Internet prüfen.'));
        document.head.appendChild(script);
      }).catch(error => {
        delete scriptPromises[url];
        throw error;
      });
    }
    return scriptPromises[url];
  }

  function euroAmount(s) {
    const value = String(s || '').replace(/\s*(?:EUR|€)\s*/gi,'').replace(/\s/g,'');
    if (!/^\d[\d.,]*[.,]\d{2}$/.test(value)) return null;
    const lastComma = value.lastIndexOf(',');
    const lastDot = value.lastIndexOf('.');
    const last = Math.max(lastComma,lastDot);
    const n = Number(value.slice(0,last).replace(/[.,]/g,'') + '.' + value.slice(last + 1));
    return Number.isFinite(n) && n >= 0 && n < 100000000 ? n : null;
  }
  function lastPrice(line) {
    // Requires exactly two cents digits; avoids interpreting dates, postal
    // codes, order numbers and kilometer readings as prices.
    const rx = /(?:^|[\s:€])(\d{1,3}(?:[.\s]\d{3})*[,.]\d{2}|\d+[,.]\d{2})\s*(?:€|EUR)?(?=\s*$)/i;
    const m = String(line).match(rx);
    if (!m) return null;
    const price = euroAmount(m[1]);
    if (price === null) return null;
    return {amount:price, prefix:line.slice(0,m.index).trim(), raw:m[1]};
  }
  function identifyDate(lines) {
    const rx = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/;
    const options = [];
    lines.forEach((line,i) => {
      const match = line.match(rx);
      if (!match) return;
      const day = Number(match[1]), month = Number(match[2]);
      let year = Number(match[3]);
      if (year < 100) year += year > 70 ? 1900 : 2000;
      const d = new Date(Date.UTC(year,month - 1,day));
      if (year < 2000 || year > 2100 || d.getUTCFullYear() !== year ||
          d.getUTCMonth() !== month-1 || d.getUTCDate() !== day) return;
      const score = (/datum|kaufdatum|rechnungsdatum|belegdatum/i.test(line) ? 30 : 0) - i / 3;
      options.push({date:year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'),score});
    });
    options.sort((a,b) => b.score-a.score);
    return options.length ? options[0].date : '';
  }
  function identifyVendor(lines) {
    const bad = /^(?:rechnung|kassenbon|beleg|quittung|tax|invoice|customer|danke|willkommen|filiale|adresse|str(?:asse|aße)|tel|fax|www|https?|[0-9\s.,:/\-]+|ust|steuer|bon.nr|datum|uhrzeit|kasse|eur|zahlung|kunden|artikel|betrag)\b/i;
    for (const raw of lines.slice(0,8)) {
      const line=raw.trim();
      const tokens=line.split(/\s+/).filter(Boolean);
      // OCR of tiny distant print can produce isolated random letters.
      if(tokens.length>=5 && tokens.filter(t=>t.length<=2).length>=3)continue;
      if (line.length < 3 || line.length > 85 || bad.test(line) ||
          /^\d/.test(line) || /(?:IBAN|BIC|@|\.de\b|\.com\b)/i.test(line) ||
          !/[A-Za-zÄÖÜäöüß]{3}/.test(line)) continue;
      return line.replace(/\s{2,}/g,' ').slice(0,180);
    }
    return '';
  }
  function isNotItem(line) {
    return /(?:\b(?:summe|gesamt|total|endbetrag|rechnungsbetrag|netto|brutto|mwst|ust|steuer|rückgeld|wechselgeld|gegeben|kartenzahlung|zahlung|barzahlung|bar bezahlt|visa|mastercard|ec-karte|rabatt|gutschein|euro|steuerbetrag|zahlbetrag|beleg|rechnung|kasse|bedienung|telefon|iban|kontonr|kreditkarte|artikelnummer|warenwert|danke|filiale|adresse|transaktion|datum|uhrzeit|saldo|restbetrag|lieferkosten|nettobetrag|bruttobetrag|umsatzsteuer|mehrwertsteuer|steueranteil|zahlungsart|rechnungsnummer|belegnummer)\b|(?:www\.|https?:|@|ust-id|steuer-nr|^\*+$))/i.test(line);
  }

  function parse(text) {
    const lines = String(text || '')
      .replace(/\r/g,'\n')
      .split(/\n/)
      .map(s => s.replace(/[ \t]+/g,' ').trim())
      .filter(Boolean).slice(0,450);
    const date = identifyDate(lines);
    const vendor = identifyVendor(lines);
    const totalRx = /(?:\b(?:gesamtbetrag|gesamtsumme|endbetrag|endsumme|rechnungsbetrag|gesamtpreis|gesamt\s*betrag|summe|brutto|zu\s*zahlen|zahlbetrag|total)\b)/i;
    const netRx = /\b(?:nettobetrag|netto\s*betrag|nettosumme)\b/i;
    const taxRx = /\b(?:mehrwertsteuer|umsatzsteuer|mwst|ust(?:\s+\d+)?|steuerbetrag)\b/i;
    const cents = /^\s*(?:€|EUR)?\s*\d{1,7}(?:[.\s]\d{3})*[,.]\d{2}\s*(?:€|EUR)?\s*$/i;
    function valueNear(index) {
      const current = lastPrice(lines[index]);
      if (current) return current.amount;
      if (index+1<lines.length && cents.test(lines[index+1])) {
        const next=lastPrice(lines[index+1]);
        if(next)return next.amount;
      }
      return null;
    }
    const candidates=[];
    let netAmount=null, taxAmount=null;
    lines.forEach((line,i)=>{
      if (netRx.test(line) && netAmount===null)netAmount=valueNear(i);
      if (taxRx.test(line) && taxAmount===null)taxAmount=valueNear(i);
      if (!totalRx.test(line) ||
          /\b(?:zwischensumme|netto|steuer|mwst|rabatt|gutschein|trinkgeld)\b/i.test(line)) return;
      const amount=valueNear(i);
      if (amount===null)return;
      const highest = /\b(?:gesamtbetrag|gesamtsumme|endbetrag|endsumme|rechnungsbetrag|gesamtpreis|zu\s*zahlen|zahlbetrag)\b/i.test(line);
      const medium=/\b(?:summe|brutto|total)\b/i.test(line);
      candidates.push({amount,index:i,score:(highest?100:medium?65:35)+i/Math.max(1,lines.length)*10});
    });
    candidates.sort((a,b)=>b.score-a.score);
    const amount=candidates.length?candidates[0].amount:null;
    let km=null;
    for (const line of lines) {
      const m=line.match(/\b(?:kilometer[-\s]*stand|km[-\s]*stand|kilometerstand)\s*[:\-]?\s*(\d{3}(?:[.\s]\d{3})+|\d{4,7})\b/i);
      if(m) {const n=Number(m[1].replace(/[.\s]/g,''));if(Number.isSafeInteger(n)&&n>=0){km=n;break;}}
    }
    const summaryIdx=lines.findIndex(line=>totalRx.test(line)||netRx.test(line)||taxRx.test(line));
    const stop=summaryIdx>=1?summaryIdx:candidates.length?candidates[0].index:lines.length;
    const items=[];
    function push(name,quantity,price) {
      const clean=String(name||'').replace(/\s{2,}/g,' ').trim().slice(0,180);
      if(!clean || clean.length<3 || !/[A-Za-zÄÖÜäöüß]{2}/.test(clean) ||
         isNotItem(clean) || items.length>=MAX_ITEMS)return;
      if(items.some(item=>item.name===clean&&item.amount===price))return;
      items.push({name:clean,quantity,amount:price});
    }
    function heading(line){
      if(!/^[\p{L}][\p{L}\s\-()./]{2,40}:\s*$/u.test(line) ||
          /(?:Hinweis|Empfänger|Bemerkung|Fahrzeug|Zahlung|Kilometer|Kennzeichen|Rechnung|Beleg|Summe|Netto|Steuer)/i.test(line))return '';
      return line.slice(0,-1).trim();
    }
    for(let i=1;i<Math.min(stop,lines.length);i++){
      const line=lines[i];
      if(isNotItem(line) || /\b(?:IBAN|BIC|www\.)\b/i.test(line))continue;
      const head=heading(i>0?lines[i-1]:'');
      const price=lastPrice(line);
      if(price){
        let prefix=price.prefix;
        let quantity=1;
        const qty=prefix.match(/^\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:x|stk\.?|stück)\s+/i);
        if(qty){
          quantity=Number(qty[1].replace(',','.'))||1;
          prefix=prefix.slice(qty[0].length);
        }
        prefix=prefix.replace(/^\d{5,14}\s+/,'').replace(/\s+(?:A|B|C|\*)$/,'').trim();
        if(head && prefix.length>=3)prefix=head+': '+prefix;
        push(prefix,quantity,price.amount);
        continue;
      }
      // Many service receipts list a heading ("Ölfilter:") and then a
      // part number without a separate price. Capture it without inventing €.
      if(head){
        const m=line.match(/^\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:x|stk\.?|stück)\s+(.{2,80})$/i);
        if(m && /[A-Za-zÄÖÜäöüß0-9]{2}/.test(m[2]))
          push(head+': '+m[2],Number(m[1].replace(',','.'))||1,null);
      }
    }
    return {vendor,date,amount,items,netAmount,taxAmount,km};
  }

  function clearRows() { const node=el('receipt-items-list'); if(node)node.innerHTML=''; }
  function addItem(item) {
    const list=el('receipt-items-list');
    if (!list) return;
    if (list.children.length>=MAX_ITEMS) {
      show('Maximal '+MAX_ITEMS+' Artikel pro Beleg.',true);return;
    }
    const row=document.createElement('div');
    row.className='receipt-item-row grid grid-cols-12 gap-2 p-2 rounded-xl border border-slate-200 bg-white items-end';
    row.innerHTML=[
      '<label class="col-span-12 sm:col-span-6 text-[10px] font-bold text-slate-600">Artikel',
      '<input type="text" maxlength="180" class="receipt-item-name mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-xs" placeholder="Artikel / Leistung" value="'+escapeHtml(item && item.name || '')+'"></label>',
      '<label class="col-span-4 sm:col-span-2 text-[10px] font-bold text-slate-600">Menge',
      '<input type="number" min="0.001" max="1000" step="any" inputmode="decimal" class="receipt-item-qty mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-xs" value="'+escapeHtml(item && item.quantity != null ? item.quantity : 1)+'"></label>',
      '<label class="col-span-6 sm:col-span-3 text-[10px] font-bold text-slate-600">Positionspreis (€)',
      '<input type="number" min="0" step="0.01" inputmode="decimal" class="receipt-item-price mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-xs" placeholder="0,00" value="'+escapeHtml(item && item.amount != null ? item.amount.toFixed(2) : '')+'"></label>',
      '<button type="button" class="receipt-item-remove col-span-2 sm:col-span-1 p-2 text-rose-700 rounded-lg bg-rose-50" aria-label="Artikel entfernen"><i class="fa-solid fa-trash"></i></button>'
    ].join('');
    row.querySelector('.receipt-item-remove').addEventListener('click',()=>row.remove());
    list.appendChild(row);
  }
  function collect() {
    const list=el('receipt-items-list');
    if(!list)return [];
    return Array.from(list.querySelectorAll('.receipt-item-row')).map(row => {
      const name=row.querySelector('.receipt-item-name').value.trim();
      const quantity=Number(row.querySelector('.receipt-item-qty').value);
      const rawPrice=row.querySelector('.receipt-item-price').value;
      const amount=rawPrice==='' ? null : Number(rawPrice);
      if (!name || name.length>180 || !Number.isFinite(quantity) || quantity<=0 || quantity>1000 ||
          (amount!==null && (!Number.isFinite(amount)||amount<0||amount>100000000))) {
        throw new Error('Bitte alle Artikelbezeichnungen, Mengen und Positionspreise prüfen.');
      }
      return {name,quantity,amount};
    });
  }
  function reset() {
    scanSerial++;
    clearRows();
    const check=el('receipt-ocr-review');
    if(check)check.checked=false;
    const wrapper=el('receipt-ocr-review-wrap');
    if(wrapper)wrapper.classList.add('hidden');
    const status=el('receipt-ocr-status');
    if(status){status.textContent='';status.classList.add('hidden');}
    const retry=el('receipt-ocr-retry');
    if(retry)retry.disabled=false;
  }

  async function preparePhoto(file) {
    const blobUrl=URL.createObjectURL(file);
    try {
      const image=await new Promise((resolve,reject)=>{
        const img=new Image();
        img.onload=()=>resolve(img);
        img.onerror=()=>reject(new Error('Das Foto konnte nicht geöffnet werden. Bitte als JPG fotografieren.'));
        img.src=blobUrl;
      });
      // Detect narrow, bright thermal-paper receipts even when they occupy
      // only one third of a large mobile photo.
      const sample=document.createElement('canvas');
      const sampleWidth=Math.min(900,image.naturalWidth);
      const ratio=sampleWidth/image.naturalWidth;
      sample.width=sampleWidth;
      sample.height=Math.max(1,Math.round(image.naturalHeight*ratio));
      const ctx=sample.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(image,0,0,sample.width,sample.height);
      const data=ctx.getImageData(0,0,sample.width,sample.height).data;
      const w=sample.width,h=sample.height;
      function brightness(x,y) {
        const vals=[];
        for(const dy of [-9,-5,0,5,9]){
          for(const dx of [-4,0,4]){
            const xx=Math.max(0,Math.min(w-1,Math.round(x+dx)));
            const yy=Math.max(0,Math.min(h-1,Math.round(y+dy)));
            const k=(yy*w+xx)*4;
            vals.push((data[k]+data[k+1]+data[k+2])/3);
          }
        }
        vals.sort((a,b)=>a-b);
        return vals[11]; // upper quartile ignores text strokes on white paper
      }
      const bounds=[];
      const step=Math.max(22,Math.round(h*0.027));
      for(let y=Math.round(h*0.04);y<h*0.985;y+=step){
        let center=Math.round(w*.44);
        if(brightness(center,y)<195){
          // A dark letter may cover the center; search nearby for clean paper.
          let max=0,best=center;
          for(let x=Math.round(w*.39);x<=w*.55;x+=5){
            const v=brightness(x,y);
            if(v>max){max=v;best=x;}
          }
          if(max<197)continue;
          center=best;
        }
        let left=center,right=center;
        while(left>w*.10 && brightness(left-3,y)>195)left-=3;
        while(right<w*.82 && brightness(right+3,y)>195)right+=3;
        if(right-left>=w*.17 && right-left<=w*.69)
          bounds.push({y,left,right,width:right-left});
      }
      if(bounds.length<8){
        return {image, bounds:null,
          top:0,bottom:image.naturalHeight,width:Math.max(550,Math.min(1150,image.naturalWidth)),
          scale:Math.min(2,1150/image.naturalWidth),
          ratio:1, detected:false};
      }
      const widths=bounds.map(b=>b.width).sort((a,b)=>a-b);
      const median=widths[Math.floor(widths.length/2)];
      const target=1150;
      const scale=target/(median+18);
      const top=Math.max(0,bounds[0].y-h*.025);
      const bottom=Math.min(h,bounds[bounds.length-1].y+h*.035);
      return {image,bounds,top,bottom,width:target,scale,ratio:ratio,detected:true};
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }
  function paperBounds(model,y) {
    const points=model.bounds;
    if(y<=points[0].y)return points[0];
    if(y>=points[points.length-1].y)return points[points.length-1];
    let low=0,high=points.length-1;
    while(high-low>1){
      const mid=(high+low)>>1;
      if(points[mid].y<=y)low=mid;else high=mid;
    }
    const a=points[low],b=points[high],t=(y-a.y)/(b.y-a.y);
    return {left:a.left+(b.left-a.left)*t,right:a.right+(b.right-a.right)*t};
  }
  function drawPhotoPart(model,from,to) {
    const sourceRatio=model.detected?1/model.ratio:1;
    const canvas=document.createElement('canvas');
    canvas.width=model.width;
    canvas.height=Math.max(1,Math.round((to-from)*model.scale));
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.filter='grayscale(1) contrast(1.65)';
    if(model.detected){
      for(let y=from;y<to;y+=8) {
        const h=Math.min(8,to-y);
        const edges=paperBounds(model,y+h/2);
        const x=Math.max(0,(edges.left-9)*sourceRatio);
        const width=Math.min(model.image.naturalWidth-x,(edges.right-edges.left+18)*sourceRatio);
        // Straighten the slanted paper edges row by row, maintaining proportions.
        ctx.drawImage(model.image,x,y*sourceRatio,width,h*sourceRatio,
          0,(y-from)*model.scale,canvas.width,h*model.scale+1);
      }
    } else {
      ctx.drawImage(model.image,0,from,model.image.naturalWidth,to-from,
        0,0,canvas.width,canvas.height);
    }
    ctx.filter='none';
    return canvas;
  }
  async function newOcrWorker(setStatus) {
    const lib=await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');
    const worker=await lib.createWorker('deu+eng',1,{
      logger: msg=>{
        if(msg && msg.status==='recognizing text' && msg.progress>=0) {
          setStatus('Texterkennung läuft: '+Math.round(msg.progress*100)+' %');
        }
      }
    });
    await worker.setParameters({
      tessedit_pageseg_mode:'4',
      preserve_interword_spaces:'1'
    });
    return worker;
  }
  async function scanImage(file,setStatus) {
    setStatus('Der schmale Kassenbeleg wird zugeschnitten und aufgerichtet …');
    const model=await preparePhoto(file);
    setStatus(model.detected ?
      'Papier erkannt: Text wird vergrößert und kontrastiert …' :
      'Automatische Papiererkennung unsicher. Foto wird vergrößert ausgelesen …');
    const worker=await newOcrWorker(setStatus);
    const length=model.bottom-model.top;
    const sectionCount=model.detected?
      Math.max(1,Math.min(5,Math.ceil(length*model.scale/1750))):
      Math.max(1,Math.ceil(length*model.scale/1750));
    const parts=[];
    try {
      for(let i=0;i<sectionCount;i++){
        const y0=model.top+length*i/sectionCount;
        const y1=model.top+length*(i+1)/sectionCount;
        const canvas=drawPhotoPart(model,y0,y1);
        setStatus('Kassenbeleg: Abschnitt '+(i+1)+' von '+sectionCount+' wird gelesen …');
        try {
          const result=await worker.recognize(canvas);
          parts.push(result.data && result.data.text || '');
        } finally { canvas.width=0;canvas.height=0; }
      }
      let combined=parts.join('\n');
      // If total or header is still missing, try a second contrast/segment
      // configuration for only the relevant area.
      const data=parse(combined);
      if(model.detected && (data.amount===null || !data.vendor)){
        await worker.setParameters({tessedit_pageseg_mode:'6'});
        const sections=[];
        if(!data.vendor)sections.push([model.top,model.top+length*.23]);
        if(data.amount===null)sections.push([model.top+length*.65,model.bottom]);
        for(const [y0,y1] of sections){
          const canvas=drawPhotoPart(model,y0,y1);
          setStatus('Zusätzliche Erkennung für '+(y0===model.top?'Händler':'Endbetrag')+' …');
          try {
            const result=await worker.recognize(canvas);
            const extra=result.data && result.data.text || '';
            combined=y0===model.top ? extra+'\n'+combined : combined+'\n'+extra;
          } finally {canvas.width=0;canvas.height=0;}
        }
      }
      return combined;
    } finally { await worker.terminate(); }
  }
  function pdfLines(items) {
    const groups=[];
    for (const token of items) {
      const str=String(token.str || '').trim();
      if (!str)continue;
      const y=Number(token.transform && token.transform[5])||0;
      const x=Number(token.transform && token.transform[4])||0;
      let group=groups.find(g=>Math.abs(g.y-y)<3);
      if(!group){group={y,items:[]};groups.push(group);}
      group.items.push({x,str});
    }
    groups.sort((a,b)=>b.y-a.y);
    return groups.map(g=>g.items.sort((a,b)=>a.x-b.x).map(x=>x.str).join(' ')).join('\n');
  }
  async function scanPdf(file,setStatus) {
    setStatus('PDF-Rechnung wird ausgelesen …');
    const lib=await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');
    lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const job=lib.getDocument({data:new Uint8Array(await file.arrayBuffer())});
    const pdf=await job.promise;
    const parts=[];
    let worker=null;
    try {
      for(let pageNo=1;pageNo<=Math.min(MAX_PDF_PAGES,pdf.numPages);pageNo++){
        setStatus('PDF-Seite '+pageNo+' von '+Math.min(pdf.numPages,MAX_PDF_PAGES)+' wird gelesen …');
        const page=await pdf.getPage(pageNo);
        const textContent=await page.getTextContent();
        let text=pdfLines(textContent.items || []);
        if(text.replace(/\s/g,'').length<45){
          setStatus('Gescannte PDF-Seite wird per Texterkennung gelesen …');
          if(!worker)worker=await newOcrWorker(setStatus);
          const raw=page.getViewport({scale:1});
          const scale=Math.min(2,1900/raw.width,2500/raw.height);
          const viewport=page.getViewport({scale:Math.max(0.5,scale)});
          const canvas=document.createElement('canvas');
          canvas.width=Math.ceil(viewport.width);
          canvas.height=Math.ceil(viewport.height);
          const ctx=canvas.getContext('2d');
          ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
          try {
            await page.render({canvasContext:ctx,viewport}).promise;
            const r=await worker.recognize(canvas);
            text=r.data && r.data.text || '';
          } finally {canvas.width=0;canvas.height=0;}
        }
        parts.push(text);
        page.cleanup();
      }
    } finally {
      if(worker)await worker.terminate();
      await pdf.destroy();
    }
    return parts.join('\n');
  }
  async function scan(file) {
    if(!file || !file.size)return;
    const number=++scanSerial;
    const retry=el('receipt-ocr-retry');
    const save=el('receipt-save-btn');
    if(retry)retry.disabled=true;
    if(save)save.disabled=true;
    show('Beleg wird automatisch erkannt. Bitte noch nicht speichern.',false);
    const update=message=>{if(number===scanSerial)show(message,false);};
    try {
      const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
      const raw=isPdf?await scanPdf(file,update):await scanImage(file,update);
      if(number!==scanSerial || file!==window.ECB_CURRENT_RECEIPT_FILE)return;
      const extracted=parse(raw);
      let detected=0;
      if(extracted.vendor) {el('receipt-vendor').value=extracted.vendor;detected++;}
      if(extracted.date) {el('receipt-date').value=extracted.date;detected++;}
      if(extracted.amount!==null) {el('receipt-amount').value=extracted.amount.toFixed(2);detected++;}
      if(extracted.netAmount!==null) {el('receipt-net').value=extracted.netAmount.toFixed(2);detected++;}
      if(extracted.taxAmount!==null) {el('receipt-vat').value=extracted.taxAmount.toFixed(2);detected++;}
      if(extracted.km!==null) {el('receipt-km').value=String(extracted.km);detected++;}
      if(extracted.items.length){
        clearRows();
        extracted.items.forEach(addItem);
        detected++;
        const description=el('receipt-description');
        if(description && !description.value.trim()){
          description.value=extracted.items.slice(0,3).map(x=>x.name).join(', ').slice(0,240);
        }
      }
      if(detected){
        const wrapper=el('receipt-ocr-review-wrap');
        if(wrapper)wrapper.classList.remove('hidden');
        const check=el('receipt-ocr-review');
        if(check)check.checked=false;
        const missing=[];
        if(!extracted.vendor)missing.push('Händler');
        if(extracted.amount===null)missing.push('Endbetrag');
        show('Erkannt: '+[
          extracted.vendor?'Händler':'',
          extracted.date?'Datum':'',
          extracted.amount!==null?'Endbetrag':'',
          extracted.netAmount!==null?'Netto':'',
          extracted.taxAmount!==null?'MwSt.':'',
          extracted.km!==null?'Kilometerstand':'',
          extracted.items.length?extracted.items.length+' Artikel':''
        ].filter(Boolean).join(', ')+'. '+
        (missing.length ? 'Nicht zuverlässig erkannt: '+missing.join(', ')+'. Bitte selbst ergänzen. ' : '')+
        'Alle Daten und Preise mit dem Originalbeleg vergleichen und bestätigen.',missing.length>0);
      } else {
        show('Aus diesem Beleg konnten keine sicheren Daten erkannt werden. Bitte Felder manuell eintragen.',true);
      }
    } catch(error) {
      if(number===scanSerial)show('Automatische Erkennung fehlgeschlagen: '+
        (error && error.message || 'Unbekannter Fehler')+
        '. Du kannst den Beleg trotzdem manuell erfassen.',true);
    } finally {
      if(number===scanSerial){
        if(retry)retry.disabled=false;
        if(save)save.disabled=false;
      }
    }
  }
  window.ECBReceiptOCR={scan,reset,addItem,collect,parse};
})();
