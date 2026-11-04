/* ECB vehicle costs — cloud vehicle references are supplied by the existing
 * Firebase onSnapshot listener. No alternate storage or parallel sync.
 * All numbers are calculated from gross receipt totals (once per receipt).
 */
(function(){
  'use strict';
  let vehicles=[],mode='single',reportScope='all';
  const money=new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'});
  const integer=new Intl.NumberFormat('de-DE',{maximumFractionDigits:0});
  const $=id=>document.getElementById(id);
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const cents=n=>Number.isFinite(Number(n))?Math.round(Number(n)*100):null;
  const fmt=n=>money.format(n/100);
  const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))?s:'';
  const dateDE=s=>validDate(s)?s.slice(8,10)+'.'+s.slice(5,7)+'.'+s.slice(0,4):'Ohne Datum';
  const digits=s=>String(s||'').replace(/[^A-Za-z0-9_-]/g,'');
  const vehicleName=v=>String(v.plate||v.model||v.id||'Unbenanntes Fahrzeug');
  const infoDate=()=>new Date().toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'});
  function companyMark(){
    const canvas=document.createElement('canvas');
    canvas.width=440;canvas.height=160;
    const g=canvas.getContext('2d');
    g.fillStyle='#5ea63b';
    g.beginPath();g.roundRect(4,4,432,152,29);g.fill();
    g.fillStyle='#ffffff';g.font='italic 900 111px Arial, Helvetica, sans-serif';
    g.fillText('ecb',86,110);
    g.beginPath();g.moveTo(112,129);g.bezierCurveTo(178,108,264,146,341,121);
    g.bezierCurveTo(275,149,196,156,112,129);g.fill();
    return canvas.toDataURL('image/png');
  }
  function period() {
    const from=$('cost-from')?.value||'';
    const to=$('cost-to')?.value||'';
    if(from&&to&&from>to)throw Error('Der Zeitraum ist ungültig: Von liegt nach Bis.');
    return {from,to};
  }
  function selection(){
    const selected=$('cost-vehicle')?.value||'';
    if(mode==='single'){
      const vehicle=vehicles.find(v=>v.id===selected)||vehicles[0];
      return vehicle?[vehicle]:[];
    }
    return vehicles.slice().sort((a,b)=>vehicleName(a).localeCompare(vehicleName(b),'de'));
  }
  function normalizedRows(v,{from,to}){
    const rows=[];
    const seen=new Set();
    const filtered=date=>!(from||to)||((!from||date>=from)&&(!to||date<=to));
    (Array.isArray(v.belege)?v.belege:[]).forEach((r,index)=>{
      const date=validDate(r.date);
      if(!filtered(date))return;
      const key=r.id||r.storagePath;
      if(key&&seen.has('receipt:'+key))return;
      if(key)seen.add('receipt:'+key);
      const amount=r.amount==null||r.amount===''?null:cents(r.amount);
      const net=r.netAmount==null||r.netAmount===''?null:cents(r.netAmount);
      const tax=r.taxAmount==null||r.taxAmount===''?null:cents(r.taxAmount);
      rows.push({
        source:'beleg',id:String(r.id||''),vehicleId:String(v.id||''),vehicle:vehicleName(v),
        model:String(v.model||''),date,type:String(r.kind||'Rechnung'),
        company:String(r.vendor||''),title:String(r.description||r.kind||'Beleg'),
        gross:amount,net,tax,fileName:String(r.fileName||''),storagePath:String(r.storagePath||''),
        items:Array.isArray(r.items)?r.items.slice(0,100).map(p=>({
          name:String(p.name||''),qty:Number(p.quantity)||1,
          price:p.amount===null||p.amount===undefined||p.amount===''?null:cents(p.amount)
        })):[],notes:String(r.notes||''),km:r.kmAtReceipt
      });
    });
    (Array.isArray(v.reparaturen)?v.reparaturen:[]).forEach((r,index)=>{
      const date=validDate(r.date);
      if(!filtered(date))return;
      const key=r.id;
      if(key&&seen.has('repair:'+key))return;
      if(key)seen.add('repair:'+key);
      // Repair records are informational unless an independently incurred
      // cost was explicitly entered. Never count an invoice twice.
      const cost=(r.costSeparate===true && r.cost!==null && r.cost!=='' &&
        r.cost!==undefined)?cents(r.cost):null;
      rows.push({
        source:'reparatur',id:String(r.id||''),vehicleId:String(v.id||''),vehicle:vehicleName(v),
        model:String(v.model||''),date,type:'Reparatur',
        company:'',title:String(r.title||'Reparatur'),gross:cost,net:null,tax:null,
        fileName:'',storagePath:'',items:Array.isArray(r.points)?r.points.map(p=>({
          name:String(p.label||''),qty:1,price:null
        })):[],notes:String(r.notes||''),km:r.km,status:String(r.status||'')
      });
    });
    rows.sort((a,b)=>(b.date||'').localeCompare(a.date||'')||a.type.localeCompare(b.type,'de'));
    return rows;
  }
  function summary(car,range){
    const rows=normalizedRows(car,range);
    const receipts=rows.filter(r=>r.source==='beleg');
    const repairs=rows.filter(r=>r.source==='reparatur');
    const gross=rows.reduce((s,r)=>s+(r.gross||0),0);
    const net=receipts.reduce((s,r)=>s+(r.net||0),0);
    const tax=receipts.reduce((s,r)=>s+(r.tax||0),0);
    const missing=receipts.filter(r=>r.gross===null).length;
    const receiptGross=receipts.reduce((s,r)=>s+(r.gross||0),0);
    const extraRepairCost=repairs.reduce((s,r)=>s+(r.gross||0),0);
    return {car,rows,gross,net,tax,receiptGross,extraRepairCost,missing,receiptCount:receipts.length,repairCount:repairs.length};
  }
  function build(){
    const range=period();
    const groups=selection().map(car=>summary(car,range));
    const allRows=groups.flatMap(g=>g.rows);
    return {groups,allRows,range,grand:groups.reduce((s,g)=>s+g.gross,0),
      totalReceipts:groups.reduce((s,g)=>s+g.receiptCount,0),
      missing:groups.reduce((s,g)=>s+g.missing,0),
      extraRepairCost:groups.reduce((s,g)=>s+g.extraRepairCost,0)};
  }
  function updateOptions() {
    const el=$('cost-vehicle');
    if(!el)return;
    const before=el.value;
    el.innerHTML=vehicles.map(v=>'<option value="'+esc(v.id)+'">'+esc(vehicleName(v))+
      (v.model?' · '+esc(v.model):'')+'</option>').join('');
    if(before&&vehicles.some(v=>v.id===before))el.value=before;
    else if(vehicles.length)el.value=vehicles[0].id;
    el.disabled=!vehicles.length||mode!=='single';
    const a=$('cost-single'),b=$('cost-all');
    if(a){a.className='px-3 py-2 rounded-xl text-xs font-bold '+(mode==='single'?'bg-indigo-600 text-white':'border border-slate-200 bg-white text-slate-700');}
    if(b){b.className='px-3 py-2 rounded-xl text-xs font-bold '+(mode==='all'?'bg-indigo-600 text-white':'border border-slate-200 bg-white text-slate-700');}
  }
  function render() {
    const target=$('fleet-costs-output');if(!target)return;
    updateOptions();
    let report;
    try{report=build();}
    catch(error){target.innerHTML='<p class="text-rose-700 text-xs">'+esc(error.message)+'</p>';return;}
    if(!report.groups.length){
      target.innerHTML='<div class="p-6 text-center border-2 border-dashed rounded-xl text-slate-500 text-xs">Noch keine Fahrzeuge vorhanden. Sobald ein Fahrzeug in der Cloud angelegt wird, erscheint es hier automatisch.</div>';
      return;
    }
    const kpi=[
      ['Gesamtkosten brutto',fmt(report.grand)],
      ['Belege',integer.format(report.totalReceipts)],
      ['Ohne erfassten Betrag',integer.format(report.missing)]
    ];
    let output='<div class="grid grid-cols-3 gap-2">'+kpi.map(([k,v])=>
      '<div class="p-3 bg-slate-50 rounded-xl border border-slate-200 min-w-0"><p class="text-[10px] text-slate-500">'+esc(k)+
      '</p><p class="text-sm sm:text-base font-black text-slate-900 break-words mt-1">'+esc(v)+'</p></div>').join('')+'</div>';
    if(report.missing)output+='<p class="text-[11px] border border-amber-200 rounded-xl p-2.5 text-amber-800 bg-amber-50">'+
      esc(report.missing)+' Beleg(e) ohne Preis werden nicht in der Summe berücksichtigt. Bitte bei Bedarf nachtragen.</p>';
    if(mode==='all'){
      output+='<div class="overflow-x-auto border border-slate-200 rounded-xl"><table class="min-w-full text-xs"><thead class="bg-slate-100"><tr>'+
        '<th class="text-left p-2">Fahrzeug</th><th class="text-right p-2">Belege</th><th class="text-right p-2">Kosten brutto</th></tr></thead><tbody>'+
        report.groups.map(g=>'<tr class="border-t border-slate-100"><td class="p-2 font-semibold">'+esc(vehicleName(g.car))+
          '</td><td class="p-2 text-right">'+g.receiptCount+
          '</td><td class="p-2 text-right font-extrabold">'+esc(fmt(g.gross))+'</td></tr>').join('')+
        '</tbody></table></div>';
    }
    for(const g of report.groups){
      output+='<div class="border border-slate-200 rounded-2xl p-3 space-y-3">'+
        '<div class="flex flex-wrap justify-between gap-2"><div><h3 class="font-black text-slate-900 text-sm">'+esc(vehicleName(g.car))+
        '</h3><p class="text-[11px] text-slate-500">'+esc(g.car.model||'')+
        ' · '+g.receiptCount+' Beleg(e) · '+g.repairCount+' Reparatur(en)</p></div>'+
        '<strong class="text-indigo-800 text-base">'+esc(fmt(g.gross))+'</strong></div>'+
        '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">'+
        [['Belegkosten',fmt(g.receiptGross)],['Zusatz-Reparaturkosten',fmt(g.extraRepairCost)],
         ['Netto auf Belegen',fmt(g.net)],['MwSt. auf Belegen',fmt(g.tax)]].map(([a,b])=>
         '<div class="bg-slate-50 p-2 rounded-lg"><span class="text-slate-500">'+esc(a)+
         '</span><strong class="block text-slate-800 mt-1">'+esc(b)+'</strong></div>').join('')+'</div>';
      if(!g.rows.length)output+='<p class="text-xs text-slate-500 py-3">Für dieses Fahrzeug sind im gewählten Zeitraum noch keine Belege oder Reparaturen erfasst.</p>';
      else output+='<div class="space-y-2">'+g.rows.map(r=>{
        const canOpen=r.source==='beleg'&&/^[A-Za-z0-9_-]+$/.test(r.vehicleId)&&
          /^[A-Za-z0-9_-]+$/.test(r.id)&&r.storagePath.startsWith('fahrzeugbelege/');
        const title=esc(r.company?(r.company+' · '+r.title):r.title);
        const amount=r.gross===null?'Nicht erfasst':fmt(r.gross);
        return '<details class="border border-slate-200 bg-white rounded-xl p-3">'+
          '<summary class="cursor-pointer flex justify-between gap-2 text-xs"><span class="min-w-0"><b>'+
          esc(dateDE(r.date))+' · '+esc(r.type)+'</b><span class="block text-slate-600 mt-0.5 break-words">'+
          title+'</span></span><span class="shrink-0 font-extrabold">'+esc(amount)+'</span></summary>'+
          '<div class="mt-3 pt-2 border-t border-slate-100 space-y-2 text-[11px]">'+
          (r.fileName?'<p class="text-slate-500">Originalbeleg: '+esc(r.fileName)+'</p>':'')+
          (r.net!==null?'<p>Netto: '+esc(fmt(r.net))+'</p>':'')+
          (r.tax!==null?'<p>MwSt.: '+esc(fmt(r.tax))+'</p>':'')+
          (r.km!==null&&r.km!==undefined&&r.km!==''?'<p>Kilometerstand: '+esc(integer.format(Number(r.km)))+' km</p>':'')+
          (r.items.length?'<div class="rounded-lg bg-slate-50 p-2 space-y-1">'+r.items.map(item=>
            '<div class="flex justify-between gap-3"><span class="min-w-0 break-words">'+esc(item.name)+' × '+
            esc(item.qty)+'</span><span class="font-bold shrink-0">'+
            esc(item.price===null?'Nicht separat berechnet':fmt(item.price))+'</span></div>').join('')+'</div>':'')+
          (r.notes?'<p class="whitespace-pre-line text-slate-500">'+esc(r.notes)+'</p>':'')+
          (canOpen?'<button type="button" data-cost-view="'+esc(r.vehicleId)+'" data-receipt="'+esc(r.id)+
            '" class="border border-indigo-200 text-indigo-700 px-3 py-2 rounded-lg font-bold">Originalbeleg ansehen</button>':'')+
          '</div></details>';
      }).join('')+'</div>';
      output+='</div>';
    }
    target.innerHTML=output;
    target.querySelectorAll('[data-cost-view]').forEach(btn=>btn.addEventListener('click',()=>{
      if(typeof window.openFleetReceipt==='function')window.openFleetReceipt(btn.dataset.costView,btn.dataset.receipt);
      else if(typeof openFleetReceipt==='function')openFleetReceipt(btn.dataset.costView,btn.dataset.receipt);
    }));
  }
  function setMode(m){mode=m==='all'?'all':'single';updateOptions();render();}
  function setVehicles(data){vehicles=Array.isArray(data)?data.filter(v=>v&&v.id):[];render();}
  function outputFilename(report,ext){
    const target=mode==='single'?(report.groups[0]?.car.plate||'Einzelfahrzeug'):'Gesamt';
    const safe=String(target).replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,35);
    return 'ECB-Fahrzeugkosten-'+safe+'-'+new Date().toISOString().slice(0,10)+'.'+ext;
  }
  function pdfLine(doc,text,x,y,size=9,bold=false){
    doc.setFont('helvetica',bold?'bold':'normal');
    doc.setFontSize(size);
    doc.setTextColor(bold?22:70,bold?37:85,bold?48:105);
    doc.text(String(text==null?'':text).replace(/[\u20ac]/g,'EUR').replace(/[^\u0000-\u00ff]/g,'-'),x,y);
  }
  function pdfHeader(doc,label,report){
    doc.setFillColor(250,252,250);doc.rect(0,0,210,40,'F');
    doc.addImage(companyMark(),'PNG',14,9,37,14);
    pdfLine(doc,'E.C.B. Reinigungssysteme GmbH',56,16,12,true);
    pdfLine(doc,label,56,22,9,false);
    pdfLine(doc,'Erstellt: '+infoDate(),56,28,8);
    const range=report.range.from||report.range.to?
      dateDE(report.range.from)+' bis '+dateDE(report.range.to):'Gesamter Zeitraum';
    pdfLine(doc,'Zeitraum: '+range,15,47,9);
  }
  function pdf(){
    let report;
    try{report=build();}catch(e){alert(e.message);return;}
    if(!report.groups.length){alert('Keine Fahrzeuge für den Export vorhanden.');return;}
    if(!window.jspdf||!window.jspdf.jsPDF){alert('PDF-Bibliothek nicht geladen.');return;}
    const doc=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});
    const addPage=()=>{doc.addPage();pdfHeader(doc,mode==='single'?'Einzelfahrzeug – Kostenreport':'Fuhrpark – Kostenreport',report);return 57;};
    let y=57;
    pdfHeader(doc,mode==='single'?'Einzelfahrzeug – Kostenreport':'Fuhrpark – Kostenreport',report);
    pdfLine(doc,'Gesamtkosten: '+fmt(report.grand).replace('€','EUR'),15,y,13,true);y+=8;
    pdfLine(doc,'Belege: '+report.totalReceipts+'   Ohne erfassten Betrag: '+report.missing,15,y,8);y+=5;
    pdfLine(doc,'Endbetraege nur einmal je Beleg. Artikel sind Detailangaben, keine Zusatzkosten.',15,y,7);y+=9;
    if(mode==='all'){
      pdfLine(doc,'Fuhrpark – Kostenübersicht',15,y,11,true);y+=7;
      for(const g of report.groups){
        if(y>271)y=addPage();
        pdfLine(doc,vehicleName(g.car),16,y,9,true);
        doc.setFontSize(9);doc.text(fmt(g.gross).replace('€','EUR'),193,y,{align:'right'});
        y+=7;
      }
      y+=6;
    }
    for(const g of report.groups){
      if(y>240)y=addPage();
      doc.setFillColor(238,247,234);doc.roundedRect(14,y,182,13,2,2,'F');
      pdfLine(doc,vehicleName(g.car)+' · '+String(g.car.model||''),18,y+5.4,10,true);
      doc.setFontSize(10);doc.setFont('helvetica','bold');
      doc.text(fmt(g.gross).replace('€','EUR'),190,y+5.4,{align:'right'});
      pdfLine(doc,'Belege: '+g.receiptCount+' | Reparaturen: '+g.repairCount+
        ' | Zusätzliche Reparaturkosten: '+fmt(g.extraRepairCost).replace('€','EUR'),18,y+10,7);
      y+=19;
      if(!g.rows.length){pdfLine(doc,'Keine Einträge vorhanden.',18,y,8);y+=8;continue;}
      for(const r of g.rows){
        const itemLines=(r.items||[]).map(i=>'    '+i.name+' x '+i.qty+
          '  '+(i.price===null?'ohne Einzelpreis':fmt(i.price).replace('€','EUR')));
        const desc=r.company?(r.company+' · '+r.title):r.title;
        const detail=doc.splitTextToSize(desc,132).slice(0,3);
        const headHeight=13+detail.length*4+
          (r.fileName?4:0)+(r.net!==null||r.tax!==null?4:0);
        if(y+headHeight>275)y=addPage();
        doc.setDrawColor(225,232,237);doc.line(15,y-2,195,y-2);
        pdfLine(doc,dateDE(r.date)+' · '+r.type,17,y+3,8,true);
        doc.setFont('helvetica','bold');doc.setFontSize(8);
        doc.text(r.gross===null?'Ohne Betrag':fmt(r.gross).replace('€','EUR'),193,y+3,{align:'right'});
        y+=7;
        detail.forEach(t=>{pdfLine(doc,t,19,y+2,8);y+=4;});
        if(r.fileName){pdfLine(doc,'Beleg: '+r.fileName.slice(0,70),19,y+2,7);y+=4;}
        if(r.net!==null||r.tax!==null){
          pdfLine(doc,'Netto: '+(r.net===null?'-':fmt(r.net).replace('€','EUR'))+
            '   MwSt.: '+(r.tax===null?'-':fmt(r.tax).replace('€','EUR')),19,y+2,7);y+=4;
        }
        for(const line of itemLines){
          const wrapped=doc.splitTextToSize(line,166);
          for(const part of wrapped){
            if(y+5>275)y=addPage();
            pdfLine(doc,part,19,y+2,7);y+=4;
          }
        }
        y+=4;
      }
      y+=4;
    }
    const pages=doc.internal.getNumberOfPages();
    for(let p=1;p<=pages;p++){
      doc.setPage(p);doc.setDrawColor(217,226,221);doc.line(14,283,196,283);
      pdfLine(doc,'ECB · Interner Fahrzeugkostenbericht · Originalbelege nur in der geschützten App',15,288,7);
      doc.text(p+' / '+pages,194,288,{align:'right'});
    }
    doc.save(outputFilename(report,'pdf'));
  }
  let excelLoading=null;
  function excelLib(){
    if(window.ExcelJS)return Promise.resolve(window.ExcelJS);
    if(!excelLoading)excelLoading=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
      script.onload=()=>window.ExcelJS?resolve(window.ExcelJS):reject(Error('Excel-Modul nicht verfügbar'));
      script.onerror=()=>reject(Error('Excel-Modul konnte nicht geladen werden. Bitte Internet prüfen.'));
      document.head.appendChild(script);
    }).catch(error=>{excelLoading=null;throw error;});
    return excelLoading;
  }
  async function excel(){
    let report;
    try{report=build();}catch(e){alert(e.message);return;}
    if(!report.groups.length){alert('Keine Fahrzeuge für den Excel-Export vorhanden.');return;}
    const button=$('cost-excel');if(button)button.disabled=true;
    try{
      const ExcelJS=await excelLib();
      const wb=new ExcelJS.Workbook();
      wb.creator='E.C.B. Reinigungssysteme GmbH';wb.created=new Date();
      function sheet(name,headers){
        const sh=wb.addWorksheet(name,{views:[{state:'frozen',ySplit:5}]});
        sh.mergeCells(1,3,2,Math.min(6,headers.length));
        sh.getCell('C1').value='E.C.B. Reinigungssysteme GmbH';
        sh.getCell('C1').font={size:15,bold:true,color:{argb:'FF14532D'}};
        sh.getCell('C3').value='Fahrzeugkosten · Stand '+infoDate();
        sh.getRow(5).values=headers;
        const head=sh.getRow(5);head.font={bold:true,color:{argb:'FFFFFFFF'}};
        head.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF4D8A30'}};
        head.alignment={vertical:'middle',wrapText:true};head.height=27;
        sh.autoFilter={from:{row:5,column:1},to:{row:5,column:headers.length}};
        sh.columns=headers.map((name,i)=>({width:i===0?21:i===3?42:19}));
        return sh;
      }
      const logo=wb.addImage({base64:companyMark(),extension:'png'});
      const overview=sheet('Fahrzeuge',['Kennzeichen','Modell','Belege','Reparaturen','Belegkosten brutto','Zusatzkosten Reparaturen','Gesamtkosten brutto','Netto Belege','MwSt. Belege','Belege ohne Preis']);
      overview.columns=[{width:21},{width:28},{width:12},{width:16},{width:23},{width:27},{width:24},{width:21},{width:19},{width:19}];
      overview.addImage(logo,{tl:{col:0,row:0},ext:{width:120,height:52}});
      const entries=sheet('Kostenbuchungen',['Fahrzeug','Datum','Art','Händler / Leistung','Brutto EUR','Netto EUR','MwSt EUR','Belegdatei','Beschreibung','Kilometerstand','Status / Hinweise','Beleg-ID']);
      entries.columns=[{width:21},{width:17},{width:19},{width:36},{width:17},{width:17},{width:17},{width:35},{width:47},{width:17},{width:23},{width:28}];
      entries.addImage(logo,{tl:{col:0,row:0},ext:{width:120,height:52}});
      const items=sheet('Artikelpositionen',['Fahrzeug','Datum','Belegart','Artikel / Leistung','Menge','Positionspreis EUR','Preis ausgewiesen','Belegdatei','Beleg-ID']);
      items.columns=[{width:21},{width:16},{width:19},{width:50},{width:12},{width:21},{width:21},{width:30},{width:27}];
      items.addImage(logo,{tl:{col:0,row:0},ext:{width:120,height:52}});
      for(const g of report.groups){
        overview.addRow([vehicleName(g.car),String(g.car.model||''),g.receiptCount,g.repairCount,
          g.receiptGross/100,g.extraRepairCost/100,g.gross/100,g.net/100,g.tax/100,g.missing]);
        for(const r of g.rows){
          entries.addRow([r.vehicle,dateDE(r.date),r.type,r.company||r.title,
            r.gross===null?null:r.gross/100,r.net===null?null:r.net/100,
            r.tax===null?null:r.tax/100,r.fileName,r.title,
            r.km===null||r.km===undefined||r.km===''?null:Number(r.km),
            r.source==='reparatur'?r.status:r.gross===null?'Betrag fehlt':'',r.id]);
          for(const item of r.items)items.addRow([r.vehicle,dateDE(r.date),r.type,item.name,
            item.qty,item.price===null?null:item.price/100,item.price===null?'Nein':'Ja',r.fileName,r.id]);
        }
      }
      const cols=[[overview,[5,6,7,8,9]],[entries,[5,6,7]],[items,[6]]];
      for(const [sh,moneyColumns] of cols){
        for(let i=6;i<=sh.rowCount;i++){
          const row=sh.getRow(i);
          if(i%2===0)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF2F8EF'}};
          row.alignment={vertical:'top',wrapText:true};
          row.height=24;
          for(const col of moneyColumns)row.getCell(col).numFmt='#,##0.00 "€"';
        }
        sh.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
        sh.headerFooter.oddFooter='E.C.B. Reinigungssysteme GmbH  ·  Seite &P von &N';
      }
      const footer=overview.addRow(['GESAMT','',report.totalReceipts,'',report.groups.reduce((n,g)=>n+g.receiptGross,0)/100,
        report.extraRepairCost/100,report.grand/100,
        report.groups.reduce((n,g)=>n+g.net,0)/100,
        report.groups.reduce((n,g)=>n+g.tax,0)/100,report.missing]);
      footer.font={bold:true,color:{argb:'FF14532D'}};
      footer.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFE6F4DF'}};
      [5,6,7,8,9].forEach(col=>footer.getCell(col).numFmt='#,##0.00 "€"');
      const buffer=await wb.xlsx.writeBuffer();
      const link=document.createElement('a');
      const url=URL.createObjectURL(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      link.href=url;link.download=outputFilename(report,'xlsx');document.body.appendChild(link);
      link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
    }catch(error){alert('Excel-Export fehlgeschlagen: '+(error.message||error));}
    finally{if(button)button.disabled=false;}
  }
  window.ECBFleetCosts={setVehicles,setMode,render,pdf,excel,getData:build};
})();
