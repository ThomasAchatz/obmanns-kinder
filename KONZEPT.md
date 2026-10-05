# Konzept: Obmanns Kinder

Stand: 5. Oktober 2026. Ausführliche Fassung mit Recherche: Claude-Dokument „Quiz-App Konzept“.

## Idee

Private Quiz-App für bis zu 10 Freunde. Vorbilder: Quizduell (asynchrones Duell, gleiche Fragen für beide), Trivia Crack (Fragen von den Spielern selbst, Bewertung und Melden), QuizUp (Ranglisten unter Freunden).

## Spielmodi

| Modus | Ablauf | Rangliste |
| --- | --- | --- |
| Duell | 5 Fragen aus 5 zufälligen Kategorien. Herausforderer spielt zuerst, dann bekommt der Gegner per Push dieselben Fragen. Kein Ablaufdatum, Anstupsen 1× pro Tag. | Sieg 3, Unentschieden 1 Punkt |
| Gruppen-Challenge | Alle Eingeladenen spielen dieselben 5 Fragen, jeder wann er will. Endet, wenn alle gespielt haben oder der Ersteller schließt. | Platz 1–3: 3/2/1 Punkte (ab 2 Teilnehmern) |
| Solo-Quiz | 5 Fragen aus einer gewählten Kategorie zum Üben. | zählt nicht |

## Regeln für alle Modi

- 30 Sekunden pro Frage, Zeit abgelaufen = falsch (2 Sekunden Netz-Toleranz).
- Ein 50:50-Joker pro Spiel.
- Mehr Richtige gewinnt, bei Gleichstand die kürzere Gesamtzeit.
- Eigene Fragen bekommt man nie. Spielen alle Autoren mit, gibt es für den Autor an dieser Stelle eine Ersatzfrage aus derselben Kategorie.
- Bevorzugt kommen Fragen, die noch keiner der Mitspieler gesehen hat; schlecht bewertete (Saldo ≤ −3) kommen zuletzt.
- Wer die App während einer Frage schließt und erst nach 30 Sekunden zurückkommt, hat die Frage verloren.

## Fragen

- Format: Frage + 1 richtige + 3 falsche Antworten, Kategorie per Dropdown (10 feste Kategorien, Admin kann ergänzen), optional Bild, Erklärung und Quelle.
- Sofort live, Autor immer sichtbar.
- Nach jeder Frage: Daumen hoch/runter und Melden. Gemeldete Fragen sieht der Obmann im Admin-Bereich.
- Schon gespielte Fragen werden beim Löschen nur ausgeblendet, damit alte Spiele lesbar bleiben.

## Unnützes Wissen

Feed mit Text- und Bild-Posts (keine Videos), Likes, eigene Posts löschbar.

## Push

Neue Challenge, Duell-Herausforderung (sobald der Herausforderer fertig ist), Ergebnis, Anstupser, Monatswertung am 1. des Monats.

## Zugang

Der Obmann legt alle Zugänge an (Benutzername + Passwort) und setzt Passwörter zurück. Öffentliche Registrierung ist aus.

## Design

Vereinsheim statt Spielhalle: Loden-Grün, Kreide, Messing. Ergebnisse werden als Schützenscheibe gezeigt: jede Frage ein Schuss, Treffer im Spiegel (je schneller, desto näher an der Mitte), Fehlschüsse am Rand.
