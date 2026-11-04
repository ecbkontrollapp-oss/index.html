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
result[entry[0]]=raw.data&&raw.data.text||'';
}finally{canvas.width=0;canvas.height=0;}
}
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
const m=value.match(/\b([A-ZÄÖÜ]{1,3})[\s-]+([A-ZÄÖÜ]{1,2})[\s-]*([0-9ILOSBZ]{1,4})\b/);
if(!m)return '';
const digits=m[3].replace(/[IL]/g,'1').replace(/O/g,'0').replace(/S/g,'5').replace(/B/g,'8').replace(/Z/g,'2');
return m[1]+'-'+m[2]+' '+digits;
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
function tyre(raw){
const m=cleaned(raw).toUpperCase().match(/(\d{3}\s*\/\s*\d{2,3}\s*R\s*\d{2})(?:\s*\(?\s*(\d{2,3})\s*\)?\s*([A-Z]))?/);
return m?m[1].replace(/\s/g,'')+(m[2]?' '+m[2]+(m[3]||''):''):'';
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
d.model=letters(r.model);
const variants=String(r.type||'').toUpperCase().match(/\b[A-Z0-9]{3,16}\b/g)||[];
d.type=variants.length?variants[variants.length-1]:'';
const fuel=letters(r.fuel).toUpperCase();
d.fuel=/^(DIESEL|BENZIN|ELEKTRO|HYBRID|CNG|LPG|ERDGAS|FLÜSSIGGAS|FLUESSIGGAS)\b/.test(fuel)?fuel:'';
const group=cleaned(r.vehicleClass).toUpperCase().match(/\b(M1|N1|N2|N3|O[1-4]|L\d[Ee]?)\b/);
d.vehicleClass=group?group[1]:'';
d.powerKw=number(r.powerKw,1000);
d.displacement=number(r.displacement,20000);
d.totalMass=number(r.totalMass,200000);
d.seats=number(r.seats,100);
d.tyresFront=tyre(r.tyresFront);
d.tyresRear=tyre(r.tyresRear);
for(const k of Object.keys(d))if(!d[k])delete d[k];
return d;
}
window.ECBRegistrationLayout={scan,interpret,aspect};
})();
