# ECB-Kontroll-App: PDF per E-Mail ohne Mitarbeiterkonto und ohne Code

**Ziel:** Mitarbeiter öffnen die normale ECB-App, wählen ein vorhandenes Protokoll bzw. eine Fuhrpark-Auswertung und tippen einmal auf **„PDF direkt an pb@ecb-system.de senden“**. Keine Mitarbeiter-E-Mails in Supabase anlegen, kein extra Passwort, kein Versandcode. Die Sicherheitsprüfung läuft unsichtbar im Browser.

**Stand:** Die Quellcodes sind in GitHub vorbereitet. **Der automatische E-Mail-Versand wird erst funktionieren, wenn die Supabase-Funktion veröffentlicht, Resend eingerichtet, das SQL ausgeführt und Cloudflare Turnstile einmalig konfiguriert wurden.** Sonst zeigt die App eine klare Fehlermeldung. Der manuelle Ersatzversand über Mail/Outlook bleibt erhalten.

## Bereits vorhanden

- Supabase-Projekt: `tbagsmopgfvjpcjhekrw`. Der bestehende private Fahrzeugdokumentenspeicher und dessen Benutzeranmeldung bleiben unverändert.
- Firebase-Cloud-History, Fahrzeugscheine, Belege, Fahrzeugwartungen und Urlaubsfunktionen werden nicht umgebaut.
- **Kein** anonymer Supabase-Auth-Login: Das wäre wegen der bestehenden Storage-RLS-Policies nicht sicher (anonyme Nutzer erhalten die Rolle `authenticated`).
- E-Mails werden ausschließlich an `pb@ecb-system.de` gesendet, serverseitig fest eingestellt.
- Das Original-PDF wird auf dem Gerät erzeugt; keine zusätzliche Kopie in Supabase Storage. Resend verarbeitet E-Mail und PDF gemäß seinen Aufbewahrungsregeln.
- Der Server prüft einen **einmaligen Cloudflare-Turnstile-Token** und **ein atomar durch Postgres begrenztes Versandkontingent** (75/24 h global; 30/h global; 10/h und 30/24 h je IP-Hash). Damit können Unbefugte die kostenlose Resend-Quote nicht ohne Weiteres aufbrauchen. Vollständiger Missbrauchsschutz lässt sich für eine öffentliche Website dennoch nicht garantieren.

## Einmalig für den Administrator: Schritt 1 – Resend

1. Kostenlose Registrierung: https://resend.com
2. Unter https://resend.com/domains die Absenderdomain `bgf-elektro.com` hinzufügen.
3. Die geforderten DNS-Einträge bei eurem Domainanbieter setzen, bis bei Resend **Verified** erscheint.
4. Unter https://resend.com/api-keys einen Versand-API-Schlüssel erzeugen. **Nur in Supabase Secrets speichern, niemals in GitHub, Chat oder dem Browsercode.**

Absender: `ECB Protokolle <protokolle@bgf-elektro.com>`; Empfänger bleibt `pb@ecb-system.de`. Erst versenden, wenn die Absenderdomain bei Resend **Verified** ist.

## Schritt 2 – Cloudflare Turnstile kostenlos (unsichtbar)

1. Dashboard https://dash.cloudflare.com öffnen und **Turnstile** auswählen; kostenlose Variante genügt.
2. Ein Widget für den Hostnamen **ecbkontrollapp-oss.github.io** anlegen, Widget-Modus **Invisible** auswählen. Ein Invisible-Widget verlangt keine Eingabe durch Mitarbeiter.
3. Der **Sitekey ist öffentlich**. Nur diesen in `ecb-supabase-config.js` im Feld `turnstileSiteKey` eintragen. Der öffentliche Sitekey ist bereits im App-Code eingetragen.
4. Den geheimen **Secret key** ausschließlich unter Supabase → Edge Functions → Secrets als `ECB_TURNSTILE_SECRET` hinterlegen.
5. Aufgrund der Cloudflare-Bedingungen für Invisible Turnstile den Hinweis auf das Turnstile Privacy Addendum in die Datenschutzhinweise der App aufnehmen.

Turnstile führt eine automatische Browserprüfung durch. Bei einer Blockierung oder Fehlprüfung wird **nicht** ohne Schutz gesendet.

## Schritt 3 – Versandschutz in Supabase aktivieren

