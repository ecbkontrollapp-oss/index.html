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
  'TeamVacationSummary':{label:'Team-Urlaubsübersicht',short:'Urlaubsplan',hint:'Teamurlaub und Genehmigungen',icon:'calendar'},
  'FleetMaintenanceRepair':{label:'Reparatur- und Wartungsprotokoll',short:'Fahrzeugwartung',hint:'Gespeicherte Arbeiten, Status, Kilometerstand und Bemerkungen',icon:'wrench'},
  'FleetMaintenanceVehicle':{label:'Wartungsübersicht eines Fahrzeugs',short:'Fahrzeugwartungsuebersicht',hint:'Aktueller TÜV-/Ölwechselstatus und gespeicherte Wartungseinträge',icon:'truck'},
  'FleetMaintenanceReport':{label:'Fuhrpark-Wartungsauswertung',short:'Fuhrpark-Wartungsauswertung',hint:'Fahrzeugübersicht, Wartungsvorgänge und Zeitraum',icon:'chart'}
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
  const plate=clean(rec.plate||rec.vehicle&&rec.vehicle.plate||'',40);
  const safeType=spec.short.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]/g,'-').replace(/-+/g,'-');
  const safeDate=date.replace(/\./g,'-');
  const filename=('ECB-'+safeType+'-'+safeDate+(plate?'-'+plate.replace(/[^A-Za-z0-9_-]/g,'-'):'')+'.pdf').slice(0,130);
  return {recipient:RECIPIENT,title:spec.label,subtitle:spec.hint,type:clean(ctx&&ctx.type||'Dokument'),date,time,inspector,plate,filename};
}
function summary(ctx){
  const data=ctx&&ctx.data||{};
  if(ctx&&ctx.type==='FleetMaintenanceRepair')
    return 'Fahrzeug: '+clean(data.vehicle&&data.vehicle.plate||'-',40)+
      ' | Wartungs-/Reparaturpunkt: '+clean(data.repair&&data.repair.title||'-',80)+
      ' | Status: '+clean(data.repair&&data.repair.status||'-',40);
  if(ctx&&ctx.type==='FleetMaintenanceVehicle')
    return 'Aktueller Wartungsstatus und gespeicherte Reparaturen für '+
      clean(data.vehicle&&data.vehicle.plate||'das Fahrzeug',70);
  if(ctx&&ctx.type==='FleetMaintenanceReport'){
    const from=data.from?String(data.from).split('-').reverse().join('.'):'Beginn';
    const to=data.to?String(data.to).split('-').reverse().join('.'):'Aktuell';
    return 'Zeitraum: '+from+' bis '+to+' | Fahrzeuge: '+(data.vehicleCount||0)+
      ' | Wartungs-/Reparaturvorgänge: '+(data.total||0)+
      ' | Erledigt: '+(data.completed||0)+' | Offen: '+(data.open||0);
  }
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
  // Limit PDFs to 8 MB for reliable Edge Function + Resend processing.
  if(blob.size>8*1024*1024)throw new Error('PDF ist größer als 8 MB. Bitte Fotos verkleinern und erneut senden.');
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

/* Direct PDF mail via authenticated Supabase Edge Function.
 * No FormSubmit redirect. Neither PDF nor mail text is saved in Supabase.
 * A provider acceptance ID does not prove delivery to the final mailbox.
 */
async function sendSecureFields(fd) {
  if (!(fd instanceof FormData)) throw new Error('PDF-Versanddaten fehlen.');
  const file=fd.get('attachment');
  if (!(file instanceof Blob) || !file.size) throw new Error('PDF-Anhang fehlt.');
  if (file.size > 8*1024*1024) throw new Error('PDF ist größer als 8 MB. Bitte die Fotos verkleinern.');
  if (!window.ECBFileStorage || !window.ECBFileStorage.authorized) {
    throw new Error('Supabase-Anmeldung ist nicht verfügbar. Bitte die ECB-App neu laden.');
  }
  const auth=await window.ECBFileStorage.authorized();
  let response;
  try {
    response=await auth.client.functions.invoke('send-ecb-pdf',{body:fd});
  } catch (error) {
    throw new Error('Supabase nicht erreichbar. Versandstatus unklar – bitte Postfach prüfen, bevor du erneut sendest.');
  }
  const {data,error}=response||{};
  if(error) {
    let serverMessage='';
    let status=0;
    const ctx=error.context;
    if(ctx&&typeof ctx.status==='number')status=ctx.status;
    if(ctx&&typeof ctx.clone==='function'&&typeof ctx.json==='function') {
      try {const body=await ctx.clone().json();serverMessage=String(body.error||body.message||'');}catch(ignored){}
    }
    if(status===404) throw new Error('PDF-Versandfunktion noch nicht in Supabase veröffentlicht. Bitte die Einrichtung abschließen.');
    if(status===401||status===403) throw new Error(serverMessage||'Dein Supabase-Mitarbeiterkonto darf noch keine PDF-Protokolle versenden.');
    throw new Error(serverMessage||'PDF-Versand fehlgeschlagen ('+(status||'Netzwerk')+'). Bitte Postfach kontrollieren, bevor du erneut sendest.');
  }
  if(!data||data.ok!==true||!data.id) {
    throw new Error(String(data&&data.error||'Keine gültige Versandbestätigung vom Server erhalten. Versandstatus unklar.'));
  }
  return {ok:true,id:data.id,recipient:RECIPIENT,accepted:true};
}
async function sendSecure(ctx,blob) {
  return sendSecureFields(emailFields(ctx,blob));
}
window.ECBProtocolMail={recipient:RECIPIENT,meta,summary,emailFields,render,sendSecure,sendSecureFields};
})();
