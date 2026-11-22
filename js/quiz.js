/* Challenge-Check: Ablauf des Quiz.
   Inhalte stehen in fragen.js und ergebnisse.js, die Auswahl des Ergebnisses
   in zufall.js. Diese Datei muss man für Textänderungen nicht anfassen. */
(function () {
  "use strict";

  var FRAGEN = Array.isArray(window.FRAGEN) ? window.FRAGEN : [];
  var ERGEBNISSE = Array.isArray(window.ERGEBNISSE) ? window.ERGEBNISSE : [];
  var T = window.ERGEBNIS_TEXTE || {};
  var TEXT = {
    kopf: T.kopf || "{vorname}, du bist perfekt dafür geeignet, diese Challenge zu entwickeln:",
    frageLabel: T.frageLabel || "Die Leitfrage",
    teilenText: T.teilenText || "Ich soll diese Challenge entwickeln: „{titel}“."
  };
  var N = window.NAMEN_TEXTE || {};
  var NAMEN = {
    unbekannt: N.unbekannt === "zufall" ? "zufall" : "fehler",
    einWort: N.einWort || "Das sieht nach nur einem Namen aus. Bitte gib Vor- und Nachnamen ein.",
    teamEinWort: N.teamEinWort || "Bitte gib auch von deiner Kollegin oder deinem Kollegen Vor- und Nachnamen ein.",
    nichtGefunden: N.nichtGefunden || "Zu diesem Namen haben wir keine Challenge gefunden. Bitte prüfe die Schreibweise.",
    keineListe: N.keineListe || "Es ist noch keine Namensliste hinterlegt.",
    technik: N.technik || "Der Namensabgleich funktioniert in diesem Browser nicht."
  };

  var AUSWERTUNG = [
    "Empathie wird gemessen …",
    "Post-its werden gezählt …",
    "Prototyp-Reflexe werden kalibriert …",
    "Die passende Challenge wird ausgewählt …"
  ];
  var TICKER = [
    FRAGEN.length + " Fragen",
    "Eine Challenge",
    "Design Thinking",
    "Zufall? Schicksal? Methode.",
    "Verstehen. Ideen finden. Bauen. Testen."
  ];
  var ZAHLWORT = ["", "eine", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];

  var reduziert = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var SCREENS = ["s-start", "s-frage", "s-laden", "s-ergebnis"];

  var antworten = [];
  var aktuell = 0;
  var gesperrt = false;
  var timer = null;
  var letztesErgebnis = -1;
  var sucht = false;
  /* Wer spielt? ziel = Index der festgelegten Challenge (-1 = zufällig).
     Der Name der Kollegin oder des Kollegen (Team) hat keinen Einfluss. */
  var spieler = { vorname: "", ziel: -1 };

  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function los(fn, ms) { window.clearTimeout(timer); timer = window.setTimeout(fn, ms); }

  /* ---------- Anzeige ---------- */

  function zeige(id, fokusId) {
    SCREENS.forEach(function (s) {
      var el = $(s);
      el.hidden = s !== id;
      el.classList.remove("rein");
    });
    var neu = $(id);
    if (!reduziert) { void neu.offsetWidth; neu.classList.add("rein"); }
    document.body.setAttribute("data-screen", id.replace("s-", ""));
    aktualisiereLeiste(id);
    window.scrollTo(0, 0);
    if (fokusId) { $(fokusId).focus({ preventScroll: true }); }
  }

  function aktualisiereLeiste(id) {
    var rest = "";
    var fertig = 0;
    var jetzt = -1;
    if (id === "s-frage") { rest = "Frage " + (aktuell + 1) + " von " + FRAGEN.length; fertig = aktuell; jetzt = aktuell; }
    if (id === "s-laden") { rest = "Auswertung"; fertig = FRAGEN.length; }
    if (id === "s-ergebnis") { rest = "Ergebnis"; fertig = FRAGEN.length; }
    $("pfad-rest").textContent = rest;
    var segs = $("segmente").children;
    for (var i = 0; i < segs.length; i++) {
      segs[i].className = i === jetzt ? "jetzt" : (i < fertig ? "an" : "");
    }
  }

  function baueSegmente() {
    var box = $("segmente");
    box.textContent = "";
    FRAGEN.forEach(function () { box.appendChild(document.createElement("i")); });
  }

  function baueTicker() {
    var spur = $("ticker");
    spur.textContent = "";
    for (var k = 0; k < 2; k++) {
      TICKER.forEach(function (wort) {
        var w = document.createElement("span");
        w.className = "wort";
        w.textContent = wort;
        var s = document.createElement("span");
        s.className = "stern stern-teal";
        spur.appendChild(w);
        spur.appendChild(s);
      });
    }
  }

  function fuelleZahlen() {
    var n = FRAGEN.length;
    var wort = ZAHLWORT[n] || String(n);
    document.querySelectorAll("[data-anzahl]").forEach(function (el) { el.textContent = wort; });
    document.querySelectorAll("[data-anzahl-zahl]").forEach(function (el) { el.textContent = n; });
    var min = Math.max(1, Math.round(n / 5));
    document.querySelectorAll("[data-minuten]").forEach(function (el) { el.textContent = min; });
    document.querySelectorAll("[data-minuten-einheit]").forEach(function (el) { el.textContent = min === 1 ? "Minute" : "Minuten"; });
  }

  /* ---------- Fragen ---------- */

  function renderFrage() {
    var f = FRAGEN[aktuell];
    $("nr").textContent = pad(aktuell + 1);
    $("von").textContent = "/" + FRAGEN.length;
    $("frage-text").textContent = f.frage;
    $("zurueck").hidden = aktuell === 0;
    $("hinweis").textContent = "Tipp: Taste 1 bis " + f.antworten.length;

    var liste = $("antworten");
    liste.textContent = "";
    f.antworten.forEach(function (text, i) {
      var li = document.createElement("li");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "antwort" + (antworten[aktuell] === i ? " gewaehlt" : "");
      var taste = document.createElement("span");
      taste.className = "taste";
      taste.setAttribute("aria-hidden", "true");
      taste.textContent = String.fromCharCode(65 + i);
      var t = document.createElement("span");
      t.textContent = text;
      b.appendChild(taste);
      b.appendChild(t);
      b.addEventListener("click", function () { waehle(i); });
      li.appendChild(b);
      liste.appendChild(li);
    });
  }

  function frageAnzeigen() {
    gesperrt = false;
    renderFrage();
    zeige("s-frage", "frage-text");
  }

  function waehle(i) {
    if (gesperrt) { return; }
    gesperrt = true;
    antworten[aktuell] = i;
    var knoepfe = $("antworten").querySelectorAll(".antwort");
    for (var k = 0; k < knoepfe.length; k++) { knoepfe[k].classList.toggle("gewaehlt", k === i); }
    los(weiter, reduziert ? 0 : 330);
  }

  function weiter() {
    if (aktuell < FRAGEN.length - 1) {
      aktuell++;
      frageAnzeigen();
    } else {
      auswerten();
    }
  }

  function zurueck() {
    if (aktuell === 0 || $("s-frage").hidden) { return; }
    window.clearTimeout(timer);
    aktuell--;
    frageAnzeigen();
  }

  /* ---------- Auswertung und Ergebnis ---------- */

  function auswerten() {
    var i = 0;
    var text = $("laden-text");
    text.textContent = AUSWERTUNG[0];
    zeige("s-laden", "laden-text");
    (function naechste() {
      i++;
      if (i < AUSWERTUNG.length) {
        los(function () { text.textContent = AUSWERTUNG[i]; naechste(); }, 750);
      } else {
        los(function () {
          var index = spieler.ziel >= 0 ? spieler.ziel : window.zufallsIndex(ERGEBNISSE.length);
          zeigeErgebnis(index, true);
        }, 900);
      }
    })();
  }

  function zeigeErgebnis(index, mitKonfetti) {
    var e = ERGEBNISSE[index];
    letztesErgebnis = index;
    $("e-kopf").textContent = kopfText();
    $("e-titel").textContent = e.titel || "";
    $("e-label").textContent = TEXT.frageLabel;
    $("e-frage").textContent = e.frage || "";
    $("e-text").textContent = e.beschreibung || "";
    var partner = $("e-partner");
    partner.textContent = e.partner ? "Gestellt von: " + e.partner : "";
    partner.hidden = !e.partner;
    var link = $("e-link");
    link.hidden = !e.link;
    if (e.link) { link.href = e.link; }
    $("teilen-status").textContent = "";
    zeige("s-ergebnis", "e-titel");
    if (mitKonfetti) { konfetti(); }
  }

  function teilen() {
    var e = ERGEBNISSE[letztesErgebnis];
    if (!e) { return; }
    var text = TEXT.teilenText.replace("{titel}", e.titel || "");
    var url = window.location.origin + window.location.pathname;
    var status = $("teilen-status");
    if (navigator.share) {
      navigator.share({ title: "Challenge-Check", text: text, url: url }).catch(function () {});
      return;
    }
    var voll = text + " " + url;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(voll).then(
        function () { status.textContent = "Text kopiert. Jetzt einfach einfügen und senden."; },
        function () { status.textContent = "Kopieren hat nicht geklappt. Bitte den Link der Seite teilen."; }
      );
    } else {
      status.textContent = "Bitte den Link der Seite teilen.";
    }
  }

  /* Überschrift über dem Ergebnis; {vorname} fällt weg, wenn es keinen gibt */
  function kopfText() {
    var t = TEXT.kopf;
    if (spieler.vorname) { return t.replace("{vorname}", spieler.vorname); }
    t = t.replace(/\{vorname\}[,:]?\s*/, "");
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /* ---------- Name und Team ---------- */

  function bereinige(s) { return String(s || "").trim().replace(/\s+/g, " "); }

  function istVollerName(s) { return !!window.Namen && window.Namen.teile(s).length >= 2; }

  /* Vorname fürs Ergebnis: erstes Wort, bei „Nachname, Vorname“ das Wort nach dem Komma */
  function ermittleVorname(name) {
    var teil = name.indexOf(",") > -1 ? name.split(",")[1] : name;
    var wort = bereinige(teil).split(" ")[0] || "";
    /* Ganz groß oder ganz klein getippt: sauber schreiben (anna-lena -> Anna-Lena).
       Gemischte Schreibweise bleibt, wie sie ist. */
    if (wort === wort.toLowerCase() || wort === wort.toUpperCase()) {
      wort = wort.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, function (_, vor, buchstabe) { return vor + buchstabe.toUpperCase(); });
    }
    return wort;
  }

  function setzeFehler(feld, text) {
    var box = $(feld + "-fehler");
    var eingabe = $(feld);
    box.textContent = text || "";
    box.hidden = !text;
    if (text) { eingabe.setAttribute("aria-invalid", "true"); } else { eingabe.removeAttribute("aria-invalid"); }
  }

  function teamUmschalten() {
    var oeffnen = $("team-feld").hidden;
    $("team-feld").hidden = !oeffnen;
    $("team-toggle").setAttribute("aria-expanded", oeffnen ? "true" : "false");
    if (oeffnen) {
      $("team-name").focus();
    } else {
      $("team-name").value = "";
      setzeFehler("team-name", "");
    }
  }

  /* Welche Challenge gehört zu diesem Namen? Ergebnis: { ok, index | meldung } */
  function sucheZiel(name) {
    var z = window.ZUORDNUNG;
    var zufall = NAMEN.unbekannt === "zufall";
    function nichtOk(meldung) { return zufall ? { ok: true, index: -1 } : { ok: false, meldung: meldung }; }

    if (!z || !z.eintraege || !Object.keys(z.eintraege).length) { return Promise.resolve(nichtOk(NAMEN.keineListe)); }
    if (!window.Namen) { return Promise.resolve({ ok: false, meldung: NAMEN.technik }); }
    return window.Namen.finde(name, z).then(function (id) {
      if (id === null) { return nichtOk(NAMEN.nichtGefunden); }
      for (var i = 0; i < ERGEBNISSE.length; i++) {
        if (ERGEBNISSE[i].id === id) { return { ok: true, index: i }; }
      }
      if (window.console) { console.error("Challenge-ID \"" + id + "\" steht in zuordnung.js, fehlt aber in ergebnisse.js."); }
      return nichtOk(NAMEN.nichtGefunden);
    }, function () {
      return { ok: false, meldung: NAMEN.technik };
    });
  }

  function starte() {
    if (sucht) { return; }
    var name = bereinige($("name").value);
    var teamOffen = !$("team-feld").hidden;
    var team = teamOffen ? bereinige($("team-name").value) : "";
    setzeFehler("name", "");
    setzeFehler("team-name", "");

    if (!istVollerName(name)) {
      setzeFehler("name", NAMEN.einWort);
      $("name").focus();
      return;
    }
    if (teamOffen && !istVollerName(team)) {
      setzeFehler("team-name", NAMEN.teamEinWort);
      $("team-name").focus();
      return;
    }

    sucht = true;
    $("los").disabled = true;
    sucheZiel(name).then(function (r) {
      sucht = false;
      $("los").disabled = false;
      if (!r.ok) {
        setzeFehler("name", r.meldung);
        $("name").focus();
        return;
      }
      spieler = { vorname: ermittleVorname(name), ziel: r.index };
      neustart(false);
    });
  }

  /* ---------- Neustart ---------- */

  function neustart(zuStart, felderLeeren) {
    window.clearTimeout(timer);
    antworten = [];
    aktuell = 0;
    gesperrt = false;
    if (felderLeeren) {
      $("name").value = "";
      $("team-name").value = "";
      setzeFehler("name", "");
      setzeFehler("team-name", "");
      if (!$("team-feld").hidden) { teamUmschalten(); }
      spieler = { vorname: "", ziel: -1 };
    }
    if (zuStart) { zeige("s-start", felderLeeren ? "name" : "start-titel"); } else { frageAnzeigen(); }
  }

  /* ---------- Konfetti ---------- */

  function konfetti() {
    if (reduziert) { return; }
    var c = $("konfetti");
    var ctx = c.getContext("2d");
    if (!ctx) { return; }
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = c.width = Math.floor(window.innerWidth * dpr);
    var h = c.height = Math.floor(window.innerHeight * dpr);
    var farben = ["#00f182", "#fff9ed", "#d94d20", "#887440", "#ffffff"];
    var teile = [];
    for (var i = 0; i < 150; i++) {
      var winkel = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      var tempo = (7 + Math.random() * 11) * dpr;
      teile.push({
        x: w / 2, y: h * 0.38,
        vx: Math.cos(winkel) * tempo, vy: Math.sin(winkel) * tempo,
        b: (6 + Math.random() * 8) * dpr, hh: (3 + Math.random() * 5) * dpr,
        r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
        f: farben[i % farben.length]
      });
    }
    var start = null;
    function bild(t) {
      if (start === null) { start = t; }
      var dauer = t - start;
      ctx.clearRect(0, 0, w, h);
      var alpha = Math.max(0, 1 - Math.max(0, dauer - 1800) / 1200);
      ctx.globalAlpha = alpha;
      teile.forEach(function (p) {
        p.vy += 0.26 * dpr;
        p.vx *= 0.992;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.f;
        ctx.fillRect(-p.b / 2, -p.hh / 2, p.b, p.hh);
        ctx.restore();
      });
      if (dauer < 3000) { window.requestAnimationFrame(bild); } else { ctx.clearRect(0, 0, w, h); }
    }
    window.requestAnimationFrame(bild);
  }

  /* ---------- Tastatur ---------- */

  document.addEventListener("keydown", function (ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey || $("s-frage").hidden) { return; }
    var k = ev.key.toLowerCase();
    var i = -1;
    if (/^[1-9]$/.test(k)) { i = parseInt(k, 10) - 1; }
    else if (/^[a-f]$/.test(k)) { i = k.charCodeAt(0) - 97; }
    if (i >= 0 && i < FRAGEN[aktuell].antworten.length) {
      ev.preventDefault();
      waehle(i);
    }
  });

  /* ---------- Start ---------- */

  function init() {
    var fehler = "";
    if (!FRAGEN.length) { fehler = "Es sind noch keine Fragen hinterlegt (js/fragen.js)."; }
    else if (!ERGEBNISSE.length) { fehler = "Es sind noch keine Ergebnisse hinterlegt (js/ergebnisse.js)."; }

    baueSegmente();
    baueTicker();
    fuelleZahlen();
    aktualisiereLeiste("s-start");

    $("name-form").addEventListener("submit", function (ev) { ev.preventDefault(); starte(); });
    $("team-toggle").addEventListener("click", teamUmschalten);
    $("name").addEventListener("input", function () { setzeFehler("name", ""); });
    $("team-name").addEventListener("input", function () { setzeFehler("team-name", ""); });
    $("zurueck").addEventListener("click", zurueck);
    $("pfad-start").addEventListener("click", function () { neustart(true, false); });
    $("nochmal").addEventListener("click", function () { neustart(true, true); });
    $("teilen").addEventListener("click", teilen);

    if (fehler) {
      var el = $("fehler");
      el.textContent = fehler;
      el.hidden = false;
      $("los").disabled = true;
      return;
    }

    /* Vorschau: index.html?ergebnis=2 zeigt direkt das zweite Ergebnis */
    var m = /[?&]ergebnis=(\d+)/.exec(window.location.search);
    if (m) {
      var n = parseInt(m[1], 10);
      if (n >= 1 && n <= ERGEBNISSE.length) { aktuell = FRAGEN.length; zeigeErgebnis(n - 1, false); }
    }
  }

  init();
})();
