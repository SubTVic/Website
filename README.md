# Challenge-Check · Design Thinking

Ein kleines Quiz als statische Website: Man klickt auf „Check starten“, gibt seine Matrikelnummer ein, beantwortet fünf Fragen und bekommt am Ende eine Design-Thinking-Challenge zugewiesen („Du bist perfekt dafür geeignet, diese Challenge zu entwickeln: …“). **Den Check kann man pro Gerät nur einmal machen** (siehe unten).

**Welche Challenge es ist, bestimmt allein die Matrikelnummer** (laut Liste). Die Antworten im Quiz ändern nichts. Über „Apply together as a team“ kann man zusätzlich die Matrikelnummer einer Kollegin oder eines Kollegen eintippen. Das ist nur eine Eingabe und ändert das Ergebnis nicht.

Der Look orientiert sich an der Startup Factory boOst (Petrol, Neongrün, Creme, Space Grotesk, Laufband) und an der Universität Jena (Marineblau, Goldlinie, weiße Karten, Roboto Condensed). Logos und Bilder der beiden sind nicht enthalten.

## Matrikelnummern und Challenges zuordnen

1. **Challenges eintragen** in `js/ergebnisse.js`. Jede Challenge hat eine `id` (z. B. `"forschung-markt"`), einen Titel, eine Leitfrage und eine Beschreibung. Die Beispiele dort müssen ersetzt werden.
2. **Liste anlegen** als Textdatei `privat/zuordnung.csv`, eine Person pro Zeile, mit Semikolon oder Tab getrennt:

   ```
   Matrikelnummer;Challenge
   1234567;1
   2345678;Wissen, das in Köpfen steckt
   3456789;forschung-markt

   Die Nummern werden exakt so verglichen, wie sie in der Liste stehen (führende Nullen zählen: `00001` ist nicht `1`).
   ```

   Die Challenge darf als Nummer (Reihenfolge in `js/ergebnisse.js`, ab 1), als `id` oder als Titel angegeben werden. Der Ordner `privat/` wird **nicht** ins Repository übernommen.
3. **Zuordnung erzeugen** (braucht Node.js):

   ```
   node tools/zuordnung-erzeugen.js privat/zuordnung.csv
   ```

   Das schreibt `js/zuordnung.js` und aktualisiert die Versionsnummern in den Seiten. Bei Fehlern in der Liste (ungültige Nummer, unbekannte Challenge, widersprüchliche Einträge) bricht es mit einer Meldung ab und ändert nichts. Mit `node tools/zuordnung-erzeugen.js --pruefen 1234567` lässt sich eine einzelne Nummer testen.
4. Änderungen hochladen (commit und push auf `master`).

### Wie der Abgleich funktioniert und was er schützt

In `js/zuordnung.js` steht keine Matrikelnummer im Klartext, sondern pro Person ein Hash (PBKDF2-SHA256, 600.000 Runden, mit Salt). Der Browser hasht die Eingabe genauso und vergleicht die Hashes. Eingaben wie `123 4567` oder `123-4567` werden vorher bereinigt (Leerzeichen, Punkte, Bindestriche entfernt). Die Eingabe verlässt den Browser nicht.

**Grenze des Verfahrens:** Matrikelnummern haben nur wenige Millionen mögliche Werte. Wer die Hashes aus dem Repository kopiert, kann deshalb mit viel Rechenleistung (Grafikkarte) alle möglichen Nummern durchprobieren und so herausfinden, welche Nummern auf der Liste stehen. Das dauert bei den gewählten 600.000 Runden mindestens Minuten bis Stunden, ist aber möglich. Der Hash schützt also vor dem Mitlesen im Quelltext, nicht vor einem gezielten Angriff. Außerdem sieht jede Person, die eine Nummer kennt oder errät, durch Eingabe dieser Nummer deren Challenge. Auch die Challenge-Texte stehen lesbar im Quelltext.

Wenn das nicht reicht: zusätzlich einen Veranstaltungscode abfragen, der nicht im Repository steht und in den Hash einfließt (dann reicht die Kenntnis einer Matrikelnummer nicht).

Was mit Nummern passiert, die nicht in der Liste stehen, stellst du in `js/ergebnisse.js` unter `MATRIKEL_TEXTE.unbekannt` ein: `"fehler"` zeigt eine Meldung und startet nicht (Standard), `"zufall"` startet trotzdem und zieht eine zufällige Challenge.

## Nur einmal pro Gerät (Cookie-Sperre)

