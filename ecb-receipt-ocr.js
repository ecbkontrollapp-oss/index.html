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
    const rx = /(?:^|[^\d])(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4}|\d{2})(?!\d)/;
    const nowYear=new Date().getFullYear();
    const options = [];
    lines.forEach((line,i) => {
      const match = line.match(rx);
      if (!match) return;
      const day = Number(match[1]), month = Number(match[2]);
      let year = Number(match[3]);
      if (year < 100) year += year > 70 ? 1900 : 2000;
      const d = new Date(Date.UTC(year,month-1,day));
      if (year < 1990 || year > nowYear+1 || d.getUTCFullYear() !== year ||
          d.getUTCMonth() !== month-1 || d.getUTCDate() !== day) return;
      const score = (/datum|kaufdatum|rechnungsdatum|belegdatum/i.test(line) ? 35 : 0) -
        (/tse|start\/ende|signatur|serial|z[üu]r[üu]ckgestellt/i.test(line) ? 30 : 0) -
        i / 2;
      options.push({year,day,month,date:year+'-'+String(month).padStart(2,'0')+
          '-'+String(day).padStart(2,'0'),score});
    });
    if(!options.length) return '';
    // When OCR disagrees on a digit of the year, another date with identical
    // day/month and a plausible recent year is stronger corroborating evidence.
    const recent=options.filter(x=>x.year>=nowYear-10);
    if(!recent.length) return ''; // historical invoices require manual confirmation
    recent.sort((a,b)=>{
      const ac=options.filter(o=>o.date===a.date).length;
      const bc=options.filter(o=>o.date===b.date).length;
      return bc-ac || b.score-a.score;
    });
    return recent[0].date;
  }
  function identifyVendor(lines) {
    const candidates=lines.slice(0,13);
    const known=/^\s*mac\s*[o0]\s*[i1lt]\s*l(?:\b|[^\p{L}])/iu;
    for(const line of candidates)if(known.test(line))return 'macOIL';
    const forbidden=/(?:\b(?:rechnung|kassenbon|beleg|quittung|tax|invoice|danke|willkommen|filiale|adresse|inhaber|telefon|kunde|kundennummer|vorgang|vorgangsnummer|belegnummer|kilometer|kennzeichen|steuer|ust|mwst|mehrwertsteuer|netto|brutto|gesamtbetrag|summe|gesamt|zahlbetrag|betrag|kasse|artikel|leistung|zahlung|datum|uhrzeit|maschinen|tse|signature|bon)\b|rechnungs(?:datum|betrag|nummer)|\d{2}[./-]\d{2}[./-]\d{2,4})/i;
    const address=/(?:stra(?:ße|sse|be)|str\.?|weg|platz|gasse|allee|avenue|street|road|m[öo]hlstra\w*)\s*[-.,]?\s*\d+\s*(?:[-/]\s*\d+)?\b/i;
    for(const raw of candidates.slice(0,9)){
      const line=String(raw||'').trim();
      if(line.length<3||line.length>80||forbidden.test(line)||address.test(line)||
         /(?:IBAN|BIC|@|\.de\b|\.com\b)/i.test(line)||
         /^\d/.test(line)||/\b\d{5}\b/.test(line)||
         !/[A-Za-zÄÖÜäöüß]{3}/.test(line))continue;
      const tokens=line.split(/\s+/);
      if(tokens.length>=5&&tokens.filter(x=>x.length<=2).length>=3)continue;
      return line.replace(/[^\p{L}\p{N}.)&/\-]+$/gu,'').slice(0,180);
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
    let vendor = identifyVendor(lines);
    // Known merchant name that thermal OCR regularly confuses (I/T, O/0).
    if (/^mac[O0][ITL]{2}$/i.test(vendor)) vendor='macOIL';
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
    let amount=candidates.length?candidates[0].amount:null;
    let totalDerived=false;
    let netCalculated=false;
    if (netAmount===null && amount!==null && taxAmount!==null &&
        amount>0 && taxAmount>=0 && taxAmount < amount * .35) {
      // A deterministic subtraction, not an OCR guess.
      const grossCents=Math.round(amount*100);
      const vatCents=Math.round(taxAmount*100);
      netAmount=(grossCents-vatCents)/100;
      netCalculated=true;
    }
    let plate=null;
    const plates = [];
    const plateToken = /\b([A-ZÄÖÜ]{1,3})\s*[-\s]\s*([A-ZÄÖÜ]{1,2})\s*[-\s]?\s*(\d{1,4})(?:\s*[EH])?\b/i;
    for(let i=0;i<lines.length;i++) {
      const line=lines[i];
      if (!/(?:kennzeichen|kennzeich|kennz\.?|kfz[\s-]*zeichen|amtliches)/i.test(line))continue;
      const nearby = [line,lines[i+1]||''].join(' ');
      const labelEnd = nearby.replace(/^.*?(?:kennzeichen|kennzeich|kennz\.?|kfz[\s-]*zeichen|amtliches)\s*[:=\-]?\s*/i,'');
      const hit=labelEnd.match(plateToken);
      if (hit) plates.push((hit[1]+'-'+hit[2]+' '+hit[3]).toUpperCase());
    }
    if (plates.length && plates.every(value=>value===plates[0])) plate=plates[0];
    let km=null,kmUncertain=false;
    const kms=[];
    for(const line of lines) {
      const m=line.match(/\b(?:kilometer[-\s]*stand|km[-\s]*stand|kilometerstand)\s*[:\-]?\s*(\d{3}(?:[.\s]\d{3})+|\d{4,7})\b/i);
      if(m) {
        const n=Number(m[1].replace(/[.\s]/g,''));
        if(Number.isSafeInteger(n) && n>=0)kms.push(n);
      }
    }
    const countKm=new Map();
    kms.forEach(v=>countKm.set(v,(countKm.get(v)||0)+1));
    const rankedKms=Array.from(countKm.entries()).sort((a,b)=>b[1]-a[1]);
    if(rankedKms.length===1)km=rankedKms[0][0];
    else if(rankedKms.length>1) {
      if(rankedKms[0][1]>rankedKms[1][1])km=rankedKms[0][0];
      else kmUncertain=true;
    }
    const summaryIdx=lines.findIndex(line=>totalRx.test(line)||netRx.test(line)||taxRx.test(line));
    const stop=summaryIdx>=1?summaryIdx:candidates.length?candidates[0].index:lines.length;
    const items=[];
    function itemIdentity(name) {
      let normalized=String(name||'').toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
      if(/\b(?:5w\s*30|5w\s*40|0w\s*30)\b/.test(normalized))
        normalized=normalized.replace(/^(?:olwechsel|oelwechsel|motorol)\s+/,'');
      return normalized.replace(/\s+/g,'');
    }
    function push(name,quantity,price) {
      const clean=String(name||'').replace(/\s{2,}/g,' ').trim().slice(0,180);
      if(!clean || clean.length<3 || !/[A-Za-zÄÖÜäöüß]{2}/.test(clean) ||
         isNotItem(clean) || items.length>=MAX_ITEMS)return;
      const key=itemIdentity(clean);
      const existing=items.find(item=>itemIdentity(item.name)===key &&
        Number(item.quantity)===Number(quantity) &&
        (item.amount===price||item.amount==null||price==null));
      if(existing){
        if(existing.amount===null&&price!==null)existing.amount=price;
        if(clean.length>existing.name.length)existing.name=clean;
        return;
      }
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
    // If thermal-print OCR recognized service headings but fragmented the
    // associated price line, keep the ACTUAL recognized item and leave its
    // price blank. Never invent a separate parts price.
    const serviceHeading=/^\s*(ölwechsel|ölfilter|motoröl|luftfilter|kraftstofffilter|inspektion|bremsbeläge|bremsflüssigkeit|reifenwechsel|zündkerzen|scheibenwischer)\s*[:\-]?\s*$/i;
    for (let i=0;i<stop;i++) {
      const m=lines[i].match(serviceHeading);
      if(!m)continue;
      const title=m[1];
      if(items.some(item=>item.name.toLowerCase().startsWith(title.toLowerCase())))continue;
      let name=title,qty=1,price=null;
      const next=lines[i+1]||'';
      if(next && !isNotItem(next)) {
        let row=next;
        const p=lastPrice(row);
        if(p){price=p.amount;row=p.prefix;}
        const parts=row.match(/^\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:x|stk\.?|stück)\s+(.{2,90})$/i);
        if(parts){
          qty=Number(parts[1].replace(',','.'))||1;
          if(/[A-Za-zÄÖÜäöüß0-9]{2}/.test(parts[2])) name=title+': '+parts[2].trim();
        }
      }
      push(name,qty,price);
    }
    // Read explicit quantity x product lines even if another OCR section
    // accidentally put the receipt totals before the products.
    const quantityLine=/^\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:x|×|stk\.?|stück)\s+(.{2,120})$/i;
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(isNotItem(line))continue;
      const match=line.match(quantityLine);
      if(!match)continue;
      const quantity=Number(match[1].replace(',','.'));
      if(!Number.isFinite(quantity)||quantity<=0||quantity>1000)continue;
      let remainder=match[2];
      const p=lastPrice(remainder);
      const amountOnLine=p?p.amount:null;
      if(p) remainder=p.prefix;
      const name=remainder.replace(/\s+(?:EUR|€)\s*$/i,'').trim();
      if(!/[A-Za-zÄÖÜäöüß]{1,}|[A-Z]?\s?\d{3,}/.test(name) ||
         /(?:\b(?:mwst|steuer|netto|gesamt|betrag|eur)\b)/i.test(name))continue;
      const previous=lines[i-1]||'';
      const titleMatch=previous.match(/^\s*((?:[oö0]lwechsel|[oö0]lfilter|motor[oö0]l|luftfilter|inspektion|bremsbel[aä]ge|reifenwechsel))\s*[:\-]?\s*$/i);
      const itemName=titleMatch?titleMatch[1]+': '+name:name;
      push(itemName,quantity,amountOnLine);
    }
    // Total derived only when arithmetic agrees exactly with the documented
    // tax rate. It stays labelled as calculated and MUST be reviewed.
    if(amount===null && netAmount!==null && taxAmount!==null) {
      const sum=Math.round(netAmount*100)+Math.round(taxAmount*100);
      if(sum>0) {
        amount=sum/100;
        totalDerived=true;
      }
    }
    if(amount===null && taxAmount!==null) {
      const priced=items.filter(item=>item.amount!==null);
      if(priced.length===1){
        const possible=priced[0].amount;
        const vatCents=Math.round(taxAmount*100);
        if([19,7].some(rate=>Math.abs(Math.round(possible*100*rate/(100+rate))-vatCents)<=1)){
          amount=possible;
          totalDerived=true;
        }
      }
    }
    if(netAmount===null && amount!==null && taxAmount!==null && amount>taxAmount){
      netAmount=(Math.round(amount*100)-Math.round(taxAmount*100))/100;
      netCalculated=true;
    }
    return {vendor,date,amount,totalDerived,items,netAmount,netCalculated,taxAmount,km,kmUncertain,plate};
  }


  // OCR-only supplements can fill missing invoice metadata, never overwrite
  // an already-read date, merchant, line item, vehicle or total price.
  // Odometer values are used only with corroboration; a digit error on a
  // thermal receipt is common and should not silently update the fleet.
  function mergeReceiptEvidence(base, samples) {
    const result={...base};
    const parsed=(samples||[]).map(s=>({
      kind:s.kind,
      fields:parse(s.text)
    }));
    function uniqueValues(kind,field) {
      const values=parsed.filter(x=>x.kind===kind).map(x=>x.fields[field])
        .filter(x=>x!==null && x!==undefined && Number.isFinite(x));
      return {values,unique:[...new Set(values)]};
    }
    const vat=uniqueValues('finance','taxAmount');
    const net=uniqueValues('finance','netAmount');
    if(result.taxAmount===null && vat.unique.length===1){
      const candidate=vat.unique[0];
      if(candidate>=0 && candidate>0 &&
        (result.amount===null || candidate<result.amount*.35)) {
        if(result.netAmount===null ||
          Math.abs(Math.round((result.netAmount+candidate-result.amount)*100))<=1)
          result.taxAmount=candidate;
      }
    }
    if(result.netAmount===null && net.unique.length===1){
      const candidate=net.unique[0];
      if(candidate>=0 && (result.amount===null || candidate<=result.amount) &&
        (result.taxAmount===null || result.amount===null ||
          Math.abs(Math.round((candidate+result.taxAmount-result.amount)*100))<=1)){
        result.netAmount=candidate;
      }
    }
    if(result.netAmount===null && result.amount!==null && result.taxAmount!==null &&
      result.amount>result.taxAmount){
      result.netAmount=(Math.round(result.amount*100)-Math.round(result.taxAmount*100))/100;
      result.netCalculated=true;
    }
    if(result.taxAmount===null && result.amount!==null && result.netAmount!==null &&
      result.amount>result.netAmount){
      // Difference alone can include tips, fees or zero-rated line items.
      // Do not infer VAT without an OCR-supported tax figure.
    }
    const km=uniqueValues('mileage','km');
    if(km.unique.length>1){
      result.km=null;
      result.kmUncertain=true;
    } else if(km.unique.length===1) {
      const count=km.values.length;
      const candidate=km.unique[0];
      if(result.km!==null && result.km!==candidate) {
        result.km=null;
        result.kmUncertain=true;
      } else if(result.km===null && count>=2 && !result.kmUncertain) {
        result.km=candidate;
      } else if(result.km===null && count>=2 && result.kmUncertain) {
        // Existing conflicts need human verification even if one later pass
        // has matching digits; never silently resolve disagreements.
      }
    }
    return result;
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
      '<input type="number" min="0" step="0.01" inputmode="decimal" class="receipt-item-price mt-1 w-full px-2 py-2 rounded-lg border border-slate-200 text-xs" placeholder="Kein Einzelpreis" value="'+escapeHtml(item && item.amount != null ? item.amount.toFixed(2) : '')+'"></label>',
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
    const debug=el('receipt-ocr-debug');
    if(debug){debug.classList.add('hidden');debug.open=false;}
    const raw=el('receipt-ocr-raw');
    if(raw)raw.value='';
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

  // OCR-only crop without row-by-row paper straightening. This avoids
  // horizontal slice seams crossing tiny thermal-print characters.
  function drawUnwarpedPhotoPart(model,from,to,contrast) {
    const ratio=model.detected ? 1/model.ratio : 1;
    let minLeft=Infinity,maxRight=-Infinity;
    if(model.detected){
      for(let n=0;n<=18;n++){
        const y=from+(to-from)*n/18;
        const p=paperBounds(model,y);
        minLeft=Math.min(minLeft,p.left);
        maxRight=Math.max(maxRight,p.right);
      }
    }else{
      minLeft=0;maxRight=model.image.naturalWidth;
    }
    const left=Math.max(0,(minLeft-17)*ratio);
    const top=Math.max(0,from*ratio);
    const width=Math.min(model.image.naturalWidth-left,(maxRight-minLeft+34)*ratio);
    const height=Math.min(model.image.naturalHeight-top,(to-from)*ratio);
    const canvas=document.createElement('canvas');
    const scale=Math.min(3.5,1500/Math.max(1,width));
    canvas.width=Math.max(1,Math.round(width*scale));
    canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality='high';
    ctx.filter='grayscale(1) contrast('+contrast+')';
    ctx.drawImage(model.image,left,top,width,height,0,0,canvas.width,canvas.height);
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
      // An extra unwarped header read also cross-checks the odometer,
      // where tiny 8/6 digits are frequently confused.
      const needsHeader=!data.date||!data.plate||!data.vendor||data.km!==null;
      const needsItems=!data.items.length ||
        (data.items.length===1 && /(?:ölwechsel|olwechsel)/i.test(data.items[0].name));
      if(model.detected && (needsHeader || needsItems || data.amount===null)){
        await worker.setParameters({tessedit_pageseg_mode:'6'});
        const sections=[];
        if(needsHeader)sections.push({start:model.top,end:model.top+length*.38,kind:'Kopfbereich'});
        if(needsItems)sections.push({start:model.top+length*.48,end:model.top+length*.81,kind:'Artikel'});
        if(data.amount===null)sections.push({start:model.top+length*.68,end:model.bottom,kind:'Endbetrag'});
        for(const section of sections){
          // Keep the paper at its natural perspective in this pass. Letter
          // contours are much cleaner without per-8-pixel drawImage seams.
          const canvas=drawUnwarpedPhotoPart(model,section.start,section.end,1.9);
          setStatus('Zusätzliche Erkennung: '+section.kind+' …');
          try {
            const result=await worker.recognize(canvas);
            const extra=result.data && result.data.text || '';
            if(!extra.trim())continue;
            if(section.kind==='Kopfbereich'){
              combined=extra+'\n'+combined;
            } else if(section.kind==='Artikel'){
              // Keep the separate OCR in the original text for debugging;
              // extractItemLines() can read article lines independently of
              // accidental summary text in an earlier OCR section.
              combined+='\n' + extra;
            } else {
              combined+='\n'+extra;
            }
          } finally {canvas.width=0;canvas.height=0;}
        }
        // For tiny article text, sparse-line recognition sometimes works
        // better than block recognition. Only retry if the previous pass
        // still did not produce any real article rows.
        if(needsItems && !parse(combined).items.length){
          await worker.setParameters({tessedit_pageseg_mode:'11'});
          const canvas=drawUnwarpedPhotoPart(model,
            model.top+length*.52,model.top+length*.77,1.35);
          setStatus('Artikeltexte werden einzeln gelesen …');
          try {
            const result=await worker.recognize(canvas);
            const extra=result.data && result.data.text || '';
            if(extra.trim())combined+='\n'+extra;
          } finally {canvas.width=0;canvas.height=0;}
        }
      }
      // Read tax summary and odometer from their own zones instead of
      // replacing already-correct amounts with new whole-document OCR text.
      const base=parse(combined);
      const supplements=[];
      const windows=[];
      if(model.detected && (base.netAmount===null || base.taxAmount===null)) {
        windows.push({kind:'finance',from:.56,to:.75,contrast:1.55});
        windows.push({kind:'finance',from:.61,to:.82,contrast:1.9});
      }
      if(model.detected && base.km===null) {
        windows.push({kind:'mileage',from:.18,to:.39,contrast:1.55});
        windows.push({kind:'mileage',from:.20,to:.43,contrast:1.95});
      }
      if(windows.length){
        await worker.setParameters({tessedit_pageseg_mode:'6'});
        for(const w of windows){
          const canvas=drawUnwarpedPhotoPart(model,model.top+length*w.from,
            model.top+length*w.to,w.contrast);
          setStatus('Zusatzprüfung für '+(w.kind==='finance'?'Netto und MwSt.':'Kilometerstand')+' …');
          try {
            const recognized=await worker.recognize(canvas);
            const txt=recognized.data && recognized.data.text || '';
            if(txt.trim())supplements.push({kind:w.kind,text:txt});
          } finally {canvas.width=0;canvas.height=0;}
        }
      }
      return {text:combined,supplements};
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
      const readResult=isPdf?await scanPdf(file,update):await scanImage(file,update);
      if(number!==scanSerial || file!==window.ECB_CURRENT_RECEIPT_FILE)return;
      const raw=typeof readResult==='string'?readResult:readResult.text;
      const supplements=typeof readResult==='string'?[]:readResult.supplements||[];
      const debug=el('receipt-ocr-debug');
      const rawNode=el('receipt-ocr-raw');
      if(debug)debug.classList.remove('hidden');
      if(rawNode)rawNode.value=(String(raw||'')+
        supplements.map(s=>'\n\n--- '+(s.kind==='finance'?'Netto/MwSt.':'KM')+
          ' Zusatzlesung ---\n'+s.text).join('')).slice(0,12000);
      const extracted=mergeReceiptEvidence(parse(raw),supplements);
      let detected=0;
      if(extracted.vendor) {el('receipt-vendor').value=extracted.vendor;detected++;}
      // Never replace a manually checked value with a missing OCR date.
      if(extracted.date) {el('receipt-date').value=extracted.date;detected++;}
      if(extracted.amount!==null) {el('receipt-amount').value=extracted.amount.toFixed(2);detected++;}
      if(extracted.netAmount!==null) {el('receipt-net').value=extracted.netAmount.toFixed(2);detected++;}
      if(extracted.taxAmount!==null) {el('receipt-vat').value=extracted.taxAmount.toFixed(2);detected++;}
      if(extracted.km!==null) {el('receipt-km').value=String(extracted.km);detected++;}
      let plateMatched=false;
      const vehicleSelect=el('receipt-vehicle');
      if(vehicleSelect && !vehicleSelect.value){
        const normalizePlate=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
        const desired=extracted.plate?normalizePlate(extracted.plate):'';
        const rawNormalized=normalizePlate(raw);
        const matches=Array.from(vehicleSelect.options).filter(option=>{
          if(!option.value)return false;
          const candidate=normalizePlate(option.textContent);
          // Match OCR plate directly first; when its label was unreadable,
          // match only one exact fleet plate appearing in OCR text.
          return candidate.length>=6 &&
            ((desired && candidate===desired) || (!desired && rawNormalized.includes(candidate)));
        });
        if(matches.length===1){
          vehicleSelect.value=matches[0].value;
          plateMatched=true;
          detected++;
        }
      }
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
        if(!extracted.date)missing.push('Belegdatum');
        if(extracted.amount===null)missing.push('Endbetrag');
        if(!extracted.items.length)missing.push('Artikelpositionen');
        else if(extracted.items.length===1 &&
          /(?:ölwechsel|olwechsel)/i.test(extracted.items[0].name))
          missing.push('weitere Positionen (z. B. Ölfilter) auf dem Original prüfen');
        if(extracted.totalDerived)missing.push('Gesamtbetrag wurde berechnet – bitte am Original prüfen');
        if(extracted.kmUncertain)missing.push('Kilometerstand widersprüchlich – bitte manuell prüfen');
        if(!plateMatched && !vehicleSelect?.value)missing.push('Fahrzeug (bitte auswählen)');
        show('Erkannt: '+[
          extracted.vendor?'Händler':'',
          extracted.date?'Datum':'',
          extracted.amount!==null?(extracted.totalDerived?'Endbetrag berechnet':'Endbetrag'):'',
          extracted.netAmount!==null?(extracted.netCalculated?'Netto berechnet':'Netto erkannt'):'',
          extracted.taxAmount!==null?'MwSt.':'',
          extracted.km!==null?'Kilometerstand':'',
          plateMatched?'Fahrzeug zugeordnet':'',
          extracted.items.length?extracted.items.length+' Artikel':''
        ].filter(Boolean).join(', ')+'. '+
        (missing.length ? 'Nicht zuverlässig erkannt: '+missing.join(', ')+'. Bitte selbst ergänzen. ' : '')+
        'Alle Daten und Preise mit dem Originalbeleg vergleichen und bestätigen.',missing.length>0);
      } else {
        show('Aus diesem Beleg konnten keine sicheren Daten erkannt werden. Bitte Felder manuell eintragen und im Bereich „Erkannten Text“ prüfen, was lesbar war.',true);
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

  // OCR only the item table on a long receipt, without changing already
  // verified totals, dates, merchant names or vehicle assignments.
  // Combine independent OCR passes rather than selecting just the best crop.
  // The oil change may be legible in one crop and its filter in another.
  function mergeReceiptItems(previous,newItems,preferPrevious) {
    const result=[];
    function key(item) {
      const name=String(item.name || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
        .replace(/[^a-z0-9]+/g,' ').trim();
      if(/(?:^|\s)(?:5w\s*30|5w\s*40|0w\s*30)(?:\s|$)/.test(name))
        return name.replace(/^(?:olwechsel|oelwechsel|motorol)\s+/,'').replace(/\s+/g,'');
      if (/^(olwechsel|olfilter|motorol)(?:\s|$)/.test(name)){
        const tokens=name.split(' ');
        const numbers=name.match(/\b(?:w\s?\d{3,5}|\d{4,})\b/g);
        return tokens[0]+':'+(numbers&&numbers.length?numbers.join(','):'');
      }
      return name.replace(/\s+/g,'');
    }
    function quality(item) {
      return (item.amount!==null && Number.isFinite(item.amount) ? 5 : 0)+
        (String(item.name).length > 14 ? 2 : 0);
    }
    for(const item of [].concat(previous||[],newItems||[])){
      if(!item || !item.name || result.length>=MAX_ITEMS)continue;
      const normalized=key(item);
      const found=result.findIndex(x=>key(x)===normalized);
      if(found<0)result.push({...item});
      else if(preferPrevious){
        if(result[found].amount===null && item.amount!==null)
          result[found].amount=item.amount;
      }else if(quality(item)>quality(result[found]))result[found]={...item};
    }
    return result;
  }
  async function scanItemsOnly(file) {
    if(!file || !file.size) {
      show('Bitte zuerst ein Belegfoto oder eine PDF-Datei auswählen.',true);
      return;
    }
    const current=++scanSerial;
    const retry=el('receipt-ocr-retry');
    const itemsButton=el('receipt-ocr-items');
    const save=el('receipt-save-btn');
    if(retry)retry.disabled=true;
    if(itemsButton)itemsButton.disabled=true;
    if(save)save.disabled=true;
    const update=message=>{if(current===scanSerial)show(message,false);};
    let worker=null;
    try {
      const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
      if(isPdf) {
        // PDFs are usually laid out differently; use their searchable
        // text rather than the thermal-paper photo-specific crop.
        const raw=await scanPdf(file,update);
        if(current!==scanSerial || file!==window.ECB_CURRENT_RECEIPT_FILE)return;
        const rows=parse(raw).items;
        if(!rows.length)throw new Error('Keine eindeutig lesbaren Artikelpositionen im PDF.');
        clearRows();rows.forEach(addItem);
        const description=el('receipt-description');
        if(description && !description.value.trim()) description.value=
          rows.slice(0,3).map(x=>x.name).join(', ').slice(0,240);
        show(rows.length+' Artikelpositionen erkannt. Bitte alle Bezeichnungen und Preise prüfen.',false);
        return;
      }
      update('Artikelbereich wird aus dem Kassenbon ausgeschnitten …');
      const model=await preparePhoto(file);
      const length=model.bottom-model.top;
      worker=await newOcrWorker(update);
      await worker.setParameters({tessedit_pageseg_mode:'6'});
      const parts=[];
      // Overlapping small windows avoid unrelated paragraphs/summary text.
      // The sections also work with perspective-corrected paper detection.
      const windows=[
        [.51,.67,1.65],
        [.57,.74,1.85],
        [.47,.77,1.55]
      ];
      let best=[];
      for (let i=0;i<windows.length;i++) {
        if(current!==scanSerial || file!==window.ECB_CURRENT_RECEIPT_FILE)return;
        const [start,end,contrast]=windows[i];
        const canvas=drawUnwarpedPhotoPart(model,model.top+length*start,
          model.top+length*end,contrast);
        update('Artikelbereich wird gesondert gelesen ('+(i+1)+'/'+windows.length+') …');
        let raw='';
        try {
          const result=await worker.recognize(canvas);
          raw=result.data && result.data.text || '';
        } finally { canvas.width=0;canvas.height=0; }
        parts.push(raw);
        const items=parse(raw).items;
        best=mergeReceiptItems(best,items,false);
        // Continue to the next overlapping crop even if an oil change was
        // found; the filter code often appears only in a different crop.
      }
      if(!best.length) {
        await worker.setParameters({tessedit_pageseg_mode:'11'});
        const canvas=drawUnwarpedPhotoPart(model,model.top+length*.50,
          model.top+length*.72,1.3);
        update('Letzter Versuch mit zeilenweiser Artikelerkennung …');
        try {
          const result=await worker.recognize(canvas);
          const raw=result.data && result.data.text || '';
          parts.push(raw);
          best=mergeReceiptItems(best,parse(raw).items,false);
        } finally {canvas.width=0;canvas.height=0;}
      }
      if(current!==scanSerial || file!==window.ECB_CURRENT_RECEIPT_FILE)return;
      const originalNode=el('receipt-ocr-raw');
      const debug=el('receipt-ocr-debug');
      if(originalNode)originalNode.value=(originalNode.value || '')+
        '\n\n--- Artikel separat ausgelesen ---\n'+parts.join('\n--- Nächster Ausschnitt ---\n');
      if(debug)debug.classList.remove('hidden');
      if(best.length){
        let existing=[];
        try {existing=collect();}
        catch(error) {
          show('Bitte einen bereits eingetragenen, unvollständigen Artikel zuerst korrigieren. Die bisherigen Positionen wurden nicht verändert.',true);
          return;
        }
        const merged=mergeReceiptItems(existing,best,true);
        clearRows();
        merged.forEach(addItem);
        const description=el('receipt-description');
        if(description && !description.value.trim()) description.value=
          merged.slice(0,3).map(x=>x.name).join(', ').slice(0,240);
        // The review checkbox is reset after new automatic entries.
        const review=el('receipt-ocr-review');
        const wrapper=el('receipt-ocr-review-wrap');
        if(review)review.checked=false;
        if(wrapper)wrapper.classList.remove('hidden');
        const potentiallyMissing=merged.length===1 &&
          /(?:ölwechsel|olwechsel)/i.test(merged[0].name);
        show(merged.length+' Artikelpositionen in der Maske. '+(
          potentiallyMissing?'Weitere Positionen (z. B. Filter) konnten nicht sicher erkannt werden. Bitte am Originalbeleg prüfen und ergänzen. ':
          'Positionen aus mehreren Bildausschnitten zusammengeführt. Bitte Vollständigkeit und Preise prüfen. ')+
          'Andere Rechnungsdaten wurden nicht geändert.',potentiallyMissing);
      } else {
        show('Auch im separaten Ausschnitt sind keine Artikel zuverlässig lesbar. Öffne „Erkannten Text zur Fehlersuche ansehen“ und prüfe den Abschnitt „Artikel separat ausgelesen“ – oder ergänze die Artikel manuell.',true);
      }
    } catch(error){
      if(current===scanSerial)show('Artikelerkennung fehlgeschlagen: '+
        (error && error.message || 'Unbekannter Fehler')+
        '. Die bisherigen Rechnungsdaten bleiben unverändert.',true);
    } finally {
      if(worker)await worker.terminate().catch(()=>{});
      if(current===scanSerial){
        if(retry)retry.disabled=false;
        if(itemsButton)itemsButton.disabled=false;
        if(save)save.disabled=false;
      }
    }
  }
  window.ECBReceiptOCR={scan,scanItemsOnly,reset,addItem,collect,parse};

})();
