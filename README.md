# Obmanns Kinder

Das Quiz unter Freunden: Duelle, Gruppen-Challenges, selbst geschriebene Fragen und eine Pinnwand für unnützes Wissen. Läuft als installierbare Web-App (PWA) auf GitHub Pages, Daten und Login liegen bei Supabase.

**Einrichtung:** siehe [SETUP.md](SETUP.md) · **Konzept & Regeln:** siehe [KONZEPT.md](KONZEPT.md)

## Aufbau

```
src/                    App (React + TypeScript, Vite)
  pages/                Start, Spielen, Spiel, Fragen, Wissen, Profil, Admin
  components/           Schützenscheibe, Spielkarten, Formular-Bausteine
  lib/                  Supabase-Client, Login, Push, Bilder, Routing
public/                 Manifest, Service Worker (Offline, Updates, Push), Icons
supabase/
  migrations/           Datenbank: Tabellen, Sicherheitsregeln, Spiellogik
  functions/admin-users Spieler anlegen, Passwort setzen, sperren (nur Admin)
  functions/push        Web-Push-Versand
.github/workflows/      App veröffentlichen · Supabase aktualisieren · Supabase wachhalten
```

## Lokal entwickeln

```bash
cp .env.example .env   # Supabase-URL und Anon-Key eintragen
npm install
npm run dev
```

## Wichtige Entscheidungen

- Die richtige Antwort verlässt nie vorab den Server: Gespielt wird nur über Datenbankfunktionen (`next_question`, `submit_answer`), die auch die 30 Sekunden prüfen.
- Niemand bekommt seine eigene Frage. Spielen alle Autoren mit, bekommt der Autor an dieser Stelle eine Ersatzfrage aus derselben Kategorie.
- Login mit Benutzername: intern wird daraus `name@obmanns-kinder.example`. Passwörter setzt nur der Obmann.
