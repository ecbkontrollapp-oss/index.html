# ECB Kontroll-App – kostenlose Fahrzeugdokumente mit Supabase Free

Die App nutzt weiterhin Firebase Cloud Firestore für Fahrzeuge, Reparaturen, Kontrollen und Protokolle.
Nur **neue Fahrzeugbelege und Fahrzeugscheine** werden in Supabase Storage gespeichert.
Vorhandene Firebase-Dateireferenzen bleiben als Altbestand lesbar, falls dort Dateien existieren.

## 1. Supabase Free ohne Abrechnung einrichten
1. https://supabase.com öffnen, registrieren, **Free ($0)** auswählen. Nicht auf Pro upgraden, keine kostenpflichtigen Add-ons.
2. Neues Projekt "ECB Fahrzeugdokumente", möglichst **EU-Region** (z. B. Frankfurt) auswählen.
3. In Storage einen Bucket mit exakt `ecb-fahrzeugdokumente` anlegen: **PRIVATE (nicht öffentlich)**, max. Dateigröße 15 MB.
4. In Authentication die **öffentliche Registrierung deaktivieren**. Berechtigte Mitarbeitende einzeln in Authentication > Users hinzufügen/einladen, mit eigenem Passwort. Anmeldungen mit unbestätigter E-Mail sind ggf. blockiert.
5. Im SQL Editor die unten stehenden RLS-Policies ausführen. Dabei `ADMIN_EMAIL_ERSETZEN` durch die E-Mail des Dokumenten-Administrators ersetzen.
6. Unter Project Settings > API Keys die **Project URL** und den **Publishable Key** (oder älteren anon key) kopieren und in `ecb-supabase-config.js` eintragen. Diese beiden Werte dürfen öffentlich sein. **Niemals** Service-Role-Keys, `sb_secret_...`, Benutzerpasswörter oder andere Geheimnisse auf GitHub veröffentlichen.
7. App neu laden. Bei erstem Dokumenten-Zugriff mit dem angelegten Benutzerkonto anmelden.

## 2. Sichere Storage-Policies (SQL Editor)

> Nur ausführen, nachdem der private Bucket existiert. Diese Policies gelten für diesen einen Bucket. **Keine anon/öffentlichen Zugriffe** erlauben.

```sql
create policy "ECB docs insert for signed-in staff"
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ecb-fahrzeugdokumente'
  and (storage.foldername(name))[1] in ('fahrzeugbelege', 'fahrzeugscheine')
);

create policy "ECB docs read for signed-in staff"
on storage.objects
for select to authenticated
using (
  bucket_id = 'ecb-fahrzeugdokumente'
  and (storage.foldername(name))[1] in ('fahrzeugbelege', 'fahrzeugscheine')
);

-- Nur das authentifizierte Administrator-Konto darf Objekte wirklich löschen.
-- E-Mail-Adresse vor Ausführung ersetzen (Schreibweise in Kleinbuchstaben).
create policy "ECB docs delete by administrator"
on storage.objects
for delete to authenticated
using (
  bucket_id = 'ecb-fahrzeugdokumente'
  and lower(auth.jwt()->>'email') = lower('ADMIN_EMAIL_ERSETZEN')
);
```

Wichtig: Das KFZ-Adminpasswort in der Website ist lediglich ein **Oberflächen-Schutz** und kein Ersatz für die Supabase-Zugriffsregeln. Zum Löschen von Dateien ist daher zusätzlich der korrekte Supabase-Administrator-Login nötig.

## 3. Eigenschaften und Grenzen
- Free: 0 $ Grundgebühr; keine automatische Umstellung auf kostenpflichtigen Tarif.
- Storage 1 GB; Datenübertragung derzeit 5 GB/Monat; App erlaubt max. 15 MB pro Datei.
- Bei Überschreiten können Uploads/Downloads eingeschränkt werden. Kosten entstehen nicht allein durch die Nutzung von Free.
- Bei geringer Aktivität kann das Free-Projekt nach rund sieben Tagen pausieren und muss im Dashboard reaktiviert werden.
- Für geschäftliche und personenbezogene Dokumente: Datenschutz, Auftragsverarbeitungsvertrag, Region, Berechtigungen und unabhängige Backups prüfen.
- Der private Bucket gibt Datei-Links ausschließlich für zwei Minuten aus. Nur angemeldete, berechtigte Mitarbeitende können diese anfordern.
- Bestehende Firebase Firestore Daten werden bei der Umstellung weder gelöscht noch migriert.

## 4. Prüfung
- Kleine harmlose Testdatei am Fahrzeug hochladen, in der App ansehen, anschließend mit dem Admin-Konto löschen.
- **Keine echten persönlichen Dokumente hochladen**, bevor die privaten Policies und Benutzerrechte getestet wurden.
