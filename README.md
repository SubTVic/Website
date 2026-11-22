# Challenge-Check · Design Thinking

Ein kleines Quiz als statische Website: Man beantwortet fünf Fragen und bekommt am Ende eine Design-Thinking-Challenge zugewiesen („Du bist perfekt dafür geeignet, diese Challenge zu entwickeln: …“).

Das Ergebnis wird **zufällig** gezogen, jedes Ergebnis ist gleich wahrscheinlich, unabhängig von den Antworten.

Der Look orientiert sich an der Startup Factory boOst (Petrol, Neongrün, Creme, Space Grotesk, Laufband) und an der Universität Jena (Marineblau, Goldlinie, weiße Karten, Roboto Condensed). Logos und Bilder der beiden sind nicht enthalten.

## Das Ergebnis einstellen

Alles Inhaltliche steht in **`js/ergebnisse.js`**, mit Anleitung direkt in der Datei:

- Jedes Ergebnis hat einen Titel, eine Leitfrage („Wie können wir …?“), eine kurze Beschreibung und optional Partner und Link.
- Neue Ergebnisse: einen `{ … }`-Block kopieren und ergänzen. Nicht mehr benötigte Blöcke löschen. Die Wahrscheinlichkeit verteilt sich automatisch gleich auf alle vorhandenen Ergebnisse.
- Der Satz über der Challenge („Du bist perfekt dafür geeignet …“) und der Text zum Teilen stehen oben in derselben Datei.
- Die fünf Ergebnisse, die jetzt drinstehen, sind nur **Beispiele** und müssen ersetzt werden.

**Vorschau:** `index.html?ergebnis=2` zeigt direkt das zweite Ergebnis, ohne das Quiz durchzuspielen.

## Die Fragen ändern

Die fünf Fragen stehen in `js/fragen.js` (2 bis 6 Antworten pro Frage, Anzahl der Fragen frei). Die Antworten beeinflussen das Ergebnis nicht.

## Aufbau

- `index.html`: die Seite mit allen vier Ansichten (Start, Frage, Auswertung, Ergebnis)
- `js/quiz.js`: Ablauf des Quiz; `js/zufall.js`: die gleichverteilte Zufallsauswahl
- `css/challenge-check.css`: Gestaltung; die Farben stehen oben unter `:root`
- `impressum.html`, `datenschutz.html`: Entwürfe, Angaben in eckigen Klammern ergänzen
- `fonts/`: lokal eingebundene Schriften (kein Abruf bei Google)

## Veröffentlichen

Die Seite wird über GitHub Pages aus dem Branch `master` (Ordner `/`) ausgeliefert. Kein Build-Schritt nötig.

Lokal ansehen: `python3 -m http.server` im Projektordner, dann http://localhost:8000 öffnen (die `index.html` lässt sich auch direkt per Doppelklick öffnen).
