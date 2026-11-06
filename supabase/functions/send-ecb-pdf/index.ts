// ECB PDF-Versand ohne Mitarbeiter-Login: Turnstile + serverseitiges Kontingent.
// Nur PDF/Resend-Übermittlung; keine Mail-Inhalte in Supabase Storage/Database.
// Alle Geheimnisse ausschließlich in Supabase Edge Function Secrets.

const RECIPIENT = 'pb@ecb-system.de';
const CONTROL_ORIGINAL_LOGO = 'https://ecbkontrollapp-oss.github.io/index.html/icons/icon-512.png';
const MAX_PDF_BYTES = 8 * 1024 * 1024;

function clean(value, length = 160) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, length);
}
function escapeHtml(value) {
  return clean(value, 500).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}
function jsonError(message, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}
function asBase64(bytes) {
  // Chunking prevents a stack overflow for larger PDFs in Deno.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}

const APP_ORIGIN='https://ecbkontrollapp-oss.github.io';
function jsonOkCors(response, origin) {
  const headers=new Headers(response.headers);
  if(origin===APP_ORIGIN) headers.set('Access-Control-Allow-Origin',APP_ORIGIN);
  headers.set('Vary','Origin');
  headers.set('Access-Control-Allow-Headers','apikey, content-type, x-client-info');
  headers.set('Access-Control-Allow-Methods','POST, OPTIONS');
  headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,headers});
}
async function digestIp(value,salt){
  const bytes=new TextEncoder().encode(salt+':'+value);
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return Array.from(hash,x=>x.toString(16).padStart(2,'0')).join('');
}
async function checkTurnstile(token, secret, ip) {
  console.info('ECB PDF send: Turnstile verification started');
  const form=new URLSearchParams({secret,response:token});
  if(ip)form.set('remoteip',ip);
  const result=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:form,
    signal:AbortSignal.timeout(7000)
  });
  if(!result.ok)return false;
  const json=await result.json();
  console.info('ECB PDF send: Turnstile verification answered');
  return json.success===true && json.hostname==='ecbkontrollapp-oss.github.io' &&
    json.action==='ecb_pdf_send';
}
function serverSupabaseKey(){
  // Prefer modern sb_secret_ keys, which remain active if legacy JWT keys are disabled.
  try {
    const keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
    if(typeof keys.default==='string'&&keys.default)return keys.default;
  } catch { /* Fall back to legacy server credentials. */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
}
async function reserveQuota(ipHash){
  console.info('ECB PDF send: quota check started');
  const endpoint=Deno.env.get('SUPABASE_URL');
  const secret=serverSupabaseKey();
  if(!endpoint||!secret)throw Error('Supabase Server-Schlüssel fehlen.');
  const headers={
    apikey:secret,
    'Content-Type':'application/json'
  };
  // Modern sb_secret_ keys are API keys, not JWTs: never send them as Bearer tokens.
  if(!secret.startsWith('sb_secret_'))headers.Authorization='Bearer '+secret;
  const response=await fetch(endpoint.replace(/\/$/,'')+'/rest/v1/rpc/ecb_mail_consume_quota',{
    method:'POST',
    headers,
    body:JSON.stringify({p_ip_hash:ipHash}),
    signal:AbortSignal.timeout(7000)
  });
  if(!response.ok){
    console.error('ECB rate limit RPC unavailable:',response.status);
    throw Error('Sende-Limit noch nicht eingerichtet. SQL-Funktion im Supabase-Projekt ausführen.');
  }
  console.info('ECB PDF send: quota check answered');
  return (await response.json())===true;
}
async function handle(request){
    console.info('ECB PDF send: incoming request', request.method);
    if(request.method!=='POST')return jsonError('Nur POST ist erlaubt.',405);

    // Supabase can stall on multipart uploads when the handler returns early
    // without first consuming the body. Read it before checking secrets/Origin
    // so the client gets a real error instead of waiting for its timeout.
    const contentType=String(request.headers.get('content-type')||'');
    if(!contentType.includes('multipart/form-data')){
      console.warn('ECB PDF send: unsupported content type');
      return jsonError('Es wird ein PDF als FormData erwartet.',415);
    }
    const length=Number(request.headers.get('content-length')||'0');
    if(length>MAX_PDF_BYTES+16000){
      console.warn('ECB PDF send: file exceeds request limit',length);
      return jsonError('PDF ist größer als 8 MB.',413);
    }
    console.info('ECB PDF send: receiving multipart PDF',length||'unknown');
    let form;
    try{
      form=await request.formData();
    }catch(error){
      console.error('ECB PDF send: multipart decode failed',error?.name||'unknown');
      return jsonError('Der PDF-Anhang konnte nicht eingelesen werden.');
    }
    console.info('ECB PDF send: multipart PDF received');

    if(request.headers.get('origin')!==APP_ORIGIN){
      console.warn('ECB PDF send: blocked request origin');
      return jsonError('Diese Website ist für den Versand nicht zugelassen.',403);
    }
    const apiKey=Deno.env.get('RESEND_API_KEY');
    // Public sender identity, not a credential: use the already verified domain if no optional sender setting exists.
    const from=Deno.env.get('ECB_MAIL_FROM')?.trim() || 'ECB Protokolle <protokolle@bgf-elektro.com>';
    const challengeSecret=Deno.env.get('ECB_TURNSTILE_SECRET');
    const salt=Deno.env.get('ECB_MAIL_RATE_SALT')||serverSupabaseKey();
    if(!apiKey||!from||!challengeSecret||!salt){
      console.error('ECB PDF send: configuration missing',{
        resend:!!apiKey,sender:!!from,turnstile:!!challengeSecret,rateLimitKey:!!salt
      });
      return jsonError('E-Mail-Einstellungen fehlen in Supabase: Resend, Absender, Turnstile oder interner Schlüssel. In Edge Function Secrets kontrollieren.',503);
    }
    if(!/^[^<>\r\n]+<[^<>\s@]+@[^<>\s@]+>$/.test(from)&&
       !/^[^\s<>@]+@[^\s<>@]+$/.test(from)){
      console.error('ECB PDF send: invalid sender format');
      return jsonError('Die konfigurierte Absenderadresse ist ungültig.',503);
    }
    const attachment = form.get('attachment');
    if (!(attachment instanceof File) || !attachment.size ||
        attachment.size > MAX_PDF_BYTES) {
      return jsonError('Es fehlt ein gültiger PDF-Anhang (maximal 8 MB).', 413);
    }
    const header = new Uint8Array(await attachment.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...header) !== '%PDF-') {
      return jsonError('Der Anhang ist keine gültige PDF-Datei.');
    }
    const token=String(form.get('turnstile_token')||'');
    if(!token || token.length>4096) return jsonError('Unsichtbare Sicherheitsprüfung fehlt. App neu laden.',403);
    const ip=(request.headers.get('cf-connecting-ip') ||
      (request.headers.get('x-forwarded-for')||'').split(',')[0] || 'unknown').trim();
    try{
      const passed=await checkTurnstile(token,challengeSecret,ip);
      if(!passed)return jsonError('Sicherheitsprüfung fehlgeschlagen. Bitte erneut versuchen.',403);
    }catch{
      return jsonError('Sicherheitsprüfung nicht erreichbar. Bitte später versuchen.',503);
    }
    // Global and per-IP DB quotas prevent repeated/parallel abuse.
    try{
      const ipHash=await digestIp(ip,salt);
      const allowed=await reserveQuota(ipHash);
      if(!allowed)return jsonError('Versandlimit erreicht. Bitte später erneut versuchen oder PDF über die Mail-App teilen.',429);
    }catch(error){
      return jsonError(error.message||'Schutzfunktion nicht verfügbar.',503);
    }

    const title = clean(form.get('Protokollart'), 100) || 'Kontrollprotokoll';
    const date = clean(form.get('Kontrolldatum'), 20) || 'Ohne Datum';
    const time = clean(form.get('Uhrzeit'), 20);
    const inspector = clean(form.get('Pruefer / Mitarbeiter'), 100);
    const vehicle = clean(form.get('Fahrzeug'), 40);
    const summary = clean(form.get('Zusammenfassung'), 450);
    const filename = (clean(form.get('Dokument'), 130) ||
      clean(attachment.name, 130) || 'ECB-Protokoll.pdf')
      .replace(/[^a-zA-Z0-9_.-]/g, '_').replace(/^\.*/, '').slice(0, 125);
    const safeName = filename.toLowerCase().endsWith('.pdf') ? filename : filename + '.pdf';
    const subject = '[ECB] ' + title + ' | ' + date + (vehicle ? ' | ' + vehicle : '');
    const lines = [
      'E.C.B. Reinigungssysteme GmbH', 'Protokoll: ' + title,
      'Datum: ' + date, 'Uhrzeit: ' + (time || '-'),
      'Prüfer/Mitarbeiter: ' + (inspector || '-'),
      'Fahrzeug: ' + (vehicle || '-'), 'Zusammenfassung: ' + (summary || '-'),
      'Das vollständige Protokoll ist als PDF beigefügt.'
    ];
    const html = '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
      '<body style="margin:0;padding:24px 10px;background:#eef4f1;color:#21332a;font-family:Arial,Helvetica,sans-serif;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;margin:0 auto;background:white;border:1px solid #dce7df;border-radius:16px;overflow:hidden">' +
      '<tr><td style="padding:26px 28px;background:#164d40;color:#ffffff">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
      '<td width="112" valign="middle" style="padding-right:16px"><img src="' + CONTROL_ORIGINAL_LOGO +
      '" width="100" height="100" alt="ECB Kontroll App – Original-Logo" style="display:block;width:100px;height:100px;border-radius:16px;background:white;border:0"></td>' +
      '<td valign="middle"><div style="font-size:22px;font-weight:bold;line-height:1.25">ECB Kontroll App</div>' +
      '<div style="font-size:11px;line-height:1.6;letter-spacing:1px;color:#d5eade;margin-top:5px">E.C.B. REINIGUNGSSYSTEME GMBH</div>' +
      '<div style="font-size:13px;line-height:1.5;color:#e0f0e6;margin-top:10px">Digitales Prüf- und Kontrollprotokoll</div></td></tr></table></td></tr>' +
      '<tr><td style="padding:30px 28px">' +
      '<div style="font-size:11px;font-weight:bold;letter-spacing:1.2px;color:#2c7855">IHR DOKUMENT</div>' +
      '<h1 style="font-size:23px;line-height:1.3;margin:12px 0 18px;color:#1b4832">' + escapeHtml(title) + '</h1>' +
      '<p style="font-size:14px;line-height:1.7;margin:0 0 20px;color:#3e5647">Das vollständige Dokument finden Sie als PDF im Anhang dieser E-Mail.</p>' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f9f4;border:1px solid #e0ebe2;border-radius:10px">' +
      lines.slice(2, 7).map(line => '<tr><td style="padding:11px 14px;font-size:13px;line-height:1.5;color:#2c5038;border-bottom:1px solid #e5eee6">' + escapeHtml(line) + '</td></tr>').join('') +
      '</table><p style="padding-top:18px;font-size:13px;color:#315843"><strong>PDF-Anhang:</strong> ' + escapeHtml(safeName) + '</p></td></tr>' +
      '<tr><td style="padding:18px 28px;background:#f7faf8;border-top:1px solid #e2e9e4;font-size:12px;line-height:1.7;color:#708174">' +
      'E.C.B. Reinigungssysteme GmbH<br>Automatisch erstellt durch die ECB Kontroll App</td></tr></table></body></html>';

    console.info('ECB PDF send: PDF accepted, preparing Resend request');
    const pdf = new Uint8Array(await attachment.arrayBuffer());
    let provider;
    try {
      console.info('ECB PDF send: Resend request started');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to: [RECIPIENT],
          subject,
          text: lines.join('\n') + '\nPDF: ' + safeName,
          html,
          attachments: [{ filename: safeName, content: asBase64(pdf), content_type: 'application/pdf' }]
        }),
        signal:AbortSignal.timeout(12000)
      });
      console.info('ECB PDF send: Resend HTTP status', response.status);
      provider = await response.json().catch(() => ({}));
      if (!response.ok || !provider?.id) {
        console.error('ECB Resend response', response.status, provider?.name || 'unknown');
        return jsonError(
          response.status === 401 || response.status === 403
            ? 'Resend-Zugang oder Absenderdomain nicht freigegeben. Supabase Secrets und Resend Domains prüfen.'
            : response.status === 429
            ? 'E-Mail-Tageslimit oder Versandrate erreicht. Bitte später erneut versuchen.'
            : 'E-Mail-Dienst hat den Versand nicht angenommen (HTTP ' + response.status + ').',
          response.status === 429 ? 429 : 502
        );
      }
    } catch(error) {
      console.error('ECB PDF send: Resend call failed', error?.name || 'unknown');
      return jsonError('E-Mail-Dienst antwortet nicht rechtzeitig. Versandstatus unklar: bitte Postfach prüfen, bevor du erneut sendest.', 502);
    }
    // "accepted" is not the same as "delivered" (bounces can still occur).
    return Response.json({ ok: true, accepted: true, id: provider.id, recipient: RECIPIENT });
}
Deno.serve(async request=>{
  const origin=request.headers.get('origin');
  if(request.method==='OPTIONS'){
    if(origin!==APP_ORIGIN)return new Response(null,{status:403});
    return jsonOkCors(new Response(null,{status:204}),origin);
  }
  try{
    return jsonOkCors(await handle(request),origin);
  }catch(error){
    console.error('ECB PDF mail internal error',error?.message||'unknown');
    return jsonOkCors(jsonError('Versand vorübergehend nicht verfügbar. Bitte später erneut versuchen.',503),origin);
  }
});
