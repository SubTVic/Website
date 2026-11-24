#!/usr/bin/env node
/* Hängt an alle CSS- und JS-Einbindungen der Seiten eine Versionsnummer an
   (z. B. js/quiz.js?v=3fa91c0b), die sich mit dem Dateiinhalt ändert.

   Warum: GitHub Pages lässt Dateien bis zu 10 Minuten im Cache. Ohne neue
   Adresse zeigen Browser nach einer Änderung teils das neue HTML mit altem
   CSS oder Skript. Mit der Versionsnummer wird immer die passende Datei geladen.

   Benutzung (nach jeder Änderung an css/ oder js/ vor dem Hochladen):
     node tools/versionieren.js */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SEITEN = ["index.html", "impressum.html", "datenschutz.html", "time/index.html"];

function kurzHash(datei) {
  return crypto.createHash("sha1").update(fs.readFileSync(path.join(ROOT, datei))).digest("hex").slice(0, 8);
}

function versioniere() {
  const geaendert = [];
  for (const seite of SEITEN) {
    const pfad = path.join(ROOT, seite);
    if (!fs.existsSync(pfad)) { continue; }
    const html = fs.readFileSync(pfad, "utf8");
    const neu = html.replace(/(\b(?:href|src)=")((?:css|js)\/[^"?]+)(?:\?v=[0-9a-f]+)?(")/g, (treffer, vorn, datei, hinten) => {
      /* Pfade gelten relativ zur Seite (z. B. time/css/… für time/index.html) */
      const ziel = path.join(path.dirname(seite), datei);
      if (!fs.existsSync(path.join(ROOT, ziel))) { return treffer; }
      return vorn + datei + "?v=" + kurzHash(ziel) + hinten;
    });
    if (neu !== html) { fs.writeFileSync(pfad, neu); geaendert.push(seite); }
  }
  return geaendert;
}

if (require.main === module) {
  const g = versioniere();
  console.log(g.length ? "Aktualisiert: " + g.join(", ") : "Alles aktuell.");
}
module.exports = { versioniere };
