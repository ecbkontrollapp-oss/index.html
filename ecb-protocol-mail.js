/* ECB protocol dispatch presentation and mail payload.
 * No chat text, HTML preview or outgoing mail draft is stored in Firebase or
 * Supabase. A single generated PDF is attached at send time.
 */
(function(){
'use strict';
const RECIPIENT='pb@ecb-system.de';
const CATALOG={
  'Entmineralisierung':{label:'Entmineralisierungsprotokoll',short:'Entmineralisierung',hint:'Leitwert, Anlagendruck und dokumentierte Prüfpunkte',icon:'droplet'},
  'Heizungskontrolle':{label:'Heizungs- und Anlagenkontrolle',short:'Heizungskontrolle',hint:'Betriebswerte, Dichtheit und Funktionskontrollen',icon:'fire'},
  'Außenbereich':{label:'Außenbereichs-Kontrollprotokoll',short:'Außenbereich',hint:'Sauberkeit, Sichtprüfung und festgestellte Mängel',icon:'tree'},
  'Pausenraum':{label:'Pausenraum- und Hygieneprotokoll',short:'Pausenraum',hint:'Hygiene, Ordnung und durchgeführte Kontrollen',icon:'coffee'},
  'Fahrzeuge':{label:'Fahrzeug-Kontrollprotokoll',short:'Fahrzeugkontrolle',hint:'Fahrzeugzustand, Kilometerstand und Sichtprüfung',icon:'truck'},
  'Gesamtbericht':{label:'Tagesgesamtbericht der Kontrollen',short:'Tagesgesamtbericht',hint:'Alle erfassten Wartungs- und Kontrollbereiche',icon:'clipboard'},
  'Urlaub':{label:'Urlaubsantrag',short:'Urlaubsantrag',hint:'Beantragter Urlaub und Bearbeitungsstatus',icon:'calendar'},
  'ShiftSummary':{label:'Schicht- und Auslieferungsübersicht',short:'Schichtkalender',hint:'Schichtplanung und Auslieferung',icon:'calendar'},
  'FleetSummary':{label:'Fahrzeugpark- und Wartungsübersicht',short:'Fahrzeugpark',hint:'Aktuelle Fahrzeug- und Wartungsdaten',icon:'truck'},
  'TeamVacationSummary':{label:'Team-Urlaubsübersicht',short:'Urlaubsplan',hint:'Teamurlaub und Genehmigungen',icon:'calendar'}
};
function clean(v,length=180){
  return String(v==null?'':v).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,length);
}
function meta(ctx){
  const rec=ctx&&ctx.data||{};
  const spec=CATALOG[ctx&&ctx.type]||{label:clean(ctx&&ctx.type||'Kontrollprotokoll'),short:'Dokument',hint:'Geprüfte Angaben im PDF'};
  const sent=new Date();
  const localDate=[String(sent.getDate()).padStart(2,'0'),String(sent.getMonth()+1).padStart(2,'0'),String(sent.getFullYear())].join('.');
  const stamp=clean(rec.timestamp||ctx&&ctx.archiveTimestamp||'',80);
  const date=(stamp.match(/\b\d{2}\.\d{2}\.\d{4}\b/)||[])[0]||
    (String(ctx&&ctx.archiveDate||'').match(/^\d{4}-\d{2}-\d{2}$/)?
      String(ctx.archiveDate).split('-').reverse().join('.'):
      localDate);
  const time=(stamp.match(/\b\d{2}:\d{2}(?::\d{2})?\b/)||[])[0]||sent.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  const inspector=clean(rec.inspector||rec.employee||ctx&&ctx.inspector||'Nicht angegeben',80);
  const plate=clean(rec.plate||'',40);
  const safeType=spec.short.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]/g,'-').replace(/-+/g,'-');
  const safeDate=date.replace(/\./g,'-');
  const filename=('ECB-'+safeType+'-'+safeDate+(plate?'-'+plate.replace(/[^A-Za-z0-9_-]/g,'-'):'')+'.pdf').slice(0,130);
  return {recipient:RECIPIENT,title:spec.label,subtitle:spec.hint,type:clean(ctx&&ctx.type||'Dokument'),date,time,inspector,plate,filename};
}
function summary(ctx){
  const data=ctx&&ctx.data||{};
  if(ctx&&ctx.type==='Gesamtbericht'){
    const names=[
      ['entmineralisierung','Entmineralisierung'],
      ['heizungskontrolle','Heizungskontrolle'],
      ['aussenbereich','Außenbereich'],
      ['pausenraum','Pausenraum'],
      ['fahrzeuge','Fahrzeugkontrolle']
    ];
    const listed=names.filter(([key])=>!!data[key]).map(([,name])=>name);
    return listed.length?'Enthaltene Protokolle: '+listed.join(', '):'Tagesübersicht der Wartungs- und Kontrollbereiche';
  }
  return CATALOG[ctx&&ctx.type]?.hint||'Das zugehörige Dokument ist als PDF beigefügt.';
}
function emailFields(ctx,blob){
  if(!(blob instanceof Blob)||blob.type&&blob.type!=='application/pdf')throw new Error('PDF-Anhang konnte nicht erstellt werden.');
  if(blob.size<1)throw new Error('PDF ist leer. Bitte erneut erstellen.');
  // The current FormSubmit backend documents a TOTAL attachment limit of 10 MB.
  if(blob.size>10*1024*1024)throw new Error('PDF ist größer als 10 MB. Bitte Fotos verkleinern und erneut senden.');
  const d=meta(ctx);
  const fd=new FormData();
  fd.append('_subject','[ECB] '+d.title+' | '+d.date+(d.plate?' | '+d.plate:''));
  fd.append('_template','table');
  fd.append('_captcha','false');
  fd.append('Unternehmen','E.C.B. Reinigungssysteme GmbH');
  fd.append('Protokollart',d.title);
  fd.append('Kontrolldatum',d.date);
  fd.append('Uhrzeit',d.time);
  fd.append('Pruefer / Mitarbeiter',d.inspector);
  if(d.plate)fd.append('Fahrzeug',d.plate);
  fd.append('Dokument',d.filename);
  fd.append('Zusammenfassung',summary(ctx));
  fd.append('Hinweis','Das vollständige Kontrollprotokoll befindet sich im angehängten PDF.');
  fd.append('attachment',blob,d.filename);
  return fd;
}
function text(id,value){
  const node=document.getElementById(id);
  if(node)node.textContent=value;
}
function renderLogo(){
  const host=document.getElementById('dispatch-ecb-logo');
  if(!host||host.firstChild)return;
  if(!window.ECB_LOGO_PATH){host.textContent='ecb';return;}
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox','0 170 650 300');
  svg.setAttribute('width','100%');
  svg.setAttribute('height','100%');
  svg.setAttribute('aria-label','ECB Firmenlogo');
  svg.setAttribute('role','img');
  const path=document.createElementNS(ns,'path');
  path.setAttribute('fill',window.ECB_LOGO_COLOR||'#84b559');
  path.setAttribute('d',window.ECB_LOGO_PATH);
  svg.appendChild(path);host.replaceChildren(svg);
}
function render(ctx){
  if(!ctx)return;
  const d=meta(ctx);
  renderLogo();
  text('dispatch-title',d.title);
  text('dispatch-recipient',d.recipient);
  text('dispatch-protocol-type',d.title);
  text('dispatch-protocol-description',d.subtitle);
  text('dispatch-protocol-date',d.date+' · '+d.time);
  text('dispatch-protocol-inspector',d.inspector);
  text('dispatch-protocol-filename',d.filename);
  text('dispatch-protocol-summary',summary(ctx));
  const sendStatus=document.getElementById('dispatch-status-msg');
  if(sendStatus){sendStatus.textContent='';sendStatus.classList.add('hidden');}
}

