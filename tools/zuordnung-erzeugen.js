#!/usr/bin/env node
/* Erzeugt js/zuordnung.js aus einer Liste "Name;Challenge".

   Benutzung:
     node tools/zuordnung-erzeugen.js privat/zuordnung.csv
     node tools/zuordnung-erzeugen.js --pruefen "Max Mustermann"

   Format der Liste (eine Person pro Zeile, Trennzeichen ; oder Tab):
     Max Mustermann;1
     Erika Musterfrau;Wissen, das in Köpfen steckt
     Jürgen Müller;forschung-markt
   Die Challenge kann als Nummer (Reihenfolge in js/ergebnisse.js, ab 1), als
   id oder als Titel angegeben werden. Eine Kopfzeile "Name;Challenge" ist erlaubt.

   Die Liste mit den Klarnamen gehört NICHT ins Repository (Ordner privat/ ist
   ausgeschlossen). In js/zuordnung.js landen nur Prüfwerte. */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");
const Namen = require("../js/namen.js");

const ROOT = path.join(__dirname, "..");
const AUSGABE = path.join(ROOT, "js", "zuordnung.js");
const ITERATIONEN = 100000;

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

async function pruefen(name) {
  if (!fs.existsSync(AUSGABE)) { console.error("js/zuordnung.js gibt es noch nicht."); process.exit(1); }
  const z = ladeWindow(AUSGABE).ZUORDNUNG;
  const id = await Namen.finde(name, z);
  console.log(id === null ? "Nicht gefunden." : "Gefunden: Challenge-ID \"" + id + "\"");
}

async function erzeugen(listeDatei) {
  const ergebnisse = ladeWindow(path.join(ROOT, "js", "ergebnisse.js")).ERGEBNISSE || [];
  const fehler = [];
  const ids = new Set();
  ergebnisse.forEach((e, i) => {
    if (!e.id) { fehler.push("Ergebnis " + (i + 1) + " (" + (e.titel || "ohne Titel") + ") hat keine id in js/ergebnisse.js."); }
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
  const zeilen = text.split(/\r?\n/);
  const personen = [];
  zeilen.forEach((roh, i) => {
    const zeile = roh.trim();
    if (!zeile || zeile.startsWith("#")) { return; }
    const teile = trenne(zeile);
    if (!teile) { fehler.push("Zeile " + (i + 1) + ": kein Trennzeichen (; oder Tab) gefunden: " + zeile); return; }
    const name = entquote(teile[0]);
    const challenge = entquote(teile[1]);
    if (personen.length === 0 && norm(name) === "name" && /^challenge/i.test(challenge)) { return; }
    if (Namen.schluessel(name).length === 0) { fehler.push("Zeile " + (i + 1) + ": \"" + name + "\" besteht nicht aus Vor- und Nachname."); return; }
    const id = challengeId(challenge);
    if (!id) { fehler.push("Zeile " + (i + 1) + ": Challenge \"" + challenge + "\" nicht gefunden (Nummer, id oder Titel aus js/ergebnisse.js)."); return; }
    personen.push({ name, id, zeile: i + 1 });
  });

  /* Suchschlüssel sammeln, Widersprüche erkennen */
  const keys = new Map();
  personen.forEach((p) => {
    Namen.schluessel(p.name).forEach((k) => {
      const vorher = keys.get(k);
      if (vorher && vorher.id !== p.id) {
        fehler.push("Widerspruch: \"" + vorher.name + "\" (Zeile " + vorher.zeile + ") und \"" + p.name + "\" (Zeile " + p.zeile + ") sind für den Abgleich nicht unterscheidbar, haben aber verschiedene Challenges.");
      } else if (!vorher) { keys.set(k, p); }
    });
  });

  if (fehler.length) {
    console.error("Es gab " + fehler.length + " Problem(e), js/zuordnung.js wurde NICHT geändert:\n");
    fehler.forEach((f) => console.error(" - " + f));
    process.exit(1);
  }

  /* Salt der bisherigen Datei weiterverwenden, damit Änderungen klein bleiben */
  let salt = null;
  try { const alt = ladeWindow(AUSGABE).ZUORDNUNG; if (alt && alt.salt) { salt = alt.salt; } } catch (e) { /* neu */ }
  if (!salt) { salt = crypto.randomBytes(16).toString("hex"); }
  const z = { salt, iterationen: ITERATIONEN };

  const eintraege = {};
  for (const [k, p] of keys) { eintraege[await Namen.pruefwert(k, z)] = p.id; }

  /* Nach Prüfwert sortieren: so verrät die Reihenfolge nichts über die Liste */
  const sortiert = Object.keys(eintraege).sort();
  const body = sortiert.map((h) => "    \"" + h + "\": " + JSON.stringify(eintraege[h])).join(",\n");
  const inhalt =
    "/* AUTOMATISCH ERZEUGT mit tools/zuordnung-erzeugen.js. Nicht von Hand ändern.\n" +
    "   Enthält keine Klarnamen, nur Prüfwerte (PBKDF2-SHA256). Die Liste mit den\n" +
    "   Namen liegt nicht im Repository. Anleitung: README.md */\n" +
    "window.ZUORDNUNG = {\n" +
    "  version: 1,\n" +
    "  salt: " + JSON.stringify(salt) + ",\n" +
    "  iterationen: " + ITERATIONEN + ",\n" +
    "  eintraege: {\n" + body + "\n  }\n};\n";
  fs.writeFileSync(AUSGABE, inhalt);

  const proChallenge = {};
  personen.forEach((p) => { proChallenge[p.id] = (proChallenge[p.id] || 0) + 1; });
  console.log("Fertig: " + personen.length + " Personen, " + sortiert.length + " Prüfwerte nach js/zuordnung.js geschrieben.");
  ergebnisse.forEach((e) => console.log("  " + (proChallenge[e.id] || 0) + " x " + e.id));
}

(async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--pruefen" && args[1]) { return pruefen(args[1]); }
  if (args.length !== 1 || args[0].startsWith("-")) {
    console.error("Benutzung:\n  node tools/zuordnung-erzeugen.js privat/zuordnung.csv\n  node tools/zuordnung-erzeugen.js --pruefen \"Vorname Nachname\"");
    process.exit(1);
  }
  if (!fs.existsSync(args[0])) { console.error("Datei nicht gefunden: " + args[0]); process.exit(1); }
  return erzeugen(args[0]);
})().catch((e) => { console.error(e); process.exit(1); });