Sobald jemand den Check abgeschlossen hat, speichert die Seite ein Cookie `challenge_check` (Inhalt: die `id` der Challenge, Dauer: 1 Jahr, nur für den Ordner dieser Seite). Beim nächsten Besuch gibt es weder „Check starten“ noch eine Eingabe, sondern nur das eigene Ergebnis („Du hast den Check schon gemacht. Das ist deine Challenge: …“). Auch ein zweiter Tab kann das nicht umgehen: Wer in einem Tab noch mitten im Quiz ist, während ein anderer Tab schon abgeschlossen hat, bekommt am Ende das bereits gespeicherte Ergebnis.

**Grenzen:** Das Cookie liegt im Browser der Person, eine Sperre ohne Server ist deshalb nicht wasserdicht. Sie fällt weg, wenn jemand Cookies löscht, ein privates Fenster oder ein anderes Gerät/einen anderen Browser nutzt. Safari löscht selbst gesetzte Cookies nach spätestens 7 Tagen. Eine echte Sperre pro Matrikelnummer bräuchte einen kleinen Server oder Dienst, der benutzte Nummern speichert.

**Testen:** Auf der Live-Adresse gilt die Sperre immer. Lokal (Datei per Doppelklick oder `localhost`) ist sie ausgeschaltet, dort kann man beliebig oft durchspielen und die Vorschau `?ergebnis=2` nutzen. Auf der Live-Seite: privates Fenster pro Durchlauf öffnen oder das Cookie `challenge_check` löschen.

Die Texte dazu stehen in `js/ergebnisse.js` unter `ERGEBNIS_TEXTE`. Das Cookie ist in der Datenschutzerklärung beschrieben.

## Die Challenges bearbeiten

Alles Inhaltliche steht in **`js/ergebnisse.js`**, mit Anleitung direkt in der Datei: Titel, Leitfrage, Beschreibung, optional Partner und Link, dazu der Satz über der Challenge. Den Titel darfst du jederzeit ändern, die `id` nicht, sobald eine Liste erzeugt wurde.

**Vorschau (nur lokal):** `index.html?ergebnis=2` zeigt direkt die zweite Challenge, ohne Eingabe und Quiz. Auf der Live-Adresse ist die Vorschau abgeschaltet.

## Die Fragen ändern

Die fünf Fragen stehen in `js/fragen.js` (2 bis 6 Antworten pro Frage, Anzahl der Fragen frei). Die Antworten beeinflussen das Ergebnis nicht.

## Timekeeper unter `/time`

Eine zweite, eigenständige Seite für Coaches im selben Look: `time/index.html` (Adresse: `…/time/`). Sie ist nicht von der Startseite verlinkt und für Suchmaschinen gesperrt (`noindex`).

- **Läuft nach der Uhr:** Die App zeigt, welcher Abschnitt gerade dran ist, die Restzeit als großen Countdown, den Fortschritt und was danach kommt. Vor dem Start, in Lücken des Plans und nach dem letzten Abschnitt zählt sie bis zum nächsten Start herunter bzw. meldet „Geschafft“.
- **Ton am Ende:** Glocke, Gong oder Signal, Lautstärke, optional eine leise Vorwarnung 1 bis 5 Minuten vorher. Einzelne Abschnitte lassen sich im Ablauf über die Glocke stummschalten. Browser spielen Ton erst nach einer ersten Berührung der Seite ab (oben erscheint dann „Ton aktivieren“), und nicht, wenn das Handy gesperrt ist. Darum hält die App den Bildschirm an (wo der Browser das kann).
- **Verlängern um 1 bis 5 Minuten:** Danach wählt man, bei welchen späteren Abschnitten die Zeit wieder weggenommen wird (antippen = ganze Zeit dort, mit − und + aufteilen). Ohne Auswahl rückt alles danach nach hinten. Auch der gerade beendete Abschnitt lässt sich noch bis 10 Minuten danach verlängern.
- **Energizer (Einschub):** 1 bis 5 Minuten, Name frei wählbar. „Jetzt“ unterbricht den laufenden Abschnitt, dessen Rest läuft danach weiter. Oder „Nach …“ einem späteren Abschnitt. Die Zeit kann wie beim Verlängern woanders weggenommen werden.
- **Ende festlegen:** Beim laufenden Abschnitt „Ende festlegen“ antippen und eine Uhrzeit wählen (oder mit −5/−1/+1/+5 anpassen). Der Abschnitt endet dann genau um diese Uhrzeit, alles danach rückt nach hinten oder vorne.
- **Sync:** „Das fängt jetzt an.“ Man tippt den Abschnitt an, der gerade wirklich beginnt, auch einen, der laut App schon vorbei ist (alle vergangenen des Tages stehen unter „Schon vorbei“, der jüngste zuerst). Er startet dann jetzt, alles danach rückt nach hinten oder vorne. Was davor noch lief, endet jetzt. Was dazwischen lag, entfällt.
- **Zeitmodell:** Verzug schiebt die folgenden Abschnitte nach hinten, Vorsprung zieht sie nach vorne. Eine Lücke im Plan (z. B. 12:50 bis 13:00) fängt beides auf: Was nach einer Lücke kommt, beginnt nie früher als geplant.
- **Hinweise als Sternchen:** Statt Textboxen ploppt unten rechts ein Sternchen auf (z. B. nach einer Änderung oder wenn ein Abschnitt endet). Antippen zeigt den Text, bei Änderungen mit „Rückgängig“. In den Dialogen erklärt ein Sternchen, was sich ändert. Unter „Änderungen heute“ lässt sich jede Änderung einzeln entfernen.
- **Ablauf planen:** In der Ablaufliste lassen sich Abschnitte antippen, die noch kommen. Dort ändert man Start- und Enduhrzeit (verschiebt man den Start, wandert das Ende mit und der Abschnitt davor passt sich an) oder streicht einen Abschnitt (und holt ihn wieder zurück). Alles danach rückt nach. Live-Änderungen (Sync, Verlängern, Energizer, Ende festlegen) gibt es nur oben, nicht doppelt in der Liste.
- **Groß-Ansicht** für Beamer oder das quergehaltene Handy.

