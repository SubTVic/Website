# Ansatz · Website

Statische Website der Innovationsberatung „Ansatz“ (Arbeitsname). Gebaut nach Entwurf A („Editorial“), ergänzt um die Skizze „vom Knäuel zur Linie“ aus Entwurf D.

## Aufbau

- `index.html`: Startseite
- `impressum.html`, `datenschutz.html`: Rechtliches (Entwurf, Platzhalter in eckigen Klammern ergänzen)
- `css/style.css`: Gestaltung, Akzentfarbe in `--accent`
- `js/main.js`: Skizze, die sich beim Scrollen zeichnet, und Kontaktformular
- `img/`, `media/`: Fotos und Pitch-Video
- `fonts/`: lokal eingebundene Schriften (kein Google-Abruf)

## Kontaktformular

Das Formular öffnet das E-Mail-Programm der Besucherin oder des Besuchers. Die Zieladresse im Attribut `data-to` des Formulars in `index.html` eintragen:

```html
<form class="a-form" data-to="kontakt@beispiel.de" novalidate>
```

## Veröffentlichen

Die Seite wird über GitHub Pages aus dem Branch `master` (Ordner `/`) ausgeliefert. Kein Build-Schritt nötig.

Lokal ansehen: `python3 -m http.server` im Projektordner, dann http://localhost:8000 öffnen.
