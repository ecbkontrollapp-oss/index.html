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
      if (line.length < 3 || line.length > 85 || bad.test(line) ||
          /^\d/.test(line) || /(?:IBAN|BIC|@|\.de\b|\.com\b)/i.test(line) ||
          !/[A-Za-zÄÖÜäöüß]{3}/.test(line)) continue;
      return line.replace(/\s{2,}/g,' ').slice(0,180);
    }
    return '';
  }
  function isNotItem(line) {
    return /(?:\b(?:summe|gesamt|total|endbetrag|rechnungsbetrag|netto|brutto|mwst|ust|steuer|rückgeld|wechselgeld|gegeben|kartenzahlung|zahlung|barzahlung|bar bezahlt|visa|mastercard|ec-karte|rabatt|gutschein|euro|steuerbetrag|zahlbetrag|beleg|rechnung|kasse|bedienung|telefon|iban|kontonr|kreditkarte|artikelnummer|warenwert|danke|filiale|adresse|transaktion|datum|uhrzeit|saldo|restbetrag|lieferkosten)\b|(?:www\.|https?:|@|ust-id|steuer-nr|^\*+$))/i.test(line);
  }

  function parse(text) {
    const lines = String(text || '')
      .replace(/\r/g,'\n')
      .split(/\n/)
      .map(s => s.replace(/[ \t]+/g,' ').trim())
      .filter(Boolean).slice(0,350);
    const date = identifyDate(lines);
    const vendor = identifyVendor(lines);
    const totals = [];
    lines.forEach((line,i) => {
      const p = lastPrice(line);
      if (!p) return;
      const high = /\b(?:zu\s*zahlen|zahlbetrag|endbetrag|gesamtbetrag|gesamtsumme|endsumme|rechnungsbetrag|total|gesamtpreis|fälliger\s*betrag)\b/i.test(line);
      const medium = /\b(?:gesamt|summe|bruttobetrag)\b/i.test(line);
      const lower = /\b(?:betrag|bar|karte|kartenzahlung|ec-karte|visa|mastercard|zahlung)\b/i.test(line);
      if (/rückgeld|wechselgeld|gegeben|zwischensumme|netto|mwst|umsatzsteuer|steuerbetrag|ust\s*[0-9]|rabatt|gutschein|trinkgeld/i.test(line)) return;
      if (high || medium || lower) {
        totals.push({index:i,amount:p.amount, score:(high?100:medium?65:35)+i/(lines.length||1)*15});
      }
    });
    totals.sort((a,b)=>b.score-a.score);
    const amount = totals.length ? totals[0].amount : null;
    // Stop collecting article lines before summary/total block.
    const summaryIdx=lines.findIndex(line=>/\b(?:zwischensumme|gesamtbetrag|gesamtsumme|summe|endbetrag|zu zahlen|rechnungsbetrag|brutto|total)\b/i.test(line));
    const stop = summaryIdx > 0 ? summaryIdx : totals.length ? totals[0].index : lines.length;
    const items = [];
    const start=Math.min(lines.length,1);
    for (let i=start; i<Math.min(stop,lines.length); i++) {
      const line=lines[i];
      if (isNotItem(line) || /\b(?:\d{2}\.\d{2}\.\d{4}|IBAN|BIC)\b/i.test(line)) continue;
      const price=lastPrice(line);
      if (!price) continue;
      let prefix=price.prefix.trim();
      if (prefix.length < 3 && i > 0) {
        const prev=lines[i-1];
        if (prev.length>=4 && prev.length<100 && !isNotItem(prev) &&
            !/\d{2}[./-]\d{2}[./-]\d{2,4}/.test(prev) &&
            !lastPrice(prev)) prefix=prev;
      }
      if (prefix.length < 3 || !/[A-Za-zÄÖÜäöüß]{3}/.test(prefix) ||
          /(?:\b(?:strasse|straße|nummer|kundennr|plz|postfach)\b|[A-Za-z]+@)/i.test(prefix)) continue;
      let quantity=1;
      const quantityPrefix=prefix.match(/^(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:x|X|stk\.?|stück)\s+/i);
      if (quantityPrefix) {
        const q=Number(quantityPrefix[1].replace(',','.'));
        if (Number.isFinite(q) && q>0 && q<=1000) quantity=q;
        prefix=prefix.slice(quantityPrefix[0].length);
      }
      const unitPrice=prefix.match(/^\d+[,.]\d{2}\s+(.+)$/);
      if (unitPrice) prefix=unitPrice[1];
      // Strip common POS item codes, without destroying article names.
      prefix=prefix.replace(/^\d{5,14}\s+/,'').replace(/\s+(?:A|B|C|\*)$/,'').trim();
      if (prefix.length<3 || !/[A-Za-zÄÖÜäöüß]{3}/.test(prefix))continue;
      if (items.some(item=>item.name===prefix && item.amount===price.amount))continue;
      items.push({name:prefix.slice(0,180),quantity:quantity,amount:price.amount});
      if(items.length>=MAX_ITEMS)break;
    }
    return {vendor,date,amount,items};
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

  async function drawImage(file) {
    const blobUrl=URL.createObjectURL(file);
    try {
      const img=await new Promise((resolve,reject)=>{
        const photo=new Image();
        photo.onload=()=>resolve(photo);
        photo.onerror=()=>reject(new Error('Das Foto konnte nicht geöffnet werden. Bei HEIC bitte ein JPG verwenden.'));
        photo.src=blobUrl;
      });
      const scale=Math.min(1,2100/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      const ctx=canvas.getContext('2d',{willReadFrequently:false});
      ctx.fillStyle='#fff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      return canvas;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }
  async function newOcrWorker(setStatus) {
    const lib=await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');
    return lib.createWorker('deu+eng',1,{
      logger: msg=>{
        if(msg && msg.status==='recognizing text' && msg.progress>=0) {
          setStatus('Texterkennung läuft: '+Math.round(msg.progress*100)+' %');
        }
      }
    });
  }
  async function scanImage(file,setStatus) {
    setStatus('Foto wird für die Erkennung vorbereitet …');
    const canvas=await drawImage(file);
    setStatus('Texterkennung wird geladen (beim ersten Mal etwas länger) …');
    const worker=await newOcrWorker(setStatus);
    try {
      const result=await worker.recognize(canvas);
      return result.data && result.data.text || '';
    } finally { await worker.terminate(); canvas.width=0;canvas.height=0; }
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
        show('Erkannt: '+[
          extracted.vendor?'Händler':'',
          extracted.date?'Datum':'',
          extracted.amount!==null?'Endbetrag':'',
          extracted.items.length?extracted.items.length+' Artikel':''
        ].filter(Boolean).join(', ')+'. Bitte alle Angaben und Preise mit dem Originalbeleg vergleichen und bestätigen.',false);
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
