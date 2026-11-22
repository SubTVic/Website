/* Namensabgleich für den Challenge-Check.

   Die Zuordnung Name -> Challenge (js/zuordnung.js) enthält keine Klarnamen,
   sondern nur Prüfwerte (PBKDF2-SHA256). Beim Abgleich wird der eingegebene
   Name genauso umgerechnet und mit der Liste verglichen.

   Der Abgleich ist tolerant bei Groß- und Kleinschreibung, Umlauten
   (Müller = Mueller), Akzenten, Bindestrichen, doppelten Leerzeichen,
   vertauschter Reihenfolge („Mustermann, Max“) und zusätzlichen
   Zweitnamen („Max Peter Mustermann“ findet „Max Mustermann“).

   Dieselbe Datei nutzt auch tools/zuordnung-erzeugen.js, damit Browser und
   Werkzeug garantiert gleich rechnen. */
(function (root) {
  "use strict";

  function getSubtle() {
    if (root.crypto && root.crypto.subtle) { return root.crypto.subtle; }
    if (typeof require === "function") {
      try { return require("crypto").webcrypto.subtle; } catch (e) { /* kein Node */ }
    }
    return null;
  }

  /* Name in Teile zerlegen: klein, ohne Umlaute/Akzente/Satzzeichen */
  function teile(name) {
    var s = String(name == null ? "" : name)
      .normalize("NFC")
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/\p{M}+/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    return s ? s.split(" ") : [];
  }

  /* Suchschlüssel eines Namens: alle Teile sortiert (Reihenfolge egal) und,
     bei mehr als zwei Teilen, zusätzlich nur erster und letzter Teil. */
  function schluessel(name) {
    var t = teile(name);
    if (t.length < 2) { return []; }
    var keys = [t.slice().sort().join(" ")];
    if (t.length > 2) {
      var kurz = [t[0], t[t.length - 1]].sort().join(" ");
      if (kurz !== keys[0]) { keys.push(kurz); }
    }
    return keys;
  }

  function hex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    for (var i = 0; i < bytes.length; i++) { out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); }
    return out;
  }

  /* Prüfwert eines Suchschlüssels (128 Bit als Hex) */
  function pruefwert(key, z) {
    var subtle = getSubtle();
    if (!subtle) { return Promise.reject(new Error("Web Crypto nicht verfügbar")); }
    var enc = new TextEncoder();
    return subtle.importKey("raw", enc.encode(key), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(z.salt), iterations: z.iterationen }, k, 128
      );
    }).then(hex);
  }

  /* Sucht den Namen in der Liste z. Ergebnis: Challenge-ID oder null. */
  function finde(name, z) {
    var keys = schluessel(name);
    var eintraege = (z && z.eintraege) || {};
    function pruefe(i) {
      if (i >= keys.length) { return Promise.resolve(null); }
      return pruefwert(keys[i], z).then(function (h) {
        return Object.prototype.hasOwnProperty.call(eintraege, h) ? eintraege[h] : pruefe(i + 1);
      });
    }
    return pruefe(0);
  }

  var api = { teile: teile, schluessel: schluessel, pruefwert: pruefwert, finde: finde };
  root.Namen = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof globalThis !== "undefined" ? globalThis : this);