1. SQL Editor öffnen: https://supabase.com/dashboard/project/tbagsmopgfvjpcjhekrw/sql/new
2. Den SQL-Quellcode aus `supabase/sql/ecb-mail-rate-limit.sql` einmal ausführen.
3. Das SQL erstellt `ecb_mail_rate_events` mit Zeitstempeln und **gesalzenen IP-Hashes**, aber ohne E-Mail-Inhalte oder PDF-Anhänge.
4. Nur die interne Supabase-Service-Role darf die Quotenfunktion `ecb_mail_consume_quota` aufrufen. Fremde Browser dürfen die Quoten nicht verändern.

## Schritt 4 – Edge Function veröffentlichen und Secrets setzen

Dashboard: https://supabase.com/dashboard/project/tbagsmopgfvjpcjhekrw/functions

- Funktion mit dem Namen **send-ecb-pdf** erstellen.
- Den Code aus `supabase/functions/send-ecb-pdf/index.ts` bereitstellen.
- In Supabase die **JWT-Verifikation für genau diese Funktion abschalten** (`supabase/config.toml`: `verify_jwt = false`). Das ist hier gewollt, weil **statt Mitarbeiter-Login** die serverseitige Turnstile-Verifikation und das Quotenlimit greifen. Alle anderen Supabase-Zugriffsregeln bleiben erhalten.
- Diese Secrets in Supabase hinterlegen:
  - `RESEND_API_KEY` – geheimer Resend-API-Schlüssel.
  - `ECB_MAIL_FROM` – `ECB Protokolle <protokolle@bgf-elektro.com>`.
  - `ECB_TURNSTILE_SECRET` – geheimer Cloudflare-Turnstile-Schlüssel.
  - `ECB_MAIL_RATE_SALT` – ein langer, **zufälliger**, nur für diese Anwendung erzeugter geheimer Wert für das Hashen der IP (mindestens 32 zufällige Bytes, als hex/base64).
- `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` werden von Supabase in gehosteten Edge Functions normalerweise automatisch als Umgebungsvariablen bereitgestellt. Der Service-Role-Key darf **niemals** in öffentliche Dateien.
- **Nicht** das frühere `ECB_MAIL_ALLOWED_EMAILS` verwenden – es wird beim neuen no-login-Versand nicht benötigt.

## Schritt 5 – Test mit dem iPhone

1. App auf https://ecbkontrollapp-oss.github.io/index.html/ öffnen und neu laden.
2. Ein vorhandenes Protokoll in der **History** auswählen und **PDF direkt an pb@ecb-system.de senden** tippen.
3. **Keine Anmeldung, kein Kennwort, keine Codeeingabe.** Die Turnstile-Browserprüfung läuft im Hintergrund.
4. Nach erfolgreicher Annahme bei Resend zeigt die App die Versand-ID. Die endgültige Zustellung im E-Mail-Postfach prüfen.
5. Test wiederholen mit Fuhrpark-Wartungsauswertung, Fahrzeugprotokoll und Tagesgesamtbericht. Automatische Tagesberichte verwenden denselben abgesicherten Versandweg.

Bei Störung bleibt der Button **PDF über Mail-App teilen (Ersatzversand)**.

## Wichtige Hinweise

- Eine grüne Bestätigung bedeutet **Annahme durch den E-Mail-Dienst**, nicht automatisch endgültige Postfachzustellung.
- Aufruf der Funktion ohne gültige Turnstile-Prüfung ist nicht möglich; bei fehlenden Secrets/SQL wird aus Sicherheitsgründen nicht versendet.
- PDFs sind auf **8 MB** begrenzt. Größere PDFs müssen verkleinert oder manuell geteilt werden.
- Resend-Free hat eigenständige Versand- und Speichergrenzen, typischerweise 100 Nachrichten/Tag und 3.000/Monat. Tarifbedingungen vor Produktionsstart prüfen.
- Cloudflare Invisible Turnstile ist eine kostenlose, externe Sicherheitsprüfung; die öffentliche App ist nicht allein durch die Origin-Prüfung geschützt.
- Im produktiven Betrieb AVV, Datenschutzhinweise (inkl. Cloudflare), Domain-Region, Datenhaltung und Berechtigungen prüfen.

## Relevante Dateien

- `supabase/functions/send-ecb-pdf/index.ts` – serverseitiger Mailversand, Turnstile-Verifizierung, Rate Limit
- `supabase/sql/ecb-mail-rate-limit.sql` – SQL zur serverseitigen Rate-Begrenzung
- `supabase/config.toml` – nur für diese Funktion `verify_jwt = false`
- `ecb-supabase-config.js` – öffentlicher Sitekey (kein Secret)
- `ecb-protocol-mail.js` – lokale PDF-Verarbeitung und unsichtbare Turnstile-Prüfung
- `index.html` – Versandbuttons, Versandbestätigung, Rückfall auf Mail/Outlook
