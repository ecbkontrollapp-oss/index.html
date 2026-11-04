/* ECB Fahrzeugpapier-Erkennung — ausschließlich lokal im Browser.
   Keine Netzwerkübertragung der Bilder/PDFs für die OCR; Tesseract/PDF.js
   werden als Bibliotheken geladen, und die Datei verlässt das Gerät erst
   nach einer expliziten Bestätigung des Cloud-Speichervorgangs. */
(function(){
  'use strict';
  const MAX_BYTES=15*1024*1024;
  const state={
    vehicle:{file:null,serial:0,scanning:false,applied:{},parsed:null},
    registration:{file:null,serial:0,scanning:false,applied:{},parsed:null}
  };
  const $=id=>document.getElementById(id);
  const LABELS={
    plate:'Kennzeichen',firstRegistration:'Erstzulassung',manufacturer:'Hersteller',
    model:'Handelsbezeichnung',type:'Typ/Variante',vin:'FIN',
    hsn:'HSN',tsn:'TSN',fuel:'Kraftstoff',powerKw:'Leistung (kW)',
    displacement:'Hubraum (cm³)',color:'Farbe',seats:'Sitzplätze',
    totalMass:'zulässige Gesamtmasse (kg)',tyresFront:'Reifen vorn',
    tyresRear:'Reifen hinten',vehicleClass:'Fahrzeugklasse'
  };
  function normalize(s){return String(s||'').replace(/\u00a0/g,' ').replace(/\u2013|\u2014/g,'-').trim();}
  function normalizePlate(s){return normalize(s).toUpperCase().replace(/[^A-Z0-9]/g,'');}
  function sanitizeText(value,max=80){
    return normalize(value).replace(/[\r\n\t]/g,' ').replace(/\s{2,}/g,' ').slice(0,max);
  }
  // Only copy a colour into the form when it is a plausible official
  // vehicle colour. OCR fragments such as "[ul =" must remain blank.
  function colorValue(raw){
    const value=sanitizeText(raw,40).toUpperCase().replace(/\s+/g,' ').trim();
    const core=value.replace(/^\d{1,2}\s*[-:.,/]?\s*/,'');
    const normalized=core.replace(/Ä/g,'AE').replace(/Ö/g,'OE').replace(/Ü/g,'UE');
    if(!/^(?:WEISS|SCHWARZ|GRAU|BLAU|ROT|GRUEN|GELB|BRAUN|SILBER|GOLD|BEIGE|ORANGE|VIOLETT|ROSA|LILA|ANTHRAZIT|MEHRFARBIG|SONSTIGE|UNBEKANNT)(?:[ -](?:METALLIC|PERLEFFEKT|MATT))?$/.test(normalized))return '';
    return core;
  }
  function dateValue(text){
    const m=String(text||'').match(/\b([0-3]?\d)[./-]([01]?\d)[./-](19\d{2}|20\d{2}|21\d{2})\b/);
    if(!m)return '';
    const day=+m[1],month=+m[2],year=+m[3];
    const d=new Date(Date.UTC(year,month-1,day));
    if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day||year>new Date().getFullYear()+1)return '';
    return year+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
  }
  function parse(text){
    const lines=String(text||'').split(/\r?\n/).map(normalize).filter(Boolean).slice(0,500);
    const cleanCode=code=>code.replace(/[.]/g,'\\s*[.,]\\s*').replace(/[+]/g,'\\+');
    const known=['A','B','D.1','D.2','D.3','E','P.1','P.2','P.3','F.2','R','S.1','J','2.1','2.2','15.1','15.2'];
    function looksLikeLabel(line){
      return known.some(code=>new RegExp('^\\s*\\(?\\s*'+cleanCode(code)+'\\s*\\)?\\s*(?:[:=]|\\s|$)','i').test(line))||
        /^(?:Amtliches Kennzeichen|FIN|Fahrzeug.ident|HSN|TSN|Erstzulassung|Sitzpl[aä]tze)/i.test(line);
    }
    const synonyms={
      'A':['Amtliches Kennzeichen','Kennzeichen'],
      'B':['Datum der Erstzulassung','Erstzulassung'],
      'D.1':['Marke'],
      'D.3':['Handelsbezeichnung'],
      'E':['FIN','Fahrzeug-Identifizierungsnummer','Fahrzeugidentifizierungsnummer'],
      '2.1':['HSN','Herstellerschl[üu]sselnummer'],
      '2.2':['TSN','Typschl[üu]sselnummer'],
      'P.3':['Kraftstoffart'],
      'R':['Farbe'],
      'S.1':['Sitzpl[aä]tze']
    };
    const field=(code)=>{
      const aliases=[code,...(synonyms[code]||[])];
      const values=[];
      for(let i=0;i<lines.length;i++){
        let remainder=null;
        for(const name of aliases){
          const prefix=/^[A-Za-z0-9.]+$/.test(name)?'(?:\\(\\s*)?'+cleanCode(name)+'(?:\\s*\\))?':name;
          const rx=new RegExp('^\\s*'+prefix+'(?=\\s|:|=|-|$)\\s*[:=\\-]?\\s*','i');
          const match=lines[i].match(rx);
          if(match){remainder=lines[i].slice(match[0].length).trim();break;}
        }
        if(remainder===null)continue;
        // Ignore explanatory captions directly after the field code.
        if(/^(?:Datum der Erstzulassung|Handelsbezeichnung|Kraftstoffart|Leistung|Hersteller|Fahrzeug|Kennzeichen|Marke|Typ|Sitzpl[aä]tze|Farbe|Hubraum)(?:\s|$)/i.test(remainder)
          && remainder.split(/\s+/).length<=4)remainder='';
        if(remainder && !looksLikeLabel(remainder))values.push(remainder);
        else if(i+1<lines.length&&!looksLikeLabel(lines[i+1])&&lines[i+1].length<80)
          values.push(lines[i+1]);
      }
      return values;
    };
    const first=code=>field(code)[0]||'';
    const vinPattern=/\b[A-HJ-NPR-Z0-9]{17}\b/g;
    function validVin(s){
      const clean=s.toUpperCase().replace(/[^A-Z0-9]/g,'');
      return /^[A-HJ-NPR-Z0-9]{17}$/.test(clean)?clean:'';
    }
    let vin=validVin(first('E'));
    if(!vin){
      const nearby=lines.filter((line,i)=>/^\s*(?:E|FIN|Fahrzeug.ident)/i.test(line)||/Fahrgestell/i.test(line)).join(' ').toUpperCase();
      vin=(nearby.match(vinPattern)||[])[0]||'';
    }
    const platePattern=/\b([A-ZÄÖÜ]{1,3})\s*[-\s]\s*([A-ZÄÖÜ]{1,2})\s*[-\s]?\s*(\d{1,4})(?:\s*[EH])?\b/i;
    function plateFrom(value){
      const m=String(value||'').match(platePattern);
      return m?(m[1]+'-'+m[2]+' '+m[3]).toUpperCase():'';
    }
    let plate=plateFrom(first('A'));
    if(!plate){
      for(let i=0;i<lines.length;i++){
        if(/Kennzeichen|^\s*\(?A\)?\s*[:=]/i.test(lines[i])){
          plate=plateFrom(lines[i]+' '+(lines[i+1]||''));
          if(plate)break;
        }
      }
    }
    const hsnCandidate=first('2.1').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const tsnCandidate=first('2.2').toUpperCase().replace(/[^A-Z0-9]/g,'');
    const hsn=/^\d{4}$/.test(hsnCandidate)?hsnCandidate:'';
    const tsn=/^[A-Z0-9]{3,12}$/.test(tsnCandidate)?tsnCandidate:'';
    const maker=sanitizeText(first('D.1'),45).replace(/^(?:Marke|Hersteller)\s*[:=-]?\s*/i,'');
    const trade=sanitizeText(first('D.3'),65);
    const variant=sanitizeText(first('D.2'),65);
    const number=code=>{
      const raw=first(code).replace(/\s/g,'');
      const m=raw.match(/^(\d{1,6})(?:[,.]\d+)?(?:\/|$|\b)/);
      return m&&Number(m[1])>0?m[1]:'';
    };
    function tyre(s){
      const m=String(s||'').match(/\b\d{3}\s*\/\s*\d{2,3}\s*[Rr]\s*\d{2}\s*(?:\d{2,3}\s*[A-Z])?/);
      return m?sanitizeText(m[0].replace(/\s+/g,' '),40):'';
    }
    const data={
      plate,firstRegistration:dateValue(first('B')),manufacturer:maker,
      model:trade,type:variant,vin,hsn,tsn,
      fuel:sanitizeText(first('P.3'),50),
      powerKw:number('P.2'),displacement:number('P.1'),
      color:colorValue(first('R')),seats:number('S.1'),
      totalMass:number('F.2'),tyresFront:tyre(first('15.1')),
      tyresRear:tyre(first('15.2')),vehicleClass:sanitizeText(first('J'),30)
    };
    // Do not read holder name/address (C.*); an actual registration
    // certificate contains personal details unrelated to fleet maintenance.
    const keys=Object.keys(data).filter(k=>data[k]);
    return {data,keys,raw:String(text||''),confidence:keys.length>=3?'review':'low'};
  }
  const ids={
    vehicle:{plate:'fleet-input-plate',manufacturer:'fleet-input-manufacturer',
      model:'fleet-input-model',type:'fleet-input-type',
      firstRegistration:'fleet-input-first-registration',vin:'fleet-input-vin',
      hsn:'fleet-input-hsn',tsn:'fleet-input-tsn',fuel:'fleet-input-fuel',
      powerKw:'fleet-input-power',displacement:'fleet-input-displacement',
      color:'fleet-input-color',seats:'fleet-input-seats',totalMass:'fleet-input-weight',
      tyresFront:'fleet-input-tyres-front',tyresRear:'fleet-input-tyres-rear',
      vehicleClass:'fleet-input-class'},
    registration:{plate:'registration-plate',manufacturer:'registration-manufacturer',
      model:'registration-model',type:'registration-type',
      firstRegistration:'registration-first-registration',vin:'registration-vin',
      hsn:'registration-hsn',tsn:'registration-tsn',fuel:'registration-fuel',
      powerKw:'registration-power',displacement:'registration-displacement',
      color:'registration-color',seats:'registration-seats',totalMass:'registration-weight',
      tyresFront:'registration-tyres-front',tyresRear:'registration-tyres-rear',
      vehicleClass:'registration-class'}
  };
  function collect(mode){
    const out={};
    Object.entries(ids[mode]||{}).forEach(([key,id])=>{
      const e=$(id);
      if(e&&String(e.value||'').trim())out[key]=sanitizeText(e.value,140);
    });
    return out;
  }
  function setStatus(mode,message,error){
    const node=$(mode==='vehicle'?'vehicle-ocr-status':'registration-ocr-status');
    if(!node)return;
    node.className='p-2.5 rounded-xl border text-[11px] '+(error?
      'bg-rose-50 border-rose-200 text-rose-800':'bg-emerald-50 border-emerald-200 text-emerald-900');
    node.textContent=message;
  }
  function reset(mode){
    const st=state[mode];
    if(!st)return;
    st.serial++;st.file=null;st.scanning=false;st.applied={};st.parsed=null;
    const status=$(mode==='vehicle'?'vehicle-ocr-status':'registration-ocr-status');
    if(status){status.textContent='';status.classList.add('hidden');}
    const check=$(mode==='vehicle'?'vehicle-ocr-review':'registration-ocr-review');
    if(check)check.checked=false;
    const wrap=$(mode==='vehicle'?'vehicle-ocr-review-wrap':'registration-ocr-review-wrap');
    if(wrap)wrap.classList.add('hidden');
    const textNode=$(mode==='vehicle'?'vehicle-ocr-selected-file':'registration-selected-file');
    if(textNode)textNode.textContent='Noch keine Datei ausgewählt. Maximal 15 MB.';
    if(mode==='vehicle'){
      for(const id of ['vehicle-camera-input','vehicle-document-input']){
        const node=$(id);if(node)node.value='';
      }
    }
  }
  function getFile(mode){return state[mode]&&state[mode].file||null;}
  function canSave(mode){
    const st=state[mode];
    if(!st||st.scanning)return false;
    if(!st.file)return true;
    const check=$(mode==='vehicle'?'vehicle-ocr-review':'registration-ocr-review');
    return !!check&&check.checked;
  }
  function validateParsed(result){
    const d=result.data||{};
    d.color=colorValue(d.color);
    for(const [key,max] of Object.entries({
      powerKw:1000,displacement:20000,seats:100,totalMass:200000
    })){
      const value=String(d[key]||'');
      if(value && (!/^\d{1,6}$/.test(value)||Number(value)<1||Number(value)>max))d[key]='';
    }
    if(d.plate&&!/^[A-ZÄÖÜ]{1,3}-[A-ZÄÖÜ]{1,2} \d{1,4}[EH]?$/.test(d.plate))d.plate='';
    if(d.vin&&!/^[A-HJ-NPR-Z0-9]{17}$/.test(d.vin))d.vin='';
    if(d.hsn&&!/^\d{4}$/.test(d.hsn))d.hsn='';
    if(d.tsn&&!/^[A-Z0-9]{3,12}$/.test(d.tsn))d.tsn='';
    if(d.fuel&&!/^(?:DIESEL|BENZIN|ELEKTRO|HYBRID|CNG|LPG|ERDGAS|FLÜSSIGGAS|FLUESSIGGAS|WASSERSTOFF|AUTOGAS)(?:\b|\/)/i.test(d.fuel))d.fuel='';
    if(d.vehicleClass&&!/^(?:M[1-3]|N[1-3]|O[1-4]|L\d[A-Z]?)$/i.test(d.vehicleClass))d.vehicleClass='';
    result.keys=Object.keys(d).filter(key=>d[key]);
    return result;
  }
  function copyParsed(mode,result){
    const st=state[mode];
    for(const [key,id] of Object.entries(ids[mode])){
      const node=$(id);if(!node)continue;
      const value=result.data[key];
      if(st.applied[id]!==undefined && node.value===st.applied[id])node.value='';
      if(value){
        // Avoid overwriting values which the employee has typed manually.
        if(!node.value){node.value=value;st.applied[id]=value;}
      }
    }
    st.parsed=result;
    const list=result.keys.map(k=>LABELS[k]||k).join(', ');
    const missing=['plate','model','color'].filter(key=>!result.data[key]);
    const warning=missing.length?' Nicht sicher erkannt: '+missing.map(k=>LABELS[k]||k).join(', ')+'. Bitte manuell ergänzen.':'';
    setStatus(mode,result.keys.length?
      'Lokal ausgelesen: '+list+'.'+warning+' Alle Daten am Original prüfen. Noch NICHT hochgeladen.':
      'Keine verlässlichen Fahrzeugdaten erkannt. Bitte manuell eintragen. Noch NICHT hochgeladen.',
      !result.keys.length);
  }
  const scriptLoading={};
  function loadScript(url,globalName){
    if(window[globalName])return Promise.resolve(window[globalName]);
    if(scriptLoading[globalName])return scriptLoading[globalName];
    scriptLoading[globalName]=new Promise((resolve,reject)=>{
      const tag=document.createElement('script');tag.src=url;tag.async=true;
      tag.onload=()=>window[globalName]?resolve(window[globalName]):reject(Error('Bibliothek nicht geladen'));
      tag.onerror=()=>reject(Error('OCR-Bibliothek konnte nicht geladen werden. Internet prüfen.'));
      document.head.appendChild(tag);
    }).catch(e=>{delete scriptLoading[globalName];throw e});
    return scriptLoading[globalName];
  }
  async function workerFor(status){
    const lib=await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js','Tesseract');
    const worker=await lib.createWorker('deu+eng',1,{
      logger:e=>{if(e&&e.status==='recognizing text'&&e.progress>=0)
        status('Texterkennung: '+Math.round(e.progress*100)+' %');}
    });
    await worker.setParameters({preserve_interword_spaces:'1',tessedit_pageseg_mode:'3'});
    return worker;
  }
  function imageCanvas(image){
    const width=image.naturalWidth,height=image.naturalHeight;
    const scale=Math.min(2.5,2300/width,2700/height);
    const canvas=document.createElement('canvas');
    canvas.width=Math.round(width*scale);
    canvas.height=Math.round(height*scale);
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.filter='grayscale(1) contrast(1.45)';
    ctx.drawImage(image,0,0,canvas.width,canvas.height);
    ctx.filter='none';
    return canvas;
  }
  async function readImage(file,status){
    const url=URL.createObjectURL(file);
    let image;
    try{
      image=await new Promise((res,rej)=>{
        const img=new Image();
        img.onload=()=>res(img);
        img.onerror=()=>rej(Error('Foto konnte nicht geöffnet werden. Bitte JPG/PNG oder ein PDF verwenden.'));
        img.src=url;
      });
    }finally{URL.revokeObjectURL(url);}
    const canvas=imageCanvas(image);
    const worker=await workerFor(status);
    try{
      status('Fahrzeugschein wird lokal gelesen …');
      await worker.setParameters({tessedit_pageseg_mode:'11'});
      const result=await worker.recognize(canvas);
      const text=result.data&&result.data.text||'';
      const cells=window.ECBRegistrationLayout?
        await window.ECBRegistrationLayout.scan(image,worker,status):{};
      return {text,cells};
    }finally{canvas.width=0;canvas.height=0;await worker.terminate();}
  }
  function pdfText(items){
    const groups=[];
    for(const item of items){
      const str=String(item.str||'').trim();if(!str)continue;
      const x=Number(item.transform&&item.transform[4])||0;
      const y=Number(item.transform&&item.transform[5])||0;
      let group=groups.find(g=>Math.abs(g.y-y)<2.5);
      if(!group){group={y,items:[]};groups.push(group);}
      group.items.push({x,str});
    }
    groups.sort((a,b)=>b.y-a.y);
    return groups.map(g=>g.items.sort((a,b)=>a.x-b.x).map(x=>x.str).join(' ')).join('\n');
  }
  async function readPDF(file,status){
    const lib=await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js','pdfjsLib');
    lib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf=await lib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    const chunks=[];let worker=null;let cells={};
    try {
      const pagesToRead=Math.min(4,pdf.numPages);
      const pageInfo=[];
      for(let n=1;n<=pagesToRead;n++){
        const p=await pdf.getPage(n);
        const v=p.getViewport({scale:1});
        pageInfo.push({n,ratio:v.width/v.height});
      }
      // Two-page German vehicle documents often show their reverse in
      // portrait and the data-bearing front in landscape. Never stop
      // after OCR of the back's printed field explanations.
      const front=pageInfo.filter(p=>p.ratio>1.58&&p.ratio<2.62);
      const pageNumbers=front.length?front.map(p=>p.n):pageInfo.map(p=>p.n);
      for(const n of pageNumbers){
        status('PDF-Seite '+n+'/'+pdf.numPages+' wird lokal ausgelesen …');
        const page=await pdf.getPage(n);
        const content=await page.getTextContent();
        let text=pdfText(content.items||[]);
        const raw=page.getViewport({scale:1});
        const isFront=raw.width/raw.height>1.58 && raw.width/raw.height<2.62;
        if(text.replace(/\s/g,'').length<75 || isFront){
          if(!worker)worker=await workerFor(status);
          const scale=Math.min(3.8,2600/raw.width,2800/raw.height);
          const viewport=page.getViewport({scale:Math.max(.7,scale)});
          const canvas=document.createElement('canvas');
          canvas.width=Math.ceil(viewport.width);
          canvas.height=Math.ceil(viewport.height);
          const ctx=canvas.getContext('2d');
          ctx.fillStyle='#fff';
          ctx.fillRect(0,0,canvas.width,canvas.height);
          try{
            await page.render({canvasContext:ctx,viewport}).promise;
            await worker.setParameters({tessedit_pageseg_mode:'11'});
            const recognition=await worker.recognize(canvas);
            text+='\n'+(recognition.data&&recognition.data.text||'');
            if(isFront && window.ECBRegistrationLayout){
              const found=await window.ECBRegistrationLayout.scan(canvas,worker,status);
              if(Object.keys(found).length)cells={...cells,...found};
            }
          }finally{
            canvas.width=0;canvas.height=0;
          }
        }
        chunks.push(text);
        if(page.cleanup)page.cleanup();
      }
      return {text:chunks.join('\n'),cells};
    }finally{
      if(worker)await worker.terminate();
      if(pdf.destroy)await pdf.destroy();
    }
  }
  async function scan(mode){
    const st=state[mode];if(!st||!st.file)return;
    const file=st.file;const serial=++st.serial;
    st.scanning=true;
    const button=$(mode==='vehicle'?'vehicle-ocr-scan':'registration-ocr-scan');
    if(button)button.disabled=true;
    const status=message=>{if(serial===st.serial)setStatus(mode,message,false);};
    try{
      const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
      const outcome=isPdf?await readPDF(file,status):await readImage(file,status);
      if(serial!==st.serial||file!==st.file)return;
      const text=typeof outcome==='string'?outcome:(outcome.text||'');
      const fields=typeof outcome==='string'?{}:(outcome.cells||{});
      const parsed=parse(text);
      const extracted=window.ECBRegistrationLayout?
        window.ECBRegistrationLayout.interpret(fields,text):{};
      Object.entries(extracted).forEach(([key,value])=>{
        if(value)parsed.data[key]=value;
      });
      validateParsed(parsed);
      copyParsed(mode,parsed);
    }catch(err){
      if(serial===st.serial)setStatus(mode,'Auslesen fehlgeschlagen: '+(err.message||err)+'. Die Datei wurde nicht hochgeladen. Felder lassen sich manuell ausfüllen.',true);
    }finally{
      if(serial===st.serial){
        st.scanning=false;
        if(button)button.disabled=false;
      }
    }
  }
  function onFile(input,mode){
    const st=state[mode];if(!st)return;
    const file=input.files&&input.files[0];
    if(!file)return;
    st.serial++;st.scanning=false;st.file=null;st.parsed=null;
    const mime=file.type||'';
    if(!file.size||file.size>MAX_BYTES){setStatus(mode,'Datei muss zwischen 1 Byte und 15 MB groß sein.',true);return;}
    if(!/^image\//i.test(mime)&&mime!=='application/pdf'&&!/\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(file.name)){
      setStatus(mode,'Nur Fotos oder PDF-Dateien werden unterstützt.',true);return;
    }
    st.file=file;
    const output=$(mode==='vehicle'?'vehicle-ocr-selected-file':'registration-selected-file');
    if(output)output.textContent=file.name+' ('+(file.size/1024/1024).toFixed(2)+' MB)';
    const check=$(mode==='vehicle'?'vehicle-ocr-review':'registration-ocr-review');
    if(check)check.checked=false;
    const wrap=$(mode==='vehicle'?'vehicle-ocr-review-wrap':'registration-ocr-review-wrap');
    if(wrap)wrap.classList.remove('hidden');
    const otherId=mode==='vehicle'?(input.id==='vehicle-camera-input'?'vehicle-document-input':'vehicle-camera-input'):
      (input.id==='registration-camera-input'?'registration-file-input':'registration-camera-input');
    const other=$(otherId);if(other)other.value='';
    setStatus(mode,'Foto/PDF ausgewählt. Wird nur auf deinem Gerät ausgelesen; noch nichts hochgeladen.',false);
    scan(mode);
  }
  window.ECBRegistrationOCR={parse,scan,onFile,reset,getFile,canSave,collect,
    normalizePlate,fields:Object.keys(LABELS)};
})();
