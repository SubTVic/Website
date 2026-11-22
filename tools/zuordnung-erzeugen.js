#!/usr/bin/env node
/* Erzeugt js/zuordnung.js aus einer Liste "Matrikelnummer;Challenge".

   Benutzung:
     node tools/zuordnung-erzeugen.js privat/zuordnung.csv
     node tools/zuordnung-erzeugen.js --pruefen 1234567

   Format der Liste (eine Person pro Zeile, Trennzeichen ; oder Tab):
     1234567;1
     2345678;Wissen, das in Köpfen steckt
     3456789;forschung-markt
   Die Challenge kann als Nummer (Reihenfolge in js/ergebnisse.js, ab 1), als
   id oder als Titel angegeben werden. Eine Kopfzeile "Matrikelnummer;Challenge"
   ist erlaubt.

   Die Liste mit den Matrikelnummern gehört NICHT ins Repository (Ordner
   privat/ ist ausgeschlossen). In js/zuordnung.js landen nur Hashes. */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const Matrikel = require("../js/matrikel.js");
const { versioniere } = require("./versionieren.js");

const ROOT = path.join(__dirname, "..");
const AUSGABE = path.join(ROOT, "js", "zuordnung.js");
const ITERATIONEN = 600000;

function ladeWindow(datei) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(datei, "utf8"), ctx);
  return ctx.window;
}

function norm(s) { return String(s).toLowerCase().replace(/\s+/g, " ").trim(); }

function trenne(zeile) {
  for (const sep of [";", "\t", "|"]) {
    const i = zeile.indexOf(sep);
    if (i > -1) { return [zeile.slice(0, i), zeile.slice(i + 1)]; }
  }
  return null;
}

function entquote(s) { return s.trim().replace(/^"(.*)"$/, "$1").trim(); }

async function pruefen(eingabe) {
  if (!fs.existsSync(AUSGABE)) { console.error("js/zuordnung.js gibt es noch nicht."); process.exit(1); }
  const z = ladeWindow(AUSGABE).ZUORDNUNG;
  const id = await Matrikel.finde(eingabe, z);
  console.log(id === null ? "Nicht gefunden." : "Gefunden: Challenge-ID \"" + id + "\"");
}

