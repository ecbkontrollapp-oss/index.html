/* E.C.B. – separate vehicle administration. This is a UI lock only.
 * Real cloud permissions require Firebase Auth plus Firestore/Storage rules. */
(function () {
  'use strict';
  const KFZ_PASS = 'Ecbkfz';
  const admin = { unlocked: false, editor: null };
  window.ECB_KFZ_ADMIN = admin;

  const inputClass = 'w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none box-border';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fleet = () => typeof cloudFleetVehicles !== 'undefined' ? cloudFleetVehicles : [];
  const carById = id => fleet().find(v => v.id === id);
  function locked() {
    if (!admin.unlocked) {
      if (typeof showToast === 'function') showToast('Bitte zuerst den KFZ-Adminbereich mit Passwort entsperren.');
      return true;
    }
    return false;
  }
  function refresh() {
    ['renderFleetVehiclesList','renderFleetRepairsList','renderFleetReceiptsList','renderFleetRegistrationsList'].forEach(fn => {
      if (typeof window[fn] === 'function') window[fn]();
    });
  }
  function setLockState(unlocked) {
    admin.unlocked = unlocked;
    const form = document.getElementById('kfz-admin-login-form');
    const open = document.getElementById('kfz-admin-unlocked');
    const badge = document.getElementById('kfz-admin-badge');
    if (form) form.classList.toggle('hidden', unlocked);
    if (open) open.classList.toggle('hidden', !unlocked);
    if (badge) {
      badge.textContent = unlocked ? 'Entsperrt' : 'Gesperrt';
      badge.className = 'shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full border ' +
        (unlocked ? 'bg-emerald-900 text-emerald-200 border-emerald-600' : 'bg-slate-700 text-slate-200 border-slate-600');
    }
    if (!unlocked) {
      admin.editor = null;
      const modal = document.getElementById('modal-kfz-edit');
      if (modal) modal.classList.add('hidden');
    }
    refresh();
  }
  window.unlockKfzAdmin = function (event) {
    event.preventDefault();
    const input = document.getElementById('kfz-admin-password');
    if (!input) return;
    const ok = input.value === KFZ_PASS;
    input.value = '';
    if (ok) {
      setLockState(true);
      showToast('KFZ-Adminbereich freigeschaltet.');
    } else showToast('Falsches KFZ-Passwort.');
  };
  window.lockKfzAdmin = function () {
    setLockState(false);
    showToast('KFZ-Adminbereich gesperrt.');
  };

  const schema = {
    vehicle: [
      {key:'plate', label:'Kennzeichen / Name *', required:true, max:80},
      {key:'model', label:'Fahrzeugmodell / Typ', max:100},
      {key:'km', label:'Kilometerstand', type:'number', min:0},
      {key:'tuev', label:'Nächster TÜV', type:'date'},
      {key:'oil', label:'Nächster Ölwechsel (km)', type:'number', min:0}
    ],
    repair: [
      {key:'title', label:'Reparatur / Beanstandung *', required:true, max:180},
      {key:'date', label:'Datum *', type:'date', required:true},
      {key:'km', label:'Kilometerstand', type:'number', min:0},
      {key:'employee', label:'Mitarbeiter', max:100},
      {key:'status', label:'Status', type:'select', options:['Offen','In Bearbeitung','Erledigt']},
      {key:'notes', label:'Bemerkungen / Ersatzteile', type:'textarea', max:2000},
      {key:'points', label:'Arbeitspunkte', type:'points'}
    ],
    receipt: [
      {key:'kind', label:'Belegart', type:'select', options:['Rechnung','Kassenzettel','Tankbeleg','Sonstiger Beleg']},
      {key:'date', label:'Belegdatum *', type:'date', required:true},
      {key:'vendor', label:'Firma / Händler', max:180},
      {key:'amount', label:'Betrag (€)', type:'number', min:0, step:'0.01'},
      {key:'description', label:'Beschreibung', max:240},
      {key:'notes', label:'Bemerkungen', type:'textarea', max:2000},
      {key:'items', label:'Artikel / Positionen', type:'receipt-items'}
    ],
    registration: [
      {key:'side', label:'Dokumentseite', type:'select', options:['Vorderseite','Rückseite','Kompletter Fahrzeugschein']},
      {key:'hsn', label:'HSN (2.1)', max:12},
      {key:'tsn', label:'TSN (2.2)', max:16},
      {key:'vin', label:'FIN / Fahrgestellnummer', max:17}
    ]
  };
  const headings = {vehicle:'Fahrzeugdaten bearbeiten',repair:'Reparatur bearbeiten',
    receipt:'Belegdaten bearbeiten',registration:'Fahrzeugschein bearbeiten'};
  function fieldMarkup(field) {
    const id = 'kfz-edit-' + field.key;
    if (field.type === 'receipt-items') return '<div class="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-2">' +
      '<div class="flex justify-between items-center gap-2"><label class="text-[11px] font-bold text-slate-700">Artikel / Einzelpositionen</label>' +
      '<button type="button" onclick="ECBKfzAddReceiptItem()" class="px-2.5 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-[11px] font-bold border border-indigo-200"><i class="fa-solid fa-plus"></i> Artikel hinzufügen</button></div>' +
      '<div id="kfz-edit-items" class="space-y-2"></div><p class="text-[10px] text-slate-500">Artikelbezeichnung, Menge und Positionsendpreis. Angaben am Originalbeleg prüfen.</p></div>';
    if (field.type === 'points') return '<div class="bg-slate-50 border border-slate-200 p-3 rounded-xl space-y-2">' +
      '<div class="flex justify-between items-center gap-2"><label class="text-[11px] font-bold text-slate-700">Arbeitspunkte</label>' +
      '<button type="button" onclick="ECBKfzAddPoint()" class="px-2.5 py-1.5 bg-indigo-50 text-indigo-700 rounded-lg text-[11px] font-bold border border-indigo-200"><i class="fa-solid fa-plus"></i> Punkt hinzufügen</button></div>' +
      '<div id="kfz-edit-points" class="space-y-2"></div></div>';
    let fieldHtml;
    if (field.type === 'select') {
      fieldHtml = '<select id="' + id + '" class="' + inputClass + '">' +
        field.options.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('') + '</select>';
    } else if (field.type === 'textarea') {
      fieldHtml = '<textarea rows="3" id="' + id + '" maxlength="' + (field.max || 2000) +
        '" class="' + inputClass + '"></textarea>';
    } else {
      fieldHtml = '<input id="' + id + '" type="' + (field.type || 'text') + '" ' +
        (field.required ? 'required ' : '') + (field.max ? 'maxlength="' + field.max + '" ' : '') +
        (field.min != null ? 'min="' + field.min + '" ' : '') +
        (field.step ? 'step="' + field.step + '" ' : '') + 'class="' + inputClass + '">';
    }
    return '<div><label for="' + id + '" class="block text-[11px] font-bold text-slate-700 mb-1">' +
      esc(field.label) + '</label>' + fieldHtml + '</div>';
  }
  function addPoint(value, done) {
    const target = document.getElementById('kfz-edit-points');
    if (!target || target.children.length >= 30) {
      if (target) showToast('Maximal 30 Punkte pro Reparatur.');
      return;
    }
    const row = document.createElement('div');
    row.className = 'kfz-edit-point flex flex-wrap items-center gap-2 p-2 bg-white border border-slate-200 rounded-xl';
    row.innerHTML = '<input type="text" maxlength="180" placeholder="Arbeitspunkt…" class="kfz-point-label flex-1 min-w-[135px] px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs">' +
      '<label class="text-[11px] font-semibold whitespace-nowrap flex items-center gap-1"><input type="checkbox" class="kfz-point-done w-4 h-4"> Erledigt</label>' +
      '<button type="button" title="Punkt entfernen" class="p-1.5 text-rose-600"><i class="fa-solid fa-xmark"></i></button>';
    row.querySelector('.kfz-point-label').value = value || '';
    row.querySelector('.kfz-point-done').checked = !!done;
    row.querySelector('button').addEventListener('click', () => row.remove());
    target.appendChild(row);
  }
  window.ECBKfzAddPoint = () => addPoint('', false);
  function addReceiptItem(item) {
    const container = document.getElementById('kfz-edit-items');
    if (!container) return;
    if (container.children.length >= 40) { showToast('Maximal 40 Positionen pro Beleg.'); return; }
    const row = document.createElement('div');
    row.className = 'kfz-edit-item rounded-xl border border-slate-200 bg-white p-2 grid grid-cols-12 gap-2 items-end';
    row.innerHTML = '<label class="col-span-12 text-[10px] font-bold">Artikel / Leistung<input class="kfz-item-name mt-1 w-full border border-slate-200 rounded-lg p-2 text-xs" maxlength="180" placeholder="Artikel" required></label>' +
      '<label class="col-span-4 text-[10px] font-bold">Menge<input type="number" min="0.001" max="1000" step="any" class="kfz-item-qty mt-1 w-full border border-slate-200 rounded-lg p-2 text-xs"></label>' +
      '<label class="col-span-6 text-[10px] font-bold">Positionspreis (€)<input type="number" min="0" step="0.01" class="kfz-item-amount mt-1 w-full border border-slate-200 rounded-lg p-2 text-xs"></label>' +
      '<button type="button" class="kfz-item-remove col-span-2 text-rose-700 bg-rose-50 rounded-lg p-2" aria-label="Artikel entfernen"><i class="fa-solid fa-xmark"></i></button>';
    row.querySelector('.kfz-item-name').value = item && item.name || '';
    row.querySelector('.kfz-item-qty').value = item && item.quantity != null ? item.quantity : 1;
    row.querySelector('.kfz-item-amount').value = item && item.amount != null ? Number(item.amount).toFixed(2) : '';
    row.querySelector('.kfz-item-remove').addEventListener('click', () => row.remove());
    container.appendChild(row);
  }
  window.ECBKfzAddReceiptItem = () => addReceiptItem(null);
  window.ECBKfzEdit = function (kind, vehicleId, itemId) {
    if (locked()) return;
    const vehicle = carById(vehicleId);
    if (!vehicle) { showToast('Fahrzeug nicht gefunden.'); return; }
    const arrayKey = {repair:'reparaturen',receipt:'belege',registration:'fahrzeugscheine'}[kind];
    const item = kind === 'vehicle' ? vehicle :
      (Array.isArray(vehicle[arrayKey]) ? vehicle[arrayKey].find(x => x.id === itemId) : null);
    if (!item || !schema[kind]) { showToast('Eintrag nicht gefunden.'); return; }
    admin.editor = {kind:kind,vehicleId:vehicleId,itemId:itemId || null};
    document.getElementById('kfz-edit-title').textContent = headings[kind];
    const fields = document.getElementById('kfz-edit-fields');
    fields.innerHTML = schema[kind].map(fieldMarkup).join('');
    schema[kind].forEach(f => {
      if (f.type === 'points') {
        const ps = Array.isArray(item.points) ? item.points : [];
        if (!ps.length) addPoint('',false);
        else ps.forEach(p => addPoint(p.label,p.done));
      } else if (f.type === 'receipt-items') {
        const entries = Array.isArray(item.items) ? item.items : [];
        entries.slice(0,40).forEach(addReceiptItem);
      } else {
        const el = document.getElementById('kfz-edit-' + f.key);
        if (el) el.value = item[f.key] == null ? '' : String(item[f.key]);
      }
    });
    const modal = document.getElementById('modal-kfz-edit');
    modal.classList.remove('hidden');
    const scrollArea = modal.querySelector('.overflow-y-auto');
    if (scrollArea) scrollArea.scrollTop = 0;
  };
  window.ECBKfzCloseEdit = function () {
    const modal = document.getElementById('modal-kfz-edit');
    if (modal) modal.classList.add('hidden');
    admin.editor = null;
  };
  async function updateNested(vehicleId,key,itemId,patch) {
    const ref = db.collection('fahrzeuge_park').doc(vehicleId);
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error('Fahrzeug existiert nicht mehr.');
      const original = Array.isArray(snap.data()[key]) ? snap.data()[key] : [];
      if (!original.some(row => row.id === itemId)) throw new Error('Eintrag existiert nicht mehr.');
      tx.update(ref, {[key]: original.map(row => row.id === itemId ?
        Object.assign({},row,patch,{updatedAt:Date.now()}) : row)});
    });
  }
  window.ECBKfzSaveEdit = async function(event) {
    event.preventDefault();
    if (locked() || !admin.editor) return;
    if (typeof db === 'undefined' || !db) { showToast('Keine Cloud-Verbindung.'); return; }
    const {kind,vehicleId,itemId} = admin.editor;
    const patch = {};
    for (const f of schema[kind]) {
      if (f.type === 'points') {
        patch.points = Array.from(document.querySelectorAll('#kfz-edit-points .kfz-edit-point')).map(row => ({
          label:row.querySelector('.kfz-point-label').value.trim(), done:row.querySelector('.kfz-point-done').checked
        })).filter(p => p.label);
        if (!patch.points.length) { showToast('Mindestens einen Arbeitspunkt eintragen.'); return; }
      } else if (f.type === 'receipt-items') {
        const items = [];
        for (const row of document.querySelectorAll('#kfz-edit-items .kfz-edit-item')) {
          const name = row.querySelector('.kfz-item-name').value.trim();
          const quantity = Number(row.querySelector('.kfz-item-qty').value);
          const raw = row.querySelector('.kfz-item-amount').value.trim();
          const amount = raw === '' ? null : Number(raw);
          if (!name || name.length > 180 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1000 ||
              (amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > 100000000))) {
            showToast('Bitte Artikelbezeichnungen, Mengen und Preise prüfen.'); return;
          }
          items.push({name,quantity,amount});
        }
        patch.items = items;
      } else {
        const value = document.getElementById('kfz-edit-' + f.key).value.trim();
        if (f.required && !value) { showToast('Pflichtfeld fehlt: ' + f.label); return; }
        if (f.type === 'number' && value !== '') {
          const num = Number(value);
          if (!Number.isFinite(num) || num < 0) { showToast('Ungültige Zahl: ' + f.label); return; }
          patch[f.key] = f.key === 'amount' ? num : String(value);
          if (f.key === 'amount') patch[f.key] = num;
        } else patch[f.key] = value;
      }
    }
    if (kind === 'vehicle' && !patch.plate) { showToast('Kennzeichen ist erforderlich.'); return; }
    if (kind === 'registration' && patch.vin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(patch.vin.toUpperCase())) {
      showToast('FIN muss aus 17 gültigen Zeichen bestehen.'); return;
    }
    if (kind === 'registration') {
      patch.hsn = patch.hsn.toUpperCase(); patch.tsn = patch.tsn.toUpperCase(); patch.vin = patch.vin.toUpperCase();
    }
    const button = document.getElementById('kfz-edit-save');
    if (button.disabled) return;
    button.disabled = true;
    try {
      if (kind === 'vehicle') {
        await db.collection('fahrzeuge_park').doc(vehicleId).update(Object.assign({},patch,{updatedAt:Date.now()}));
      } else {
        await updateNested(vehicleId,{repair:'reparaturen',receipt:'belege',registration:'fahrzeugscheine'}[kind],itemId,patch);
      }
      window.ECBKfzCloseEdit();
      showToast('KFZ-Änderungen in Firebase gespeichert.');
    } catch (err) {
      showToast('KFZ-Änderung fehlgeschlagen: ' + (err.code || err.message || 'Cloud-Fehler'));
    } finally { button.disabled = false; }
  };

  function editButton(kind, vehicleId, itemId) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 font-bold text-[11px]';
    btn.innerHTML = '<i class="fa-solid fa-pen mr-1"></i> Bearbeiten';
    btn.addEventListener('click', () => window.ECBKfzEdit(kind,vehicleId,itemId));
    return btn;
  }
  function decorateVehicleCards() {
    const el = document.getElementById('fleet-vehicles-container');
    if (!el) return;
    fleet().forEach((car,i) => {
      const card = el.children[i];
      if (!card) return;
      const deleteBtn = card.querySelector('button[onclick^="deleteFleetVehicle("]');
      if (deleteBtn) deleteBtn.classList.toggle('hidden', !admin.unlocked);
      if (admin.unlocked && deleteBtn) {
        deleteBtn.parentElement.insertBefore(editButton('vehicle',car.id,null),deleteBtn);
      }
    });
  }
  function decorateRepairCards() {
    const el = document.getElementById('fleet-repairs-container');
    if (!el) return;
    const rows = [];
    fleet().forEach(v => (v.reparaturen || []).forEach(r => rows.push({v,r})));
    rows.sort((a,b) => (b.r.date || '').localeCompare(a.r.date || '') ||
      (b.r.createdAt || 0) - (a.r.createdAt || 0));
    rows.forEach(({v,r},i) => {
      const card = el.children[i];
      if (!card) return;
      card.querySelectorAll('button[onclick^="finishFleetRepair("],button[onclick^="deleteFleetRepair("]').forEach(btn => {
        btn.classList.toggle('hidden', !admin.unlocked);
      });
      if (admin.unlocked) {
        let actions = card.querySelector('.flex.flex-wrap.gap-2.pt-1');
        if (!actions) {actions = document.createElement('div'); actions.className='flex flex-wrap gap-2 pt-1';card.appendChild(actions);}
        actions.insertBefore(editButton('repair',v.id,r.id),actions.firstChild);
      }
    });
  }
  function decorateReceiptCards() {
    const el = document.getElementById('fleet-receipts-container'), filter = document.getElementById('receipt-filter-vehicle');
    if (!el || !filter) return;
    const rows=[];
    fleet().forEach(v => {
      if (filter.value && filter.value !== v.id) return;
      (v.belege || []).forEach(r=>rows.push({v,r}));
    });
    rows.sort((a,b) => (b.r.date || '').localeCompare(a.r.date || '') ||
      (b.r.createdAt || 0) - (a.r.createdAt || 0));
    rows.forEach(({v,r},i)=>{
      const card=el.children[i];
      if (!card || !admin.unlocked) return;
      const actions=card.lastElementChild;
      if (actions) actions.insertBefore(editButton('receipt',v.id,r.id),actions.firstChild);
    });
  }
  function decorateRegistrationCards() {
    const el=document.getElementById('fleet-registrations-container'),filter=document.getElementById('registration-filter-vehicle');
    if(!el||!filter||!admin.unlocked)return;
    const vehicles=fleet().filter(v=>(!filter.value||filter.value===v.id)&&Array.isArray(v.fahrzeugscheine)&&v.fahrzeugscheine.length);
    vehicles.forEach((v,i)=>{
      const group=el.children[i];if(!group)return;
      const docs=v.fahrzeugscheine.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      const container=group.lastElementChild;
      docs.forEach((r,j)=>{
        const card=container && container.children[j];if(!card)return;
        const actions=card.lastElementChild;
        if(actions) actions.insertBefore(editButton('registration',v.id,r.id),actions.firstChild);
      });
    });
  }
  function wrapRender(name,decorate) {
    const original=window[name];
    if(typeof original!=='function')return;
    window[name]=function(){const result=original.apply(this,arguments);decorate();return result;};
  }
  function init() {
    const view=document.getElementById('view-vehicle_fleet');
    if(!view)return;
    const header=view.firstElementChild;
    header.insertAdjacentHTML('afterend', '<div id="kfz-admin-panel" class="bg-slate-900 rounded-2xl p-4 text-white shadow-md space-y-3">' +
      '<div class="flex items-center justify-between gap-2"><div><h3 class="text-sm font-black"><i class="fa-solid fa-user-shield text-indigo-300 mr-1.5"></i> KFZ-Adminbereich</h3>' +
      '<p class="text-[11px] text-slate-300 mt-1">Nur mit Passwort: Daten bearbeiten und Einträge löschen</p></div>' +
      '<span id="kfz-admin-badge" class="text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-700 text-slate-200 border border-slate-600">Gesperrt</span></div>' +
      '<form id="kfz-admin-login-form" onsubmit="unlockKfzAdmin(event)" class="flex flex-wrap gap-2 pt-2 border-t border-slate-700">' +
      '<input id="kfz-admin-password" type="password" required autocomplete="off" placeholder="KFZ-Passwort" class="flex-1 min-w-[150px] px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-xl text-xs text-white">' +
      '<button type="submit" class="px-3.5 py-2.5 bg-indigo-600 rounded-xl font-bold text-xs">Entsperren</button></form>' +
      '<div id="kfz-admin-unlocked" class="hidden flex items-center justify-between gap-2 pt-2 border-t border-slate-700">' +
      '<span class="text-[11px] text-emerald-300 font-bold">KFZ-Admin freigeschaltet</span>' +
      '<button type="button" onclick="lockKfzAdmin()" class="px-3 py-2 bg-slate-700 rounded-xl text-xs font-bold">Sperren</button></div></div>');
    document.body.insertAdjacentHTML('beforeend','<div id="modal-kfz-edit" class="fixed inset-0 bg-black/60 z-50 hidden flex items-center justify-center p-3">' +
      '<div class="bg-white rounded-2xl max-w-md w-full p-4 sm:p-5 shadow-2xl max-h-[92vh] overflow-y-auto box-border space-y-3">' +
      '<div class="flex items-center justify-between border-b border-slate-100 pb-2"><h3 id="kfz-edit-title" class="text-sm font-black text-slate-900">KFZ-Daten bearbeiten</h3>' +
      '<button type="button" onclick="ECBKfzCloseEdit()" class="p-1 text-slate-500" aria-label="Schließen"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<form id="kfz-edit-form" onsubmit="ECBKfzSaveEdit(event)" class="space-y-3">' +
      '<div id="kfz-edit-fields" class="space-y-3"></div>' +
      '<button id="kfz-edit-save" type="submit" class="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold text-xs">Änderungen in der Cloud speichern</button></form></div></div>');
    wrapRender('renderFleetVehiclesList',decorateVehicleCards);
    wrapRender('renderFleetRepairsList',decorateRepairCards);
    wrapRender('renderFleetReceiptsList',decorateReceiptCards);
    wrapRender('renderFleetRegistrationsList',decorateRegistrationCards);
    refresh();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
