/* OCR for the landscape FRONT of German Zulassungsbescheinigung Teil I.
   The cells are individually cropped, because full-page OCR loses the
   relationship between tiny field codes and their values. */
(function(){
'use strict';
const cells=[
['plate',[.020,.433,.288,.501]],
['firstRegistration',[.325,.038,.455,.095]],
['hsn',[.464,.040,.518,.093]],
['tsn',[.537,.039,.645,.094]],
['vin',[.331,.132,.581,.170]],
['manufacturer',[.331,.174,.490,.210]],
['vehicleClass',[.330,.095,.440,.134]],
['color',[.620,.480,.845,.552]],
['type',[.332,.227,.514,.342]],
['model',[.329,.375,.490,.416]],
['fuel',[.330,.609,.467,.650]],
['displacement',[.542,.648,.646,.697]],
['powerKw',[.800,.041,.909,.092]],
['totalMass',[.797,.214,.896,.258]],
['seats',[.859,.375,.907,.430]],
['tyresFront',[.673,.425,.833,.460]],
['tyresRear',[.673,.457,.833,.491]]
];
function aspect(img) {
const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
return !!(w&&h&&w/h>1.58&&w/h<2.62);
}
function crop(img,b) {
const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;
const x=Math.floor(b[0]*w),y=Math.floor(b[1]*h);
const cw=Math.max(1,Math.ceil((b[2]-b[0])*w));
const ch=Math.max(1,Math.ceil((b[3]-b[1])*h));
const scale=Math.min(4.5,1350/cw,280/ch);
const canvas=document.createElement('canvas');
canvas.width=Math.max(100,Math.round(cw*scale));
canvas.height=Math.max(55,Math.round(ch*scale));
const ctx=canvas.getContext('2d');
ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
ctx.imageSmoothingEnabled=true;
ctx.imageSmoothingQuality='high';
ctx.filter='grayscale(1) contrast(1.55)';
ctx.drawImage(img,x,y,cw,ch,0,0,canvas.width,canvas.height);
ctx.filter='none';
return canvas;
}
async function scan(img,worker,status) {
if(!aspect(img))return {};
await worker.setParameters({tessedit_pageseg_mode:'7'});
const result={};
for(let i=0;i<cells.length;i++){
const entry=cells[i];
if(status)status('Tabellenfelder werden einzeln gelesen ('+(i+1)+'/'+cells.length+') …');
const canvas=crop(img,entry[1]);
try{
const raw=await worker.recognize(canvas);
let value=raw.data&&raw.data.text||'';
if(entry[0]==='model' && !/\b[A-ZÄÖÜ]{4,}\b/.test(value.trim().toUpperCase())){
  // Patterned registration paper sometimes confuses single-line layout
  // detection; sparse-text mode reads the standalone model name better.
  await worker.setParameters({tessedit_pageseg_mode:'11'});
  try{
    const retry=await worker.recognize(canvas);
    const candidate=retry.data&&retry.data.text||'';
    if(/\b[A-ZÄÖÜ]{4,}\b/.test(candidate.toUpperCase()))value=candidate;
  }finally{await worker.setParameters({tessedit_pageseg_mode:'7'});}
}
result[entry[0]]=value;
}finally{canvas.width=0;canvas.height=0;}
}
// If a narrow template crop misses A or D.3, try a wider OCR region.
// These retries do not guess missing values or upload any document.
if(!plate(result.plate)){
  await worker.setParameters({tessedit_pageseg_mode:'11'});
  try{
    for(const bounds of [[.015,.39,.32,.55],[.015,.29,.34,.66]]){
      const wider=crop(img,bounds);
      try{
        const retry=await worker.recognize(wider);
        const candidate=retry.data&&retry.data.text||'';
        if(plate(candidate)){result.plate=candidate;break;}
      }finally{wider.width=0;wider.height=0;}
    }
  }finally{await worker.setParameters({tessedit_pageseg_mode:'7'});}
}
if(!result.model || !/[A-Za-zÄÖÜäöüß]{4,}/.test(result.model) || /^(?:HANDELSBEZEICHNUNG|FAHRZEUG|HERSTELLER)$/i.test(String(result.model).trim())){
  await worker.setParameters({tessedit_pageseg_mode:'11'});
  try{
    const wider=crop(img,[.324,.354,.590,.443]);
    try{
      const retry=await worker.recognize(wider);
      const lines=String(retry.data&&retry.data.text||'').split(/\r?\n/)
        .map(x=>x.trim().toUpperCase());
      const candidate=lines.find(x=>
        /^[A-ZÄÖÜ]{4,}(?:[ -][A-ZÄÖÜ0-9]{2,})?$/.test(x)&&
        !/^(?:HANDELSBEZEICHNUNG|FAHRZEUG|FAHRZEUGSCHEIN|VORDERSEITE|KRAFTSTOFF|HERSTELLER|VARIANTE|DIESEL|BENZIN|MARKE)$/.test(x));
      if(candidate)result.model=candidate;
    }finally{wider.width=0;wider.height=0;}
  }finally{await worker.setParameters({tessedit_pageseg_mode:'7'});}
}
// S.1 is a two-part field: the printed "1" in the label must never
// be mistaken for the actual seating capacity. Check several overlapping
// value regions; prefer two independent, matching readings.
if(!interpret(result,'').seats){
  const seatVotes=[];
  const seatBoxes=[
    [.870,.377,.914,.431],
    [.873,.380,.920,.429],
    [.864,.367,.925,.433]
  ];
  const savedParams={tessedit_char_whitelist:'0123456789'};
  try{
    await worker.setParameters(savedParams);
    for(const bounds of seatBoxes){
      const tile=crop(img,bounds);
      try{
        for(const psm of ['7','13']){
          await worker.setParameters({tessedit_pageseg_mode:psm});
          const reread=await worker.recognize(tile);
          const text=String(reread.data&&reread.data.text||'').trim();
          const match=text.match(/^([1-9])$/);
          // A single "1" may still be the field-code suffix S.1.
          if(match&&match[1]!=='1')seatVotes.push(match[1]);
        }
      }finally{tile.width=0;tile.height=0;}
    }
  }finally{
    await worker.setParameters({tessedit_char_whitelist:'',tessedit_pageseg_mode:'7'});
  }
  const votes={};
  for(const value of seatVotes)votes[value]=(votes[value]||0)+1;
  const confirmed=Object.entries(votes).find(([,count])=>count>=2);
  if(confirmed)result.seats=confirmed[0];
}
// D.2 is laid out in three stacked rows. A single OCR line often loses
// the first two rows or confuses the security-print background with letters.
if(!interpret(result,'').type || interpret(result,'').type.split(' / ').length<2){
  const rowBounds=[
    [.339,.224,.515,.260],
    [.339,.260,.515,.302],
    [.339,.302,.515,.345]
  ];
  const rowValues=[];
  for(let i=0;i<rowBounds.length;i++){
    const patch=crop(img,rowBounds[i]);
    const votes={};
    try{
      for(const mode of ['7','13']){
        await worker.setParameters({tessedit_pageseg_mode:mode});
        const read=await worker.recognize(patch);
        const candidate=typeValue(read.data&&read.data.text||'');
        if(candidate&&!candidate.includes(' / ')){
          votes[candidate]=(votes[candidate]||0)+1;
        }
      }
    }finally{patch.width=0;patch.height=0;}
    const accepted=Object.entries(votes).find(([key,count])=>count>=2);
    if(accepted)rowValues.push(accepted[0]);
  }
  if(rowValues.length>=2){
    result.type=rowValues.join('\n');
  }
}
await worker.setParameters({tessedit_pageseg_mode:'7'});
// Targeted second pass for fields which are frequently too small on iPhone
// photos. Only accept a retry if its result passes the field parser.
const retryBoxes={
  model:[[.310,.353,.607,.450],[.320,.345,.565,.432]],
  vehicleClass:[[.315,.087,.478,.154],[.297,.079,.535,.171]],
  color:[[.615,.477,.850,.553],[.640,.485,.815,.542]],
  seats:[[.875,.376,.912,.427],[.872,.380,.921,.431]],
  tyresFront:[[.655,.405,.907,.472]],
  tyresRear:[[.655,.446,.907,.525]]
};
for(const [key,boxes] of Object.entries(retryBoxes)){
  if(interpret(result,'')[key])continue;
  let found=false;
  for(const bounds of boxes){
    const patch=crop(img,bounds);
    try{
      for(const mode of ['6','11']){
        await worker.setParameters({tessedit_pageseg_mode:mode});
        const again=await worker.recognize(patch);
        const raw=again.data&&again.data.text||'';
        if(interpret({...result,[key]:raw},'')[key]){
          result[key]=raw;
          found=true;
          break;
        }
      }
    }finally{patch.width=0;patch.height=0;}
    if(found)break;
  }
}
await worker.setParameters({tessedit_pageseg_mode:'7'});
return result;
}
function cleaned(v){return String(v||'').replace(/[|¦]/g,'1').replace(/[\r\n]/g,' ').replace(/\s+/g,' ').trim();}
function number(raw,max){
const match=cleaned(raw).match(/(?:^|[^\d])(\d{1,6})(?:\D|$)/);
const value=match?+match[1]:0;
return value>0&&value<=max?String(value):'';
}
function date(raw){
const m=cleaned(raw).match(/\b([0-3]?\d)[./-]([01]?\d)[./-]((?:19|20)\d{2})\b/);
if(!m)return '';
const d=+m[1],mo=+m[2],y=+m[3],value=new Date(Date.UTC(y,mo-1,d));
if(value.getUTCDate()!==d||value.getUTCMonth()!==mo-1||value.getUTCFullYear()!==y||y>new Date().getFullYear()+1)return '';
return y+'-'+String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}
function plate(raw){
const value=cleaned(raw).toUpperCase().replace(/[*•]/g,' ');
const m=value.match(/\b([A-ZÄÖÜ]{1,3})[\s-]+([A-ZÄÖÜ]{1,2})[\s-]*([0-9ILOSBZ]{1,4})\s*([EH])?\b/);
if(!m)return '';
const digits=m[3].replace(/[IL]/g,'1').replace(/O/g,'0').replace(/S/g,'5').replace(/B/g,'8').replace(/Z/g,'2');
return m[1]+'-'+m[2]+' '+digits+(m[4]||'');
}
function vin(raw,full){
const source=String(full||'').toUpperCase();
const fromFull=source.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g)||[];
if(fromFull.length)return fromFull[0];
const candidate=String(raw||'').toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/g)||[];
return candidate[0]||'';
}
function letters(raw){
return cleaned(raw).replace(/^[^A-Za-zÄÖÜäöüß]+/,'').replace(/[^\p{L}\p{N} .-]+$/gu,'').slice(0,60);
}
function color(raw){
  const v=cleaned(raw).toUpperCase().replace(/Ä/g,'AE').replace(/Ö/g,'OE').replace(/Ü/g,'UE');
  const colors=v.match(/\b(?:WEISS|SCHWARZ|GRAU|BLAU|ROT|GRUEN|GELB|BRAUN|SILBER|GOLD|BEIGE|ORANGE|VIOLETT|ROSA|LILA|ANTHRAZIT)\b/g)||[];
  const distinct=[...new Set(colors)];
  return distinct.length===1?distinct[0]:'';
}
function tyre(raw){
const m=cleaned(raw).toUpperCase().match(/(\d{3}\s*\/\s*\d{2,3}\s*R\s*\d{2})(?:\s*\(?\s*(\d{2,3})\s*\)?\s*([A-Z]))?/);
return m?m[1].replace(/\s/g,'')+(m[2]?' '+m[2]+(m[3]||''):''):'';
}
function typeValue(raw){
  // D.2 has up to three rows: type / variant / version. Retain all
  // legible entries in their original order instead of only the last.
  const source=String(raw||'').toUpperCase().replace(/^\s*\(?D\s*[.,]\s*2\)?\s*/,'').replace(/[^A-Z0-9\r\n /-]/g,' ');
  const tokens=source.split(/[\s/|-]+/).filter(Boolean).filter(token=>
    /^[A-Z0-9]{1,16}$/.test(token)&&
    !/^(?:D2|TYP|TYPEN|VARIANTE|VERSION|D|HANDELSBEZEICHNUNG|HERSTELLER|FAHRZEUG|SCHEIN)$/.test(token));
  const unique=[...new Set(tokens)];
  // A single alphabetic OCR word such as FITS is too weak for a type code.
  if(unique.length===1&&!/\d/.test(unique[0])&&unique[0].length>2)return '';
  return unique.slice(0,3).join(' / ');
}
function interpret(raw,fullText) {
const r=raw||{},d={};
d.plate=plate(r.plate);
d.firstRegistration=date(r.firstRegistration);
d.vin=vin(r.vin,fullText);
const hsn=cleaned(r.hsn).match(/\b\d{4}\b/);
d.hsn=hsn?hsn[0]:'';
const tsn=cleaned(r.tsn).toUpperCase().replace(/^[^A-Z]*(?:2[., ]*2)?\s*/,'').replace(/[^A-Z0-9]/g,'');
d.tsn=/^[A-Z0-9]{3,12}$/.test(tsn)&&/[A-Z]/.test(tsn)?tsn:'';
d.manufacturer=letters(r.manufacturer);
d.color=color(r.color);
d.model=String(r.model||'').split(/\r?\n/).map(letters)
  .find(x=>/^[A-Za-zÄÖÜäöüß]{4,}(?:[ -][A-Za-zÄÖÜäöüß0-9]{2,})?$/.test(x)&&! /^(?:HANDELSBEZEICHNUNG|FAHRZEUG|FAHRZEUGSCHEIN|VORDERSEITE|KRAFTSTOFF|HERSTELLER|VARIANTE|DIESEL|BENZIN|MARKE)$/i.test(x))||'';
d.type=typeValue(r.type);
const fuel=letters(r.fuel).toUpperCase();
d.fuel=/^(DIESEL|BENZIN|ELEKTRO|HYBRID|CNG|LPG|ERDGAS|FLÜSSIGGAS|FLUESSIGGAS)\b/.test(fuel)?fuel:'';
const group=cleaned(r.vehicleClass).toUpperCase().match(/\b(M1|N1|N2|N3|O[1-4]|L\d[Ee]?)\b/);
d.vehicleClass=group?group[1]:'';
d.powerKw=number(r.powerKw,1000);
d.displacement=number(r.displacement,20000);
d.totalMass=number(r.totalMass,200000);
const seatRaw=cleaned(r.seats);
const explicitSeatLabel=/^\s*S[.,\s]*1\s*[:.\]-]?\s*(\d{1,2})(?:\s|$)/i.test(seatRaw);
const seatText=seatRaw.replace(/^\s*S[.,\s]*1\s*[:.\]-]?\s*/i,'');
const extractedSeats=number(seatText,100);
// A lone "1" in an isolated crop often comes from the printed "S.1"
// field code, not from an actual one-seat vehicle. Do not guess.
// A solitary 1 is ambiguous even after parsing "S.1 1": on some scans
// this is duplicated from the field label. A true one-seater can be
// corrected manually after reviewing the document.
d.seats=extractedSeats==='1'?'':extractedSeats;
d.tyresFront=tyre(r.tyresFront);
d.tyresRear=tyre(r.tyresRear);
for(const k of Object.keys(d))if(!d[k])delete d[k];
return d;
}
window.ECBRegistrationLayout={scan,interpret,aspect};
})();