async function erzeugen(listeDatei) {
  const ergebnisse = ladeWindow(path.join(ROOT, "js", "ergebnisse.js")).ERGEBNISSE || [];
  const fehler = [];
  const ids = new Set();
  ergebnisse.forEach((e, i) => {
    if (!e.id) { fehler.push("Challenge " + (i + 1) + " (" + (e.titel || "ohne Titel") + ") hat keine id in js/ergebnisse.js."); }
    else if (ids.has(e.id)) { fehler.push("Die id \"" + e.id + "\" kommt in js/ergebnisse.js mehrfach vor."); }
    else { ids.add(e.id); }
  });

  function challengeId(zelle) {
    const z = entquote(zelle);
    if (/^\d+$/.test(z)) { const e = ergebnisse[parseInt(z, 10) - 1]; return e ? e.id : null; }
    const treffer = ergebnisse.find((e) => e.id === z || norm(e.titel || "") === norm(z));
    return treffer ? treffer.id : null;
  }

  const text = fs.readFileSync(listeDatei, "utf8").replace(/^﻿/, "");
  const personen = new Map();
  text.split(/\r?\n/).forEach((roh, i) => {
    const zeile = roh.trim();
    if (!zeile || zeile.startsWith("#")) { return; }
    const teile = trenne(zeile);
    if (!teile) { fehler.push("Zeile " + (i + 1) + ": kein Trennzeichen (; oder Tab) gefunden."); return; }
    const roheNummer = entquote(teile[0]);
    const challenge = entquote(teile[1]);
    if (personen.size === 0 && /matrikel/i.test(roheNummer) && /challenge/i.test(challenge)) { return; }
    const nummer = Matrikel.normalisiere(roheNummer);
    if (!nummer) { fehler.push("Zeile " + (i + 1) + ": \"" + roheNummer + "\" ist keine gültige Matrikelnummer (4 bis 12 Ziffern)."); return; }
    const id = challengeId(challenge);
    if (!id) { fehler.push("Zeile " + (i + 1) + ": Challenge \"" + challenge + "\" nicht gefunden (Nummer, id oder Titel aus js/ergebnisse.js)."); return; }
    const vorher = personen.get(nummer);
    if (vorher && vorher.id !== id) {
      fehler.push("Zeile " + (i + 1) + ": Die Matrikelnummer steht schon in Zeile " + vorher.zeile + " mit einer anderen Challenge.");
    } else if (!vorher) { personen.set(nummer, { id, zeile: i + 1 }); }
  });

  if (fehler.length) {
    console.error("Es gab " + fehler.length + " Problem(e), js/zuordnung.js wurde NICHT geändert:\n");
    fehler.forEach((f) => console.error(" - " + f));
    process.exit(1);
  }
  if (personen.size === 0) { console.error("Die Liste ist leer, js/zuordnung.js wurde NICHT geändert."); process.exit(1); }

  /* Salt der bisherigen Datei weiterverwenden, damit Änderungen klein bleiben */
  let salt = null;
  try { const alt = ladeWindow(AUSGABE).ZUORDNUNG; if (alt && alt.salt) { salt = alt.salt; } } catch (e) { /* neu */ }
  if (!salt) { salt = crypto.randomBytes(16).toString("hex"); }
  const z = { salt, iterationen: ITERATIONEN };

  console.log("Berechne " + personen.size + " Hashes (" + ITERATIONEN + " Runden) …");
  const nummern = [...personen.keys()];
  const hashes = await Promise.all(nummern.map((n) => Matrikel.pruefwert(n, z)));
  const eintraege = {};
  nummern.forEach((n, i) => { eintraege[hashes[i]] = personen.get(n).id; });

  /* Nach Hash sortieren: so verrät die Reihenfolge nichts über die Liste */
  const sortiert = Object.keys(eintraege).sort();
  const body = sortiert.map((h) => "    \"" + h + "\": " + JSON.stringify(eintraege[h])).join(",\n");
  const inhalt =
    "/* AUTOMATISCH ERZEUGT mit tools/zuordnung-erzeugen.js. Nicht von Hand ändern.\n" +
    "   Enthält keine Matrikelnummern im Klartext, nur Hashes (PBKDF2-SHA256).\n" +
    "   Die Liste mit den Nummern liegt nicht im Repository. Anleitung: README.md */\n" +
    "window.ZUORDNUNG = {\n" +
    "  version: 2,\n" +
    "  salt: " + JSON.stringify(salt) + ",\n" +
    "  iterationen: " + ITERATIONEN + ",\n" +
    "  eintraege: {\n" + body + "\n  }\n};\n";
  fs.writeFileSync(AUSGABE, inhalt);

  const proChallenge = {};
  personen.forEach((p) => { proChallenge[p.id] = (proChallenge[p.id] || 0) + 1; });
  console.log("Fertig: " + personen.size + " Matrikelnummern nach js/zuordnung.js geschrieben.");
  ergebnisse.forEach((e) => console.log("  " + (proChallenge[e.id] || 0) + " x " + e.id));
  const g = versioniere();
  if (g.length) { console.log("Versionsnummern in den Seiten aktualisiert: " + g.join(", ")); }
}

(async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--pruefen" && args[1]) { return pruefen(args[1]); }
  if (args.length !== 1 || args[0].startsWith("-")) {
    console.error("Benutzung:\n  node tools/zuordnung-erzeugen.js privat/zuordnung.csv\n  node tools/zuordnung-erzeugen.js --pruefen 1234567");
    process.exit(1);
  }
  if (!fs.existsSync(args[0])) { console.error("Datei nicht gefunden: " + args[0]); process.exit(1); }
  return erzeugen(args[0]);
})().catch((e) => { console.error(e); process.exit(1); });
