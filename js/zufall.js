/* Gleichverteilter Zufallsindex von 0 bis n-1.
   Alle Werte sind exakt gleich wahrscheinlich: crypto.getRandomValues mit
   Rejection Sampling, damit durch das Modulo kein Wert bevorzugt wird. */
(function (root) {
  "use strict";

  function zufallsIndex(n) {
    n = Math.floor(n);
    if (!(n > 0)) { throw new RangeError("n muss größer als 0 sein"); }
    var c = root.crypto;
    if (c && typeof c.getRandomValues === "function") {
      var grenze = Math.floor(4294967296 / n) * n;
      var puffer = new Uint32Array(1);
      do { c.getRandomValues(puffer); } while (puffer[0] >= grenze);
      return puffer[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  root.zufallsIndex = zufallsIndex;
  if (typeof module !== "undefined" && module.exports) { module.exports = zufallsIndex; }
})(typeof globalThis !== "undefined" ? globalThis : this);
