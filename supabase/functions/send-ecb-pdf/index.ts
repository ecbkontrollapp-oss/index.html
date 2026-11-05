// ECB PDF-Versand: nur für angemeldete Supabase-Mitarbeiter.
// PDF und Mailtext werden NICHT in Supabase Storage/Database gespeichert.
// Der RESEND_API_KEY und die Absenderadresse gehören ausschließlich in Edge Function Secrets.
import { withSupabase } from 'npm:@supabase/server@^1';

const RECIPIENT = 'pb@ecb-system.de';
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

export default {
  fetch: withSupabase({ auth: 'user' }, async (request, ctx) => {
    if (request.method !== 'POST') {
      return jsonError('Nur POST ist erlaubt.', 405);
    }
    // The actual security control is the verified Supabase user JWT above.
    // Additionally reject unrelated websites, while permitting direct internal calls.
    const origin = request.headers.get('origin');
    if (origin && origin !== 'https://ecbkontrollapp-oss.github.io' &&
        origin !== 'http://localhost:3000' && origin !== 'http://localhost:5173') {
      return jsonError('Diese Website ist für den Versand nicht zugelassen.', 403);
    }
    const email = String(ctx.userClaims?.email ?? '').toLowerCase().trim();
    if (!email || !ctx.userClaims?.id) {
      return jsonError('Bitte mit einem gültigen ECB-Mitarbeiterkonto anmelden.', 403);
    }
    const allowed = String(Deno.env.get('ECB_MAIL_ALLOWED_EMAILS') || '')
      .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
    if (allowed.length && !allowed.includes(email)) {
      return jsonError('Dein Mitarbeiterkonto ist nicht für den PDF-Versand freigegeben.', 403);
    }
    const apiKey = Deno.env.get('RESEND_API_KEY');
    const from = Deno.env.get('ECB_MAIL_FROM');
    if (!apiKey || !from) {
      return jsonError('E-Mail-Dienst noch nicht eingerichtet: RESEND_API_KEY und ECB_MAIL_FROM in Supabase Secrets hinterlegen.', 503);
    }
    if (!/^[^<>\r\n]+<[^<>\s@]+@[^<>\s@]+>$/.test(from) &&
        !/^[^\s<>@]+@[^\s<>@]+$/.test(from)) {
      return jsonError('Die konfigurierte Absenderadresse ist ungültig.', 503);
    }
    const contentType = String(request.headers.get('content-type') || '');
    if (!contentType.includes('multipart/form-data')) {
      return jsonError('Es wird ein PDF als FormData erwartet.', 415);
    }
    const length = Number(request.headers.get('content-length') || '0');
    if (length > MAX_PDF_BYTES + 16000) {
      return jsonError('PDF ist größer als 8 MB.', 413);
    }
    let form;
    try {
      form = await request.formData();
    } catch {
      return jsonError('Der PDF-Anhang konnte nicht eingelesen werden.');
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
    const html = '<div style="font-family:Arial,sans-serif;max-width:640px;color:#21332a">' +
      '<div style="background:#123e31;color:white;padding:20px 24px;border-radius:12px 12px 0 0">' +
      '<div style="font-size:12px;letter-spacing:1px">E.C.B. REINIGUNGSSYSTEME GMBH</div>' +
      '<h2 style="margin:8px 0 0">' + escapeHtml(title) + '</h2></div>' +
      '<div style="padding:20px 24px;border:1px solid #dce7df;border-radius:0 0 12px 12px">' +
      lines.slice(2, 7).map(line => '<p style="margin:8px 0">' +
        escapeHtml(line) + '</p>').join('') +
      '<p style="padding-top:12px"><strong>PDF-Anhang:</strong> ' +
      escapeHtml(safeName) + '</p></div></div>';

    const pdf = new Uint8Array(await attachment.arrayBuffer());
    let provider;
    try {
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
        })
      });
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
    } catch {
      return jsonError('Verbindung zum E-Mail-Dienst fehlgeschlagen. Versandstatus unklar: bitte Postfach prüfen, bevor du erneut sendest.', 502);
    }
    // "accepted" is not the same as "delivered" (bounces can still occur).
    return Response.json({ ok: true, accepted: true, id: provider.id, recipient: RECIPIENT });
  })
};