**Ablauf ändern:** in `time/js/agenda.js` (Anleitung in der Datei). Oder direkt in der App: Optionen → „Ablauf aus Excel einfügen“, dort die Zeilen aus der Excel-Tabelle (Spalten Start bis Wer, gern mit Überschrift und Titelzeile) hineinkopieren. Ein so eingefügter Ablauf gilt nur auf diesem Gerät.

**Was gespeichert wird:** Einstellungen, stummgeschaltete Abschnitte, ein eingefügter Ablauf und die Änderungen des Tages (Verlängern, Energizer, Ende festlegen, Sync) liegen im `localStorage` des Browsers (nur auf diesem Gerät, nichts wird übertragen). Die Änderungen gelten nur für den jeweiligen Tag. Jedes Gerät hat seinen eigenen Stand: Verlängert eine Coachin auf ihrem Handy, sieht das ein anderes Gerät nicht.

**Probelauf:** Optionen → Probelauf, oder direkt `time/?zeit=15:45&tempo=10` (Uhr startet um 15:45 und läuft zehnmal so schnell). Im Probelauf wird nichts vom Tagesstand gespeichert.

## Nach Änderungen an Design oder Skripten

GitHub Pages lässt Dateien bis zu 10 Minuten im Cache. Damit Besucher nach einer Änderung nicht das neue HTML mit altem CSS oder Skript sehen, tragen die Einbindungen Versionsnummern (`css/challenge-check.css?v=…`). Nach Änderungen an `css/` oder `js/` einmal ausführen:

```
node tools/versionieren.js
```

(`tools/zuordnung-erzeugen.js` macht das automatisch mit.)

## Aufbau

- `index.html`: die Seite mit allen fünf Ansichten (Start, Matrikelnummer, Frage, Auswertung, Ergebnis)
- `js/quiz.js`: Ablauf des Quiz; `js/matrikel.js`: Abgleich der Matrikelnummer; `js/zufall.js`: gleichverteilte Zufallsauswahl (nur für unbekannte Nummern mit `unbekannt: "zufall"`)
- `js/zuordnung.js`: erzeugte Zuordnung Hash → Challenge (nicht von Hand ändern)
- `tools/`: `zuordnung-erzeugen.js` (Liste → `js/zuordnung.js`), `versionieren.js` (Versionsnummern)
- `css/challenge-check.css`: Gestaltung; die Farben stehen oben unter `:root`
- `impressum.html`, `datenschutz.html`: Entwürfe, Angaben in eckigen Klammern ergänzen
- `fonts/`: lokal eingebundene Schriften (kein Abruf bei Google)
- `time/`: der Timekeeper (`index.html`, `js/agenda.js` = Ablauf, `js/timekeeper.js` = Logik, `css/timekeeper.css`)

## Veröffentlichen

Die Seite wird über GitHub Pages aus dem Branch `master` (Ordner `/`) ausgeliefert. Kein Build-Schritt nötig.

Lokal ansehen: `python3 -m http.server` im Projektordner, dann http://localhost:8000 öffnen (die `index.html` lässt sich auch direkt per Doppelklick öffnen).
