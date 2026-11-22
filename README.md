# Challenge-Check · Design Thinking

Ein kleines Quiz als statische Website: Man gibt seinen Namen ein, beantwortet fünf Fragen und bekommt am Ende eine Design-Thinking-Challenge zugewiesen („Max, du bist perfekt dafür geeignet, diese Challenge zu entwickeln: …“).

**Welche Challenge es ist, bestimmt allein der Name** (laut Namensliste). Die Antworten im Quiz ändern nichts. Über „Apply together as a team“ kann man zusätzlich den Namen einer Kollegin oder eines Kollegen eintippen. Das ist nur eine Eingabe und ändert das Ergebnis nicht.

Der Look orientiert sich an der Startup Factory boOst (Petrol, Neongrün, Creme, Space Grotesk, Laufband) und an der Universität Jena (Marineblau, Goldlinie, weiße Karten, Roboto Condensed). Logos und Bilder der beiden sind nicht enthalten.

## Namen und Challenges zuordnen

1. **Challenges eintragen** in `js/ergebnisse.js`. Jede Challenge hat eine `id` (z. B. `"forschung-markt"`), einen Titel, eine Leitfrage und eine Beschreibung. Die Beispiele dort müssen ersetzt werden.
2. **Namensliste anlegen** als Textdatei `privat/zuordnung.csv`, eine Person pro Zeile, mit Semikolon oder Tab getrennt:

   ```
   Name;Challenge
   Max Mustermann;1
   Erika Musterfrau;Wissen, das in Köpfen steckt
   Jürgen Müller;forschung-markt
   ```

   Die Challenge darf als Nummer (Reihenfolge in `js/ergebnisse.js`, ab 1), als `id` oder als Titel angegeben werden. Der Ordner `privat/` wird **nicht** ins Repository übernommen.
3. **Zuordnung erzeugen** (braucht Node.js):

   ```
   node tools/zuordnung-erzeugen.js privat/zuordnung.csv
   ```

   Das schreibt `js/zuordnung.js`. Bei Fehlern in der Liste (unbekannte Challenge, Name ohne Nachnamen, widersprüchliche Einträge) bricht es mit einer Meldung ab und ändert nichts. Mit `node tools/zuordnung-erzeugen.js --pruefen "Max Mustermann"` lässt sich ein einzelner Name testen.
4. Änderungen hochladen (commit und push auf `master`).

Der Namensabgleich ignoriert Groß-/Kleinschreibung, Umlaute (Müller = Mueller), Bindestriche und doppelte Leerzeichen, erlaubt die Reihenfolge „Nachname, Vorname“ und findet „Max Peter Mustermann“ auch, wenn in der Liste „Max Mustermann“ steht.

**Wichtig zum Datenschutz:** Weil die Seite öffentlich ist, steht in `js/zuordnung.js` keine Namensliste im Klartext, sondern nur Prüfwerte (PBKDF2-SHA256). Wer einen Namen kennt oder errät, kann ihn aber trotzdem eingeben und sieht dessen Challenge. Das ist bei einer Seite ohne Anmeldung nicht zu verhindern. Auch die Challenge-Texte selbst sind im Quelltext lesbar.

Was mit Namen passiert, die nicht in der Liste stehen, stellst du in `js/ergebnisse.js` unter `NAMEN_TEXTE.unbekannt` ein: `"fehler"` zeigt eine Meldung und startet nicht (Standard), `"zufall"` startet trotzdem und zieht eine zufällige Challenge.

## Die Challenges bearbeiten

Alles Inhaltliche steht in **`js/ergebnisse.js`**, mit Anleitung direkt in der Datei: Titel, Leitfrage, Beschreibung, optional Partner und Link, dazu der Satz über der Challenge. Den Titel darfst du jederzeit ändern, die `id` nicht, sobald eine Namensliste erzeugt wurde.

**Vorschau:** `index.html?ergebnis=2` zeigt direkt die zweite Challenge, ohne Namen und Quiz.

## Die Fragen ändern

Die fünf Fragen stehen in `js/fragen.js` (2 bis 6 Antworten pro Frage, Anzahl der Fragen frei). Die Antworten beeinflussen das Ergebnis nicht.

## Aufbau

- `index.html`: die Seite mit allen vier Ansichten (Start mit Namenseingabe, Frage, Auswertung, Ergebnis)
- `js/quiz.js`: Ablauf des Quiz; `js/namen.js`: Namensabgleich; `js/zufall.js`: gleichverteilte Zufallsauswahl (nur für unbekannte Namen mit `unbekannt: "zufall"`)
- `js/zuordnung.js`: erzeugte Zuordnung Name → Challenge (nicht von Hand ändern)
- `tools/zuordnung-erzeugen.js`: erzeugt `js/zuordnung.js` aus der Namensliste
- `css/challenge-check.css`: Gestaltung; die Farben stehen oben unter `:root`
- `impressum.html`, `datenschutz.html`: Entwürfe, Angaben in eckigen Klammern ergänzen
- `fonts/`: lokal eingebundene Schriften (kein Abruf bei Google)

## Veröffentlichen

Die Seite wird über GitHub Pages aus dem Branch `master` (Ordner `/`) ausgeliefert. Kein Build-Schritt nötig.

Lokal ansehen: `python3 -m http.server` im Projektordner, dann http://localhost:8000 öffnen (die `index.html` lässt sich auch direkt per Doppelklick öffnen).
