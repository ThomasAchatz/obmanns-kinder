# Einrichtung Schritt für Schritt

Einmal ca. 30 Minuten. Danach läuft alles von selbst: Jeder Push auf `main` veröffentlicht die App neu.

## 1. Supabase-Projekt anlegen

1. Auf [supabase.com](https://supabase.com) anmelden → **New project**.
2. Name: `obmanns-kinder`, Region: **Central EU (Frankfurt)**.
3. Ein **Datenbank-Passwort** vergeben und notieren (brauchst du in Schritt 3).
4. Warten, bis das Projekt bereit ist.

Notiere dir aus dem Projekt:

| Was | Wo |
| --- | --- |
| Project URL | Project Settings → Data API (z. B. `https://abcd1234.supabase.co`) |
| Project Ref | der Teil vor `.supabase.co` (z. B. `abcd1234`) |
| Anon-Key | Project Settings → API Keys → `anon` `public` (oder „Publishable key“) |
| Access Token | Profilbild oben rechts → Account → **Access Tokens** → neues Token |

## 2. Registrierung abschalten (wichtig!)

**Authentication → Sign In / Providers**: „**Allow new users to sign up**“ ausschalten.

Sonst könnte sich jeder, der die Adresse der App kennt, selbst einen Zugang anlegen. Du legst die Spieler später im Admin-Bereich der App an, das funktioniert trotzdem.

## 3. Werte in GitHub eintragen

Im Repo auf GitHub: **Settings → Secrets and variables → Actions**.

Reiter **Variables** → *New repository variable*:

| Name | Wert |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL |
| `VITE_SUPABASE_ANON_KEY` | Anon-Key |

Reiter **Secrets** → *New repository secret*:

| Name | Wert |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | Access Token |
| `SUPABASE_PROJECT_REF` | Project Ref |
| `SUPABASE_DB_PASSWORD` | Datenbank-Passwort |

URL und Anon-Key dürfen öffentlich sein, die Sicherheit kommt aus den Datenbankregeln. Die drei Secrets bleiben geheim.

## 4. GitHub Pages einschalten

**Settings → Pages** → bei *Source* „**GitHub Actions**“ wählen.

## 5. Datenbank und App veröffentlichen

Im Repo auf **Actions**:

1. Links „**Supabase aktualisieren**“ → *Run workflow*. Das legt alle Tabellen, Regeln und Funktionen an und lädt die Edge Functions hoch. Dauert ca. 1–2 Minuten.
2. Links „**App veröffentlichen**“ → *Run workflow*.

Die App ist dann unter `https://thomasachatz.github.io/obmanns-kinder/` erreichbar.

> Falls „Supabase aktualisieren“ scheitert: Im Supabase **SQL Editor** den Inhalt von `supabase/migrations/20261005000000_init.sql` einfügen und ausführen. Die Edge Functions kannst du dann im Dashboard unter **Edge Functions → Deploy a new function → Via Editor** anlegen (`admin-users`, `push` und `music`, Code aus `supabase/functions/`). Bei `push` die JWT-Prüfung ausschalten.

## 6. Dich selbst als Obmann anlegen

1. Supabase → **Authentication → Users → Add user → Create new user**
   - E-Mail: `thomas@obmanns-kinder.example` (der Teil vor dem @ ist dein Benutzername)
   - Passwort: frei wählen
   - **Auto Confirm User** anhaken
2. Supabase → **SQL Editor**:
   ```sql
   update public.profiles set is_admin = true, display_name = 'Thomas' where username = 'thomas';
   ```
3. App öffnen, mit `thomas` und deinem Passwort anmelden.
4. In Chrome: Menü (⋮) → **App installieren** bzw. **Zum Startbildschirm hinzufügen**.

## 7. Push-Benachrichtigungen einrichten

1. In der App: **Profil → Admin-Bereich → Push einrichten → Schlüssel erzeugen**.
2. Supabase → **Edge Functions → Secrets** (bzw. Project Settings → Edge Functions): die zwei angezeigten Werte als `VAPID_KEYS` und `PUSH_SECRET` anlegen.
3. Supabase → **SQL Editor**: den angezeigten SQL-Befehl ausführen.
4. In der App: **Profil → Benachrichtigungen** einschalten.

Freunde mit iPhone müssen die App erst über Safari → Teilen → **Zum Home-Bildschirm** hinzufügen und von dort öffnen, sonst gibt es keine Push-Nachrichten (ab iOS 16.4).

## 8. App aufs Handy bringen

**Android:** die Android-App herunterladen:
`https://github.com/ThomasAchatz/obmanns-kinder/releases/latest/download/obmanns-kinder.apk`
(der Link steht auch in der App unter **Profil → Einstellungen**).

1. Datei öffnen → Android fragt nach „Aus dieser Quelle installieren“ → erlauben.
2. Samsung: Falls die Installation blockiert wird, **Einstellungen → Sicherheit und Datenschutz → Auto Blocker** kurz ausschalten, installieren, wieder einschalten.
3. Die App braucht Chrome im Hintergrund (ist auf fast jedem Android vorhanden).

**iPhone:** Link in **Safari** öffnen → Teilen-Symbol → **Zum Home-Bildschirm**. Danach immer über das Icon öffnen; nur dann gibt es Benachrichtigungen (ab iOS 16.4).

## 9. Freunde anlegen und loslegen

- **Profil → Admin-Bereich → Neuen Spieler anlegen**. Die App schlägt ein Passwort vor; Zugangsdaten danach per Messenger weitergeben.
- Passwort vergessen? Im Admin-Bereich bei der Person auf **Passwort** tippen.
- Bevor es richtig losgeht: Jeder schreibt ein paar Fragen. Für ein Duell braucht es mindestens 5 passende Fragen; unter **Fragen** siehst du, in welchen Kategorien noch welche fehlen.

## Android-App bauen (einmalig)

1. Repo **`thomasachatz.github.io`** anlegen (öffentlich). Dort liegt `.well-known/assetlinks.json`, damit Android der App die Webseite ohne Adressleiste anzeigt.
2. Secret **`ANDROID_KEYSTORE_PASSWORD`** anlegen (mindestens 16 Zeichen). **Nicht verlieren und nicht ändern**, sonst lassen sich spätere Versionen nicht mehr als Update installieren.
3. **Actions → Android-App bauen → Run workflow**. Der erste Lauf erzeugt den Signierschlüssel (`android/obmanns-kinder.keystore`, passwortgeschützt) und `android/assetlinks.json`.

Die Android-App lädt die Inhalte live von der Webseite. Neue Funktionen kommen also ohne neue APK an; neu bauen muss man nur bei Änderungen an Name, Icon oder Farben.

## Musikrunde

- Die Songs fürs Startpaket stehen in `music/startpaket.json` (Interpret, Titel, Genre, Jahrzehnt). Ändert sich die Datei, sucht der Ablauf „**Song-Startpaket laden**“ jeden Song bei iTunes, speichert Vorschau-Link und Cover und spielt sie in Supabase ein. Das dauert rund 15 Minuten, weil iTunes nur etwa 20 Anfragen pro Minute erlaubt.
- Was iTunes nicht findet, steht im Lauf unter *Summary*. Einfach Schreibweise in der JSON-Datei korrigieren und neu committen.
- Die Edge Function `music` sucht für „Song hinzufügen“ bei iTunes und holt frische Vorschau-Links, falls einer nicht mehr spielt. Sie wird mit „Supabase aktualisieren“ automatisch hochgeladen.

## Gut zu wissen

- **Wachhalten:** Kostenlose Supabase-Projekte schlafen nach 7 Tagen ohne Nutzung ein. Der Ablauf „Supabase wachhalten“ pingt alle 2 Tage. Wird er rot, ist das Projekt pausiert → im Supabase-Dashboard auf *Restore* klicken.
- **Monatsende:** Am 1. jedes Monats um 7 Uhr (UTC) wird der Vormonat abgeschlossen und alle bekommen einen Push mit dem Monatssieger.
- **Neue Version:** Nach einem Update zeigt die App oben „Eine neue Version ist da“ → *Jetzt aktualisieren*.
- **Backups:** Das kostenlose Supabase-Paket macht keine automatischen Backups. Wenn euch die Fragensammlung wichtig ist, ab und zu unter *Database → Backups* bzw. per `pg_dump` sichern.
