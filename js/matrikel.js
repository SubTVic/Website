/* Abgleich der Matrikelnummer für den Challenge-Check.

   Die Zuordnung Matrikelnummer -> Challenge (js/zuordnung.js) enthält keine
   Matrikelnummern im Klartext, sondern nur Hashes (PBKDF2-SHA256). Die
   eingegebene Nummer wird im Browser auf dieselbe Weise gehasht und mit der
   Liste verglichen. Die Eingabe verlässt den Browser nicht.

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

  /* Eingabe bereinigen: Leerzeichen, Punkte, Bindestriche entfernen. Führende
     Nullen bleiben erhalten (00001 ist eine andere Nummer als 1). Ergebnis:
     nur Ziffern (4 bis 12 Stück) oder "" wenn die Eingabe keine gültige
     Matrikelnummer sein kann. */
  function normalisiere(eingabe) {
    var s = String(eingabe == null ? "" : eingabe).replace(/[\s.\-–—_\/]+/g, "");
    if (!/^[0-9]+$/.test(s)) { return ""; }
    return s.length >= 4 && s.length <= 12 ? s : "";
  }

  function hex(buffer) {
    var bytes = new Uint8Array(buffer);
    var out = "";
    for (var i = 0; i < bytes.length; i++) { out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16); }
    return out;
  }

  /* Hash einer bereinigten Matrikelnummer (128 Bit als Hex) */
  function pruefwert(nummer, z) {
    var subtle = getSubtle();
    if (!subtle) { return Promise.reject(new Error("Web Crypto nicht verfügbar")); }
    var enc = new TextEncoder();
    return subtle.importKey("raw", enc.encode(nummer), "PBKDF2", false, ["deriveBits"]).then(function (k) {
      return subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(z.salt), iterations: z.iterationen }, k, 128
      );
    }).then(hex);
  }

  /* Sucht die Eingabe in der Liste z. Ergebnis: Challenge-ID oder null. */
  function finde(eingabe, z) {
    var nummer = normalisiere(eingabe);
    if (!nummer) { return Promise.resolve(null); }
    var eintraege = (z && z.eintraege) || {};
    return pruefwert(nummer, z).then(function (h) {
      return Object.prototype.hasOwnProperty.call(eintraege, h) ? eintraege[h] : null;
    });
  }

  var api = { normalisiere: normalisiere, pruefwert: pruefwert, finde: finde };
  root.Matrikel = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof globalThis !== "undefined" ? globalThis : this);
