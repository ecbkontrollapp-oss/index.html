# ECB Protokollversand: Supabase Edge Function + Resend

**Status:** Frontend und Edge-Function-Quellcode liegen im GitHub-Repository. **Die Edge Function wird nicht durch GitHub Pages bereitgestellt.** Sie muss einmal im bestehenden Supabase-Projekt veröffentlicht und mit Secrets konfiguriert werden. Vorher ist der automatische PDF-Versand bewusst nicht funktionsfähig; die App zeigt eine Fehlermeldung und bietet weiterhin `PDF über Mail-App teilen` an.

## Bestehende Infrastruktur

- Supabase-Projekt: `tbagsmopgfvjpcjhekrw` (vorhandene Dokumenten-Anmeldung)
- Empfänger ist serverseitig fest: `pb@ecb-system.de`.
- PDF wird erst beim Versand **lokal** aus dem aktuell ausgewählten Protokoll erzeugt.
- Die App verwendet den vorhandenen Supabase-Auth-Login. Nur Benutzer mit gültigem Supabase-Session-JWT dürfen die Funktion aufrufen.
- Firestore-History, Fahrzeuge, Dokumenten-Bucket und die bisherigen Protokolle werden **nicht migriert oder gelöscht**.
- Es gibt keine zusätzliche Mail-History-Tabelle und keinen zusätzlichen PDF-Upload in Supabase.
- Resend verarbeitet die E-Mail mit PDF-Anhang und kann Übermittlungsinhalte gemäß seinem Vertrag vorhalten.

## 1. Resend Free einrichten

1. Auf https://resend.com registrieren und den **Free**-Tarif wählen.
2. Unter https://resend.com/domains die Domain `ecb-system.de` hinzufügen und die verlangten DNS-Einträge beim Domainanbieter setzen. Warten, bis **Verified** angezeigt wird. Domain-Überprüfung ist notwendig, auch wenn die Zieladresse bereits Mails empfängt.
3. Unter https://resend.com/api-keys einen API-Schlüssel mit minimalen Versandberechtigungen erzeugen. **Nicht in Chat, Mail, JavaScript oder GitHub kopieren.** Der Schlüssel wird nur in Supabase Secrets hinterlegt.

Empfohlener Absender nach erfolgreicher Domainprüfung:
`E.C.B. Protokolle <pb@ecb-system.de>`

## 2. Edge Function im bestehenden Supabase-Projekt veröffentlichen

Dashboard: https://supabase.com/dashboard/project/tbagsmopgfvjpcjhekrw/functions

- Neue Edge Function mit dem exakten Namen **send-ecb-pdf** anlegen.
- Den vollständigen Quellcode aus `supabase/functions/send-ecb-pdf/index.ts` übernehmen und veröffentlichen. Alternativ lokal mit der Supabase CLI: `supabase link --project-ref tbagsmopgfvjpcjhekrw`, dann `supabase functions deploy send-ecb-pdf`.
- **JWT-Verifizierung eingeschaltet lassen:** `supabase/config.toml` enthält `verify_jwt = true`.
- Unter Supabase Dashboard → Edge Functions → Secrets die folgenden Werte hinterlegen:
  - `RESEND_API_KEY` → geheimer Resend-Schlüssel
  - `ECB_MAIL_FROM` → `E.C.B. Protokolle <pb@ecb-system.de>`
  - Optional `ECB_MAIL_ALLOWED_EMAILS` → Komma-getrennte E-Mail-Adressen zugelassener Supabase-Mitarbeiter. Ist die Liste gesetzt, dürfen nur diese Benutzer versenden. Andernfalls sind alle angemeldeten Supabase-Benutzer freigegeben.
- Die öffentliche `ecb-supabase-config.js` **nicht** mit geheimen Schlüsseln ergänzen.
- In Supabase Auth **öffentliche Benutzerregistrierungen ausgeschaltet lassen** und nur vertrauenswürdige Mitarbeiter einzeln einladen.

## 3. Auf dem iPhone prüfen

1. App öffnen: https://ecbkontrollapp-oss.github.io/index.html/ und neu laden.
2. Aus der History ein gespeichertes Kontrollprotokoll öffnen.
3. Auf **PDF direkt an pb@ecb-system.de senden** tippen.
4. Bei Bedarf mit dem bestehenden ECB-Supabase-Mitarbeiterkonto anmelden.
5. Die App zeigt die **Resend-Versand-ID**, sobald Resend die E-Mail angenommen hat. Diese Annahme ist noch kein endgültiger Zustellnachweis; Eingang im Postfach prüfen.
6. Dasselbe mit einer Fahrzeugwartung bzw. einer Fuhrpark-Auswertung testen.

Fehlerfälle:
- **404:** Funktion in Supabase noch nicht deployed (oder falscher Name).
- **401/403:** Keine gültige Supabase-Session bzw. Konto nicht freigegeben.
- **503:** Supabase Secrets noch nicht gesetzt.
- **502:** Versanddienst/Absenderdomain/Netzwerkfehler.
- **413:** PDF größer als 8 MB. Bilder reduzieren.
- Bei Verbindungsabbruch nach Versand kann die Zustellung **unklar** sein. Postfach prüfen, bevor nochmals gesendet wird (sonst mögliche Dubletten).

## Datenschutz und Kosten

- Supabase und Resend besitzen getrennte Freikontingente und Richtlinien. Der Resend-Free-Tarif erlaubt derzeit bis zu 100 Mails/Tag und 3.000 Mails/Monat.
- Die App speichert weder das Sende-PDF noch E-Mail-Entwürfe zusätzlich in Supabase. Empfänger, Inhalt und PDF gehen jedoch zur Verarbeitung an **Resend**.
- Vor dem Produktivbetrieb prüfen: Auftragsverarbeitung (AVV), Datenverarbeitungsregion, Mitarbeiterberechtigungen, Speicher-/Löschfristen sowie vertrauliche Details auf Protokollen.
- Der kostenlose Supabase-Tarif kann bei Inaktivität pausieren. Für produktionskritische Abläufe bitte berücksichtigen.

## Technische Dateien

- `supabase/functions/send-ecb-pdf/index.ts` – serverseitige authentifizierte Resend-Schnittstelle
- `supabase/config.toml` – JWT-Absicherung
- `ecb-documents.js` – vorhandene Mitarbeiteranmeldung wird wiederverwendet
- `ecb-protocol-mail.js` – PDF-Payload und Supabase-Aufruf
- `index.html` – Direktversand, Fehlermeldung, manueller Mail-Ausweichweg, automatischer Tagesgesamtbericht

**Wichtig:** Erst nach erfolgreichem Resend-Domaintest und Supabase-Deployment kann die App selbstständig E-Mails verschicken.
