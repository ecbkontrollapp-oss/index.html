/* ECB vehicle documents: separate, strictly private Supabase Free storage.
 * Firebase Firestore continues to own vehicle metadata and older protocols.
 * New documents are NEVER uploaded to the Firebase Storage paid service.
 */
(function () {
  'use strict';
  let client = null;
  let loginDialog = null;

  function configuration() {
    const cfg = window.ECB_DOCUMENTS_CONFIG || {};
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(String(cfg.projectUrl || '')) ||
        !String(cfg.publishableKey || '').trim() || !/^[a-z0-9_-]+$/.test(String(cfg.bucket || ''))) {
      throw new Error('Der kostenlose Supabase-Dateispeicher ist noch nicht eingerichtet. Bitte zuerst ein Supabase-Free-Projekt erstellen und die öffentliche Projekt-URL sowie den Publishable Key hinterlegen.');
    }
    if (/service_role|sb_secret_/i.test(cfg.publishableKey)) {
      throw new Error('Sicherheitsfehler: Niemals einen Supabase Secret- oder Service-Role-Key in der öffentlichen App verwenden.');
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase-Bibliothek nicht geladen. Bitte die Internetverbindung prüfen und die App neu laden.');
    }
    return {url:cfg.projectUrl.replace(/\/$/, ''), key:cfg.publishableKey, bucket:cfg.bucket};
  }

  function getClient() {
    const cfg = configuration();
    if (!client) {
      client = window.supabase.createClient(cfg.url, cfg.key, {
        auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}
      });
    }
    return {client:client, cfg:cfg};
  }


  // Supabase redirects invitation and password-recovery emails to the app
  // with short-lived credentials in the URL fragment. Capture the type before
  // the Supabase SDK consumes and removes those credentials.
  const incomingAuthLink = (function () {
    const hash = new URLSearchParams(String(window.location.hash || '').replace(/^#/, ''));
    const query = new URLSearchParams(String(window.location.search || '').replace(/^\?/, ''));
    const kind = hash.get('type') || query.get('type') || '';
    return {
      kind:kind,
      isCallback:kind === 'invite' || kind === 'recovery' ||
        (query.has('code') && !query.has('error')),
      error:hash.get('error_description') || query.get('error_description') ||
        hash.get('error') || query.get('error') || ''
    };
  })();
  let passwordSetupShown = false;

  function setupDialog(c, message, canSetPassword) {
    if (passwordSetupShown) return;
    passwordSetupShown = true;
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[120] bg-black/75 flex items-center justify-center p-4';
    overlay.setAttribute('role','dialog');
    overlay.setAttribute('aria-modal','true');
    overlay.setAttribute('aria-label','ECB Supabase Konto aktivieren');
    const title = document.createElement('div');
    title.className = 'font-extrabold text-slate-900 text-lg';
    title.textContent = canSetPassword ? 'ECB-Zugang aktivieren' : 'Einladungslink ungültig';
    const messageNode = document.createElement('p');
    messageNode.className = 'text-sm text-slate-600';
    messageNode.textContent = message;
    const form = document.createElement('form');
    form.className = 'space-y-3';
    form.innerHTML = [
      '<label class="block text-xs font-bold text-slate-700">Neues Passwort (mindestens 12 Zeichen)',
      '<input type="password" autocomplete="new-password" minlength="12" required class="mt-1 w-full border border-slate-300 rounded-xl p-3 text-sm"></label>',
      '<label class="block text-xs font-bold text-slate-700">Passwort bestätigen',
      '<input type="password" autocomplete="new-password" minlength="12" required class="mt-1 w-full border border-slate-300 rounded-xl p-3 text-sm"></label>',
      '<p role="alert" class="hidden text-xs text-rose-700"></p>',
      '<button type="submit" class="w-full p-3 bg-emerald-600 text-white rounded-xl font-bold text-sm">Passwort speichern</button>'
    ].join('');
    if (!canSetPassword) form.classList.add('hidden');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'w-full p-3 border rounded-xl text-slate-700 font-bold text-xs';
    close.textContent = 'Zur ECB-App';
    const content = document.createElement('div');
    content.className = 'bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-4';
    content.appendChild(title);
    content.appendChild(messageNode);
    content.appendChild(form);
    content.appendChild(close);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    const [pw,pwConfirm] = form.querySelectorAll('input[type=password]');
    const warning = form.querySelector('[role=alert]');
    const submit = form.querySelector('button[type=submit]');
    const finish = function () {
      if (pw) pw.value = '';
      if (pwConfirm) pwConfirm.value = '';
      overlay.remove();
      // Remove any link parameters (including one-time tokens) without reload.
      window.history.replaceState(null, '', window.location.pathname);
    };
    close.addEventListener('click',finish);
    form.addEventListener('submit',async function (event) {
      event.preventDefault();
      if (pw.value !== pwConfirm.value) {
        warning.textContent = 'Die Passwörter stimmen nicht überein.';
        warning.classList.remove('hidden');
        return;
      }
      submit.disabled = true;
      warning.classList.add('hidden');
      try {
        const response = await c.auth.updateUser({password:pw.value});
        if (response.error) throw response.error;
        title.textContent = 'Passwort erfolgreich gespeichert';
        messageNode.textContent = 'Dein ECB-Dokumentenzugang ist jetzt aktiviert. Du kannst ab sofort Dokumente hochladen.';
        form.classList.add('hidden');
        close.textContent = 'ECB-App öffnen';
      } catch (error) {
        warning.textContent = 'Passwort konnte nicht gespeichert werden: ' +
          (error.message || 'Bitte einen neuen Einladungs- oder Passwort-Link anfordern.');
        warning.classList.remove('hidden');
      } finally {
        submit.disabled = false;
      }
    });
  }

  // Launch automatically on a genuine auth callback even when the user
  // simply opens the invitation from Mail (without tapping Upload).
  async function handleAuthCallback() {
    if (!incomingAuthLink.isCallback && !incomingAuthLink.error) return;
    try {
      const ctx = getClient();
      const result = await ctx.client.auth.getSession();
      if (result.error) throw result.error;
      if (incomingAuthLink.error) throw new Error(incomingAuthLink.error);
      if (!result.data || !result.data.session) {
        throw new Error('Der Einladungslink ist abgelaufen oder wurde bereits verwendet.');
      }
      setupDialog(ctx.client,'Lege jetzt dein persönliches Passwort für die geschützten Fahrzeugdokumente fest.',true);
    } catch (error) {
      setupDialog(null, 'Einladung konnte nicht bestätigt werden: ' +
        (error.message || 'Ungültiger Link') +
        '. Bitte über den Administrator eine neue Einladung oder Passwort-Wiederherstellung anfordern.',false);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded',handleAuthCallback,{once:true});
  } else {
    handleAuthCallback();
  }

  function login(c) {
    if (loginDialog) return loginDialog;
    loginDialog = new Promise(function (resolve, reject) {
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 z-[110] bg-black/70 flex items-center justify-center p-4';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Anmeldung für sichere Fahrzeugdokumente');
      overlay.innerHTML = [
        '<div class="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm space-y-3">',
        '<div class="font-extrabold text-slate-900 text-base"><i class="fa-solid fa-lock text-emerald-600 mr-1"></i> Sicherer Dokumentenspeicher</div>',
        '<p class="text-xs text-slate-600">Für Rechnungen und Fahrzeugscheine mit deinem freigeschalteten ECB-Supabase-Konto anmelden.</p>',
        '<form class="space-y-3">',
        '<label class="block text-xs font-bold text-slate-700">E-Mail-Adresse',
        '<input type="email" required autocomplete="username" class="w-full mt-1 border border-slate-300 rounded-xl p-3 text-sm" placeholder="E-Mail"></label>',
        '<label class="block text-xs font-bold text-slate-700">Passwort',
        '<input type="password" required autocomplete="current-password" class="w-full mt-1 border border-slate-300 rounded-xl p-3 text-sm"></label>',
        '<p class="text-xs text-rose-700 hidden" role="alert"></p>',
        '<button type="button" class="forgot block w-full text-xs text-sky-700 underline text-left">Passwort vergessen oder Einladung schon geöffnet?</button>',
        '<div class="flex gap-2"><button type="button" class="cancel flex-1 p-3 rounded-xl border text-xs font-bold">Abbrechen</button>',
        '<button type="submit" class="submit flex-1 p-3 rounded-xl bg-emerald-600 text-white text-xs font-bold">Anmelden</button></div>',
        '</form></div>'
      ].join('');
      document.body.appendChild(overlay);
      const form = overlay.querySelector('form');
      const email = overlay.querySelector('input[type=email]');
      const password = overlay.querySelector('input[type=password]');
      const warning = overlay.querySelector('[role=alert]');
      const submit = overlay.querySelector('.submit');
      let closed = false;
      function finish(err) {
        if (closed) return;
        closed = true;
        password.value = '';
        overlay.remove();
        loginDialog = null;
        if (err) reject(err);
        else resolve();
      }
      overlay.querySelector('.forgot').addEventListener('click', async function () {
        const emailAddress = email.value.trim();
        if (!emailAddress || !email.checkValidity()) {
          warning.textContent = 'Bitte zuerst deine eingeladene E-Mail-Adresse eingeben.';
          warning.classList.remove('hidden');
          return;
        }
        const forgotButton = overlay.querySelector('.forgot');
        forgotButton.disabled = true;
        try {
          const result = await c.auth.resetPasswordForEmail(emailAddress, {
            redirectTo:window.location.origin + window.location.pathname
          });
          if (result.error) throw result.error;
          warning.textContent = 'Falls für diese Adresse ein Konto existiert, wurde eine E-Mail mit einem Link zum Festlegen des Passworts versendet.';
          warning.className = 'text-xs text-emerald-700';
        } catch (err) {
          warning.textContent = 'Passwort-Link konnte nicht versendet werden: ' +
            (err.message || 'Bitte später erneut versuchen.');
          warning.className = 'text-xs text-rose-700';
        } finally {
          forgotButton.disabled = false;
        }
      });
      overlay.querySelector('.cancel').addEventListener('click', function () {
        finish(new Error('Anmeldung abgebrochen. Dokument nicht gespeichert.'));
      });
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        submit.disabled = true;
        warning.classList.add('hidden');
        try {
          const result = await c.auth.signInWithPassword({
            email:email.value.trim(), password:password.value
          });
          if (result.error) throw result.error;
          finish();
        } catch (err) {
          warning.textContent = 'Anmeldung fehlgeschlagen: ' + (err.message || 'E-Mail und Passwort prüfen.');
          warning.classList.remove('hidden');
        } finally {
          submit.disabled = false;
        }
      });
      email.focus();
    });
    return loginDialog;
  }

  async function authorized() {
    const ctx = getClient();
    const session = await ctx.client.auth.getSession();
    if (session.error) throw session.error;
    if (!session.data || !session.data.session) {
      await login(ctx.client);
    }
    const current = await ctx.client.auth.getSession();
    if (current.error) throw current.error;
    if (!current.data || !current.data.session || !current.data.session.access_token) {
      throw new Error('Keine gültige Supabase-Anmeldung vorhanden.');
    }
    return {client:ctx.client, cfg:ctx.cfg, token:current.data.session.access_token};
  }

  function safePath(path) {
    if (!/^(fahrzeugbelege|fahrzeugscheine)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(String(path))) {
      throw new Error('Ungültiger Dokumentenpfad.');
    }
    return path;
  }

  async function upload(path, file, mime, onProgress) {
    safePath(path);
    if (!(file instanceof Blob) || !file.size || file.size > 15 * 1024 * 1024) {
      throw new Error('Nur Dateien mit höchstens 15 MB können hochgeladen werden.');
    }
    const auth = await authorized();
    const objectUrl = auth.cfg.url + '/storage/v1/object/' +
      encodeURIComponent(auth.cfg.bucket) + '/' +
      path.split('/').map(encodeURIComponent).join('/');
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', objectUrl, true);
      xhr.timeout = 180000;
      xhr.setRequestHeader('apikey', auth.cfg.key);
      xhr.setRequestHeader('Authorization', 'Bearer ' + auth.token);
      xhr.setRequestHeader('Content-Type', mime);
      xhr.setRequestHeader('x-upsert', 'false');
      xhr.upload.onprogress = function (event) {
        if (event.lengthComputable && event.total > 0 && event.loaded > 0 &&
            typeof onProgress === 'function') {
          onProgress(Math.min(99, Math.floor(event.loaded / event.total * 100)));
        }
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) {
          if (typeof onProgress === 'function') onProgress(100);
          resolve({storagePath:path, storageProvider:'supabase'});
        } else {
          let serverMessage = '';
          try {
            const body = JSON.parse(xhr.responseText || '{}');
            serverMessage = body.message || body.error || body.error_description || '';
          } catch (ignored) {}
          reject(new Error('Supabase Storage HTTP ' + xhr.status + ': ' +
            (serverMessage || 'Zugriffsrechte, privater Bucket oder Free-Kontingent prüfen.')));
        }
      };
      xhr.onerror = function () { reject(new Error('Upload-Verbindung zu Supabase fehlgeschlagen. Bitte Internet und Projekt prüfen.')); };
      xhr.ontimeout = function () { reject(new Error('Der Supabase-Upload hat zu lange gedauert. Bitte erneut versuchen.')); };
      xhr.send(file);
    });
  }

  async function signedUrl(path) {
    safePath(path);
    const auth = await authorized();
    const result = await auth.client.storage.from(auth.cfg.bucket).createSignedUrl(path, 120);
    if (result.error) throw result.error;
    if (!result.data || !result.data.signedUrl) throw new Error('Die Datei konnte nicht freigegeben werden.');
    return result.data.signedUrl;
  }

  async function remove(path) {
    safePath(path);
    const auth = await authorized();
    const result = await auth.client.storage.from(auth.cfg.bucket).remove([path]);
    if (result.error) throw result.error;
    return result.data;
  }

  window.ECBFileStorage = {
    check: configuration,
    upload: upload,
    signedUrl: signedUrl,
    remove: remove
  };
})();