/* FormSubmit documents multipart file uploads via a native HTML form POST
 * (not its JSON/AJAX endpoint). Open a visible page from the user gesture,
 * so activation, captcha and service errors are never hidden.
 */
function openSendWindow(){
  const name='ecb_pdf_send_'+Date.now();
  const tab=window.open('about:blank',name);
  if(!tab)throw Error('Das Versandfenster wurde vom Browser blockiert. Bitte Pop-ups für die ECB-App erlauben und erneut versuchen.');
  try{
    tab.document.title='ECB Protokollversand';
    tab.document.body.style.cssText='margin:0;padding:30px;font:16px system-ui;background:#f5faf5;color:#173e2b;';
    const title=tab.document.createElement('h2');
    title.textContent='ECB Protokollversand';
    const p=tab.document.createElement('p');
    p.textContent='PDF wird vorbereitet. Danach öffnet sich die Bestätigung des Versanddienstes.';
    tab.document.body.replaceChildren(title,p);
  }catch(e){}
  return tab;
}
function closeSendWindow(tab,message){
  if(!tab||tab.closed)return;
  try{
    const p=tab.document.createElement('p');
    p.style.color='#b91c1c';p.textContent=message;
    tab.document.body.appendChild(p);
  }catch(e){}
}
function sendMultipart(fd,tab){
  if(!tab||tab.closed)throw Error('Versandfenster wurde geschlossen. Bitte erneut auf „Versenden“ tippen.');
  if(!(fd instanceof FormData))throw Error('Keine Formulardaten zum Versenden vorhanden.');
  const attachment=fd.get('attachment');
  if(!(attachment instanceof Blob)||!attachment.size)throw Error('PDF-Dateianhang fehlt.');
  const filename=clean(attachment.name||'ECB-Protokoll.pdf',130).replace(/[\/\\]/g,'-')||'ECB-Protokoll.pdf';
  if(attachment.size>10*1024*1024)throw Error('PDF-Anhang ist zu groß (maximal 10 MB).');
  if(typeof DataTransfer!=='function'||typeof File!=='function')
    throw Error('Dein Browser unterstützt die direkte PDF-Anlage nicht. Bitte die PDF herunterladen und über die Mail-App senden.');
  const transfer=new DataTransfer();
  transfer.items.add(new File([attachment],filename,{type:'application/pdf'}));
  const input=document.createElement('input');
  input.type='file';input.name='attachment';input.accept='application/pdf';input.files=transfer.files;
  if(!input.files||input.files.length!==1||input.files[0].size!==attachment.size)
    throw Error('Der PDF-Anhang konnte nicht zuverlässig an das Versandformular übergeben werden.');
  const form=document.createElement('form');
  form.method='POST';
  form.action='https://formsubmit.co/'+encodeURIComponent(RECIPIENT);
  form.enctype='multipart/form-data';
  form.target=tab.name;
  form.style.display='none';
  for(const [name,value] of fd.entries()){
    if(name==='attachment'||value instanceof Blob)continue;
    const el=document.createElement('input');
    el.type='hidden';el.name=String(name);el.value=String(value);form.appendChild(el);
  }
  form.appendChild(input);
  document.body.appendChild(form);
  try{form.submit();}
  finally{setTimeout(()=>form.remove(),30000);}
  return {submitted:true,recipient:RECIPIENT,filename};
}
window.ECBProtocolMail={recipient:RECIPIENT,meta,summary,emailFields,render,openSendWindow,closeSendWindow,sendMultipart};
})();
