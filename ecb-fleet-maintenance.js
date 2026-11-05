/* ECB fleet maintenance reports and PDFs.
 * Reads only the existing Firestore fleet snapshot provided by index.html.
 * No PDF, e-mail draft or analysis is persisted in any extra cloud collection.
 */
(function(){
'use strict';
function clean(value,max=400){
  return String(value==null?'':value).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function dateISO(value){
  const t=String(value||'').trim();
  if(!t)return '';
  const m=t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return '';
  const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?t:'';
}
function dateDE(value){const s=dateISO(value);return s?s.substring(8)+'.'+s.substring(5,7)+'.'+s.substring(0,4):'Nicht erfasst';}
function carName(car){return clean(car.plate||car.model||car.id||'Fahrzeug',80);}
function repairList(car,from,to){
  return (Array.isArray(car.reparaturen)?car.reparaturen:[]).filter(r=>{
    if(!r||!dateISO(r.date))return false;
    return (!from||r.date>=from)&&(!to||r.date<=to);
  }).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||
    Number(b.createdAt||0)-Number(a.createdAt||0));
}
function buildReport(fleet,{vehicleId='',from='',to=''}={}){
  if(from&&!dateISO(from)||to&&!dateISO(to))throw Error('Bitte ein gültiges Datum (Von/Bis) auswählen.');
  if(from&&to&&from>to)throw Error('Der Zeitraum ist ungültig: Von liegt nach Bis.');
  const source=Array.isArray(fleet)?fleet.filter(v=>v&&v.id):[];
  const selected=vehicleId?source.filter(v=>v.id===vehicleId):source;
  if(vehicleId&&!selected.length)throw Error('Das ausgewählte Fahrzeug wurde in der Cloud nicht gefunden.');
  if(!selected.length)throw Error('Es sind noch keine Fahrzeuge im Fuhrpark vorhanden.');
  const groups=selected.map(vehicle=>{
    const repairs=repairList(vehicle,from,to);
    return {vehicle,repairs,count:repairs.length,completed:repairs.filter(r=>r.status==='Erledigt').length,
      open:repairs.filter(r=>r.status!=='Erledigt').length};
  }).sort((a,b)=>carName(a.vehicle).localeCompare(carName(b.vehicle),'de'));
  return {groups,from,to,vehicleId,createdAt:new Date().toISOString(),
    vehicleCount:groups.length,
    total:groups.reduce((n,g)=>n+g.count,0),
    completed:groups.reduce((n,g)=>n+g.completed,0),
    open:groups.reduce((n,g)=>n+g.open,0)};
}
function text(doc,str,x,y,size=9,bold=false,color=[33,48,47],max=175){
  doc.setFont('helvetica',bold?'bold':'normal');
  doc.setFontSize(size);
  doc.setTextColor(...color);
  const source=clean(str,8000).replace(/[\u2013\u2014]/g,'-').replace(/\u20ac/g,'EUR');
  const lines=doc.splitTextToSize(source||'-',max);
  return {lines,height:Math.max(1,lines.length)*(size*0.47+1)};
}
function pdf(doc,ctx,header,footer){
  if(!ctx||!ctx.type)throw Error('Kein Wartungsbericht ausgewählt.');
  let title='';
  const data=ctx.data||{};
  if(ctx.type==='FleetMaintenanceReport')title='FUHRPARK - WARTUNGSAUSWERTUNG';
  else if(ctx.type==='FleetMaintenanceVehicle')title='FAHRZEUG - WARTUNGSSTATUS';
  else if(ctx.type==='FleetMaintenanceRepair')title='REPARATUR- UND WARTUNGSPROTOKOLL';
  else throw Error('Nicht unterstützte Wartungsberichtart.');
  const now=new Date(),createdDate=now.toLocaleDateString('de-DE'),createdTime=now.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  const makeHeader=()=>header(doc,title,createdDate,createdTime);
  makeHeader();
  let y=39;
  const newPage=()=>{doc.addPage('a4','portrait');makeHeader();y=39;};
  const ensure=height=>{if(y+height>270)newPage();};
  const line=(label,value,size=9)=>{
    const content=label?label+': '+clean(value,4000):clean(value,4000);
    const layout=text(doc,content,17,y,size,!!label,[32,46,48],174);
    const step=Math.max(5,layout.lines.length*(size*.42+1.3));
    ensure(step+3);
    doc.setFont('helvetica',label?'bold':'normal');doc.setFontSize(size);doc.setTextColor(34,50,47);
    doc.text(layout.lines,17,y+3);
    y+=step+2;
  };
  const heading=label=>{
    ensure(13);
    doc.setFillColor(239,247,234);
    doc.roundedRect(15,y,180,10,2,2,'F');
    doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(29,87,53);
    const safe=clean(label,100);
    doc.text(doc.splitTextToSize(safe,170).slice(0,1),19,y+6.5);y+=14;
  };
  const note=value=>{
    const v=clean(value,4000);
    if(!v)return;
    line('Bemerkung',v,8.4);
  };
  const vehicleCurrent=vehicle=>{
    line('Fahrzeug',carName(vehicle)+'  |  '+clean(vehicle.model||'',120));
    line('Aktueller Kilometerstand',vehicle.km?String(vehicle.km)+' km':'Nicht erfasst');
    line('Naechster TÜV (aktueller Stammdatenstand)',vehicle.tuev||'Nicht erfasst');
    line('Oelwechsel bei (aktueller Stammdatenstand)',vehicle.oil||'Nicht erfasst');
  };
  const repairDetails=(repair,vehicle,showCar)=>{
    if(showCar)line('Fahrzeug',carName(vehicle));
    line('Datum',dateDE(repair.date));
    line('Arbeit',repair.title||'Ohne Bezeichnung');
    line('Status',repair.status||'Offen');
    if(repair.employee)line('Erfasst von',repair.employee);
    if(repair.km)line('Kilometerstand zum Vorgang',repair.km+' km');
    if(Array.isArray(repair.points)&&repair.points.length){
      line('Arbeitspunkte',repair.points.map((p,i)=>(i+1)+'. '+(p.done?'[Erledigt] ':'[Offen] ')+clean(p.label,180)).join('  |  '),8.5);
    }
    if(repair.costSeparate===true&&repair.cost!=null&&repair.cost!==''){
      const c=Number(repair.cost);
      if(Number.isFinite(c)&&c>=0)line('Separat erfasste Zusatzkosten',c.toLocaleString('de-DE',{style:'currency',currency:'EUR'}));
    }
    note(repair.notes);
  };
  if(ctx.type==='FleetMaintenanceRepair'){
    const vehicle=data.vehicle||{},repair=data.repair||{};
    heading('Einzelprotokoll einer gespeicherten Reparatur / Wartung');
    repairDetails(repair,vehicle,true);
    heading('Aktueller Wartungsstatus des Fahrzeugs');
    vehicleCurrent(vehicle);
    line('Datenquelle','Gespeicherter Fuhrpark-Eintrag. Ein E-Mail-Versand erzeugt keinen neuen Cloud-Eintrag.',8);
  }else if(ctx.type==='FleetMaintenanceVehicle'){
    const vehicle=data.vehicle||{};
    heading('Aktueller Fahrzeug-Wartungsstatus');
    vehicleCurrent(vehicle);
    heading('Gespeicherte Reparatur- und Wartungseintraege');
    const records=(Array.isArray(vehicle.reparaturen)?vehicle.reparaturen:[])
      .filter(r=>r&&dateISO(r.date)).slice().sort((a,b)=>String(b.date).localeCompare(String(a.date)));
    line('Anzahl gespeicherter Eintraege',String(records.length));
    if(!records.length)line('Hinweis','Noch keine datierten Reparatur- und Wartungseintraege erfasst.');
    for(const [i,record] of records.entries()){
      heading((i+1)+'. '+dateDE(record.date)+' - '+clean(record.title,65));
      repairDetails(record,vehicle,false);
    }
  }else{
    const report=data;
    if(!Array.isArray(report.groups))throw Error('Wartungsauswertung enthält keine Fahrzeugdaten.');
    heading('Zeitraum der Reparatur- / Wartungseintraege');
    line('Von',report.from?dateDE(report.from):'Beginn der Erfassung');
    line('Bis',report.to?dateDE(report.to):'Aktuell');
    line('Fahrzeuge',String(report.vehicleCount));
    line('Reparatur-/Wartungseintraege im Zeitraum',String(report.total));
    line('Davon erledigt',String(report.completed));
    line('Offen / in Bearbeitung',String(report.open));
    line('Wichtig','TÜV, Ölwechsel und Kilometerstand sind der aktuelle Stammdatenstand. Der Zeitraum filtert nur datierte Reparatur-/Wartungseintraege.',8);
    for(const group of report.groups){
      heading(carName(group.vehicle)+' - '+clean(group.vehicle.model||'',35));
      vehicleCurrent(group.vehicle);
      line('Vorgaenge im Zeitraum',group.count+' | Erledigt: '+group.completed+' | Offen: '+group.open);
      if(!group.repairs.length)line('Hinweis','Keine datierten Wartungseintraege im gewählten Zeitraum.');
      for(const record of group.repairs){
        heading(dateDE(record.date)+' - '+clean(record.title,55));
        repairDetails(record,group.vehicle,false);
      }
    }
  }
  const total=doc.internal.getNumberOfPages();
  for(let p=1;p<=total;p++){doc.setPage(p);footer(doc,p,total);}
  doc.setPage(1);
  return doc;
}
window.ECBFleetMaintenance={buildReport,pdf,dateDE,carName};
})();