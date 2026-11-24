/* Timekeeper: Der Ablauf läuft nach der Uhr des Geräts. Die App zeigt, was
   gerade dran ist und wie lange es noch läuft, spielt am Ende eines Abschnitts
   auf Wunsch einen Ton und lässt den Plan spontan anpassen:
   - Verlängern um 1 bis 5 Minuten,
   - Einschub (z. B. ein Energizer) jetzt oder nach einem Abschnitt,
   - Sync: „Dieser Abschnitt startet jetzt“, alles danach rückt nach.
   Bei Verlängern und Einschub kann die Zeit bei späteren Abschnitten wieder
   weggenommen werden.

   Der Ablauf steht in agenda.js. Diese Datei muss man dafür nicht anfassen.

   Zeitmodell: Jeder Abschnitt hat eine geplante Startzeit und eine Dauer.
   Verzug (später dran) schiebt die folgenden Abschnitte nach hinten, bis eine
   Lücke im Plan ihn auffängt. Vorsprung (früher dran) zieht die folgenden
   nach vorne, aber nicht über eine Lücke im Plan hinweg. Ein Sync setzt den
   Start eines Abschnitts fest auf „jetzt“. Alle Änderungen eines Tages stehen
   als Liste (historie) und werden bei jeder Berechnung neu angewendet. */
(function () {
  "use strict";

  var MIN = 60000;
  var KURZ = 30000;            /* Abschnitte unter 30 s gelten als entfallen */
  var FRISCH = 20000;          /* Ton nur, wenn das Ende höchstens 20 s (echte Zeit) her ist */
  var NACHLAUF = 10 * MIN;     /* So lange nach seinem Ende lässt sich ein Abschnitt noch verlängern */
  var MAX_PLUS = 5;
  var MELDUNG_KURZ = 3 * MIN;  /* Hinweise zum Abschnittsende verschwinden nach 3 Minuten */
  var KEY = {
    ablauf: "timekeeper.ablauf",
    tag: "timekeeper.tag",
    einst: "timekeeper.einstellungen",
    stumm: "timekeeper.stumm"
  };
  var TYPEN = [
    [/einschub/i, "einschub"], [/coach/i, "coaches"], [/check|retro/i, "check"], [/input/i, "input"], [/aktion/i, "aktion"],
    [/puffer/i, "puffer"], [/übergang|uebergang/i, "uebergang"], [/pause|mittag/i, "pause"]
  ];
  var TICKER_ZUSATZ = ["Timekeeper", "Verstehen. Ideen finden. Bauen. Testen."];

  /* ---------- Kleine Helfer ---------- */

  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function sauber(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) { e.className = cls; }
    if (text != null) { e.textContent = text; }
    return e;
  }
  function setzeText(e, text) { if (e.textContent !== text) { e.textContent = text; } }
  function minWort(n) { return n === 1 ? "1 Minute" : n + " Minuten"; }
  function zitat(s) { return "„" + s + "“"; }
  function versatz(m) { return (m > 0 ? "+" : "−") + Math.abs(m) + " min"; }
  function attrSicher(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function ploppen(e) { e.classList.remove("ploppt"); void e.offsetWidth; e.classList.add("ploppt"); }

  function lies(k) {
    try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function schreib(k, v) {
    try {
      if (v == null) { window.localStorage.removeItem(k); } else { window.localStorage.setItem(k, JSON.stringify(v)); }
    } catch (e) { /* Speicher voll oder gesperrt: dann eben nur für diese Sitzung */ }
  }

  /* ---------- Uhr (mit Probelauf über ?zeit=HH:MM&tempo=10) ---------- */

  var probe = (function () {
    var p = new URLSearchParams(window.location.search);
    var m = /^(\d{1,2})[:.](\d{2})$/.exec(p.get("zeit") || "");
    if (!m || +m[1] > 23 || +m[2] > 59) { return null; }
    var tempo = Math.min(120, Math.max(1, Math.round(Number(p.get("tempo")) || 1)));
    var d = new Date();
    d.setHours(+m[1], +m[2], 0, 0);
    return { basis: d.getTime(), real: Date.now(), tempo: tempo, text: pad(+m[1]) + ":" + m[2] };
  })();

  function jetzt() { return probe ? probe.basis + (Date.now() - probe.real) * probe.tempo : Date.now(); }
  function tagBeginn(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function datumText(t) { var d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function uhrzeit(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function uhrzeitSek(t) { var d = new Date(t); return uhrzeit(t) + ":" + pad(d.getSeconds()); }
  function restText(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    return (h ? h + ":" + pad(m) : pad(m)) + ":" + pad(s % 60);
  }

  /* ---------- Ablauf ---------- */

  function zuMinuten(s) {
    var m = /^\s*(\d{1,2})\s*[:.]\s*(\d{2})(?:[:.]\d{2})?\s*(?:uhr)?\s*$/i.exec(String(s == null ? "" : s));
    if (!m || +m[1] > 23 || +m[2] > 59) { return null; }
    return +m[1] * 60 + +m[2];
  }
  function minutenText(m) { return pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60); }

  function normalisiere(roh) {
    roh = roh || {};
    var ids = {};
    var liste = [];
    (Array.isArray(roh.abschnitte) ? roh.abschnitte : []).forEach(function (a) {
      if (!a) { return; }
      var start = typeof a.start === "number" ? a.start : zuMinuten(a.start);
      var dauer = Math.round(Number(a.dauer));
      if (start == null || !isFinite(dauer) || dauer < 0 || dauer > 24 * 60) { return; }
      var titel = sauber(a.session || a.titel) || sauber(a.typ) || "Abschnitt";
      var id = minutenText(start) + " " + titel;
      while (ids[id]) { id += "+"; }
      ids[id] = true;
      liste.push({ id: id, start: start, dauer: dauer, typ: sauber(a.typ), titel: titel, track: sauber(a.track), wer: sauber(a.wer) });
    });
    liste.sort(function (x, y) { return x.start - y.start; });
    return { titel: sauber(roh.titel), tag: sauber(roh.tag), abschnitte: liste };
  }

  function schluessel(ab) {
    var s = ab.abschnitte.map(function (a) { return a.id + "/" + a.dauer; }).join("|");
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }

  function typKlasse(typ) {
    for (var i = 0; i < TYPEN.length; i++) { if (TYPEN[i][0].test(typ)) { return TYPEN[i][1]; } }
    return "";
  }
  function chip(typ) {
    var k = typKlasse(typ);
    return el("span", "chip" + (k ? " chip-" + k : ""), typ);
  }

  var eigenerAblauf = lies(KEY.ablauf);
  var ablauf = normalisiere(eigenerAblauf && eigenerAblauf.abschnitte ? eigenerAblauf : window.AGENDA);
  if (!ablauf.abschnitte.length && eigenerAblauf) { eigenerAblauf = null; ablauf = normalisiere(window.AGENDA); }
  var ablaufKey = schluessel(ablauf);

  /* ---------- Einstellungen und Zustand ---------- */

  var E = { ton: true, klang: "glocke", laut: 80, vorwarnung: 0, wach: true, plus: 2, einschub: 3, einschubName: "Energizer" };
  (function () {
    var s = lies(KEY.einst) || {};
    Object.keys(E).forEach(function (k) { if (s[k] != null && typeof s[k] === typeof E[k]) { E[k] = s[k]; } });
  })();
  function speichereEinst() { schreib(KEY.einst, E); }

  /* Änderungen des Tages, in Reihenfolge:
     { art: "plus", zeit, id (Dauer-Kennung), ziel (Zeile), plus, abzug: [[id, min], …] }
     { art: "einschub", zeit, eid, titel, dauer, nach (Zeile davor, "" = Anfang), um (Zeitpunkt oder null), abzug }
     { art: "sync", zeit, id (Zeile) }
     { art: "ende", zeit, id (Dauer-Kennung), ziel (Zeile), plus (Minuten, auch krumm), bis (Zeitpunkt) }
     { art: "plan", zeit, id (Dauer-Kennung), ziel (Zeile), titel, typ, plus (Minuten), vorher, nachher } */
  var historie = [];
  var stumm = {};     /* Zeilen-Kennung -> true: kein Ton am Ende */
  var tag0 = tagBeginn(jetzt());
  var plan = [];
  var version = 0;

  function ladeTag() {
    historie = [];
    if (probe) { return; }
    var s = lies(KEY.tag);
    if (s && s.datum === datumText(jetzt()) && s.key === ablaufKey && Array.isArray(s.historie)) {
      historie = s.historie.filter(function (h) { return h && typeof h === "object"; });
    }
  }
  function speichereTag() {
    if (probe) { return; }
    schreib(KEY.tag, { datum: datumText(jetzt()), key: ablaufKey, historie: historie });
  }
  function ladeStumm() {
    var s = lies(KEY.stumm);
    stumm = {};
    if (s && s.key === ablaufKey && Array.isArray(s.ids)) { s.ids.forEach(function (id) { stumm[id] = true; }); }
  }
  function speichereStumm() { schreib(KEY.stumm, { key: ablaufKey, ids: Object.keys(stumm) }); }

  /* ---------- Zeitplan berechnen ----------
     Ergebnis: Liste von Zeilen { a, id, dauerId, art ("normal" | "einschub"),
     teil (0, 1 = unterbrochen, 2 = Fortsetzung), planStart, planEnde, start, ende, dauer (min), i } */

  function berechne(hist) {
    var d = {};
    var anker = {};
    var kinder = {};
    var umbenannt = {};
    hist.forEach(function (h) {
      var art = h.art || "plus";
      if (art === "plus" || art === "ende" || art === "plan") { d[h.id] = (d[h.id] || 0) + (h.plus || 0); }
      if (art === "plan") {
        if (h.titel || h.typ != null) { umbenannt[h.id] = { titel: h.titel, typ: h.typ }; }
        if (h.start != null) { anker[h.ziel] = h.start; }
      }
      else if (art === "sync") { anker[h.id] = h.zeit; }
      else if (art === "einschub") { var k = h.nach || ""; (kinder[k] = kinder[k] || []).push(h); }
      (h.abzug || []).forEach(function (a) { d[a[0]] = (d[a[0]] || 0) - a[1]; });
    });
    /* Unterbrechungen („jetzt“) vor Einschüben am Ende eines Abschnitts */
    Object.keys(kinder).forEach(function (k) {
      kinder[k].sort(function (x, y) { return (x.um != null ? 0 : 1) - (y.um != null ? 0 : 1); });
    });

    var res = [];
    var vor = null;
    var letzterAnker = -Infinity;

    function verzugFuer(planStart) {
      if (!vor) { return 0; }
      var e = vor.ende - vor.planEnde;
      var luecke = Math.max(0, planStart - vor.planEnde);
      if (e >= 0) { return Math.max(0, e - luecke); }   /* Verzug: Lücke fängt ihn auf */
      return luecke > 0 ? 0 : e;                          /* Vorsprung: nur ohne Lücke */
    }

    function setze(x, start) {
      var ank = anker[x.id];
      if (ank != null && ank < letzterAnker) { ank = null; }
      if (ank != null) {
        letzterAnker = ank;
        start = ank;
        /* Was davor noch läuft, endet jetzt; was noch nicht begonnen hat, entfällt */
        for (var j = res.length - 1; j >= 0; j--) {
          var r = res[j];
          if (r.ende <= ank) { break; }
          if (r.start > ank) { r.start = ank; }
          r.ende = ank;
        }
        /* Später gestartet: der Abschnitt davor lief so lange weiter */
        if (vor && vor.ende < ank && vor.ende > vor.start && (x.direkt || x.planStart <= vor.planEnde)) { vor.ende = ank; }
      }
      x.start = start;
      x.ende = start + x.dauerMs;
      res.push(x);
      vor = x;
    }

    function folge(id) { (kinder[id] || []).forEach(einschub); }

    function basis(a) {
      var ps = tag0 + a.start * MIN;
      var x = {
        a: a, id: a.id, dauerId: a.id, art: "normal", teil: 0,
        planStart: ps, planEnde: ps + a.dauer * MIN,
        dauerMs: Math.max(0, a.dauer + (d[a.id] || 0)) * MIN
      };
      setze(x, ps + verzugFuer(ps));
      folge(x.id);
    }

    function einschub(h) {
      var a = { id: h.eid, titel: h.titel || "Einschub", typ: "Einschub", track: "", wer: "", dauer: h.dauer };
      var x = { a: a, id: h.eid, dauerId: h.eid, art: "einschub", teil: 0, dauerMs: Math.max(0, h.dauer + (d[h.eid] || 0)) * MIN };
      var p = vor;
      if (h.um != null && p && p.id === h.nach && p.start < h.um && h.um < p.ende) {
        /* Unterbrechung: p endet jetzt, der Rest läuft nach dem Einschub weiter */
        var rest = p.ende - h.um;
        p.ende = h.um;
        p.teil = 1;
        x.planStart = x.planEnde = h.um;
        setze(x, h.um);
        folge(x.id);
        var x2 = {
          a: p.a, id: p.id + "#2", dauerId: p.dauerId, art: p.art, teil: 2, direkt: true,
          planStart: p.planEnde, planEnde: p.planEnde, dauerMs: rest
        };
        setze(x2, vor.ende);
        folge(x2.id);
        return;
      }
      if (h.um != null) {
        x.planStart = x.planEnde = h.um;
        setze(x, Math.max(h.um, p ? p.ende : h.um));
      } else {
        var ps = p ? p.planEnde : (ablauf.abschnitte.length ? tag0 + ablauf.abschnitte[0].start * MIN : h.zeit);
        x.planStart = x.planEnde = ps;
        x.direkt = !!p;
        setze(x, p ? p.ende : ps);
      }
      folge(x.id);
    }

    folge("");
    ablauf.abschnitte.forEach(basis);
    res.forEach(function (x, i) {
      x.i = i;
      x.dauer = Math.max(0, x.ende - x.start) / MIN;
      var u = umbenannt[x.dauerId];
      if (u) { x.a = Object.assign({}, x.a, { titel: u.titel || x.a.titel, typ: u.typ != null ? u.typ : x.a.typ }); }
    });
    return res;
  }

  function neuBerechnen() {
    plan = berechne(historie);
    version++;
  }

  function zaehlt(x) { return x.ende - x.start >= KURZ; }
  function slotTitel(x) { return x.a.titel + (x.teil === 2 ? " (Fortsetzung)" : ""); }
  function slotVon(id, liste) {
    liste = liste || plan;
    for (var i = 0; i < liste.length; i++) { if (liste[i].id === id) { return liste[i]; } }
    return null;
  }
  function titelVon(id) {
    for (var i = 0; i < plan.length; i++) { if (plan[i].id === id || plan[i].dauerId === id) { return slotTitel(plan[i]); } }
    for (var k = 0; k < historie.length; k++) { if (historie[k].eid === id) { return historie[k].titel; } }
    return String(id).replace(/^\d\d:\d\d /, "").replace(/#2/g, " (Fortsetzung)");
  }
  function tagesende(p) {
    var e = null;
    var pe = null;
    p.forEach(function (x) {
      if (e === null || x.ende > e) { e = x.ende; }
      if (pe === null || x.planEnde > pe) { pe = x.planEnde; }
    });
    return { ende: e, plan: pe };
  }

  /* Wo stehen wir? laufend / naechster / letzter sind Indizes in plan (−1 = keiner) */
  function lage(p, t) {
    var lg = { laufend: -1, naechster: -1, letzter: -1, phase: "leer" };
    for (var i = 0; i < p.length; i++) {
      var x = p[i];
      if (!zaehlt(x)) { continue; }
      if (x.start <= t && t < x.ende) { lg.laufend = i; }
      else if (x.ende <= t) { if (lg.letzter < 0 || x.ende >= p[lg.letzter].ende) { lg.letzter = i; } }
      else if (lg.naechster < 0) { lg.naechster = i; }
    }
    if (lg.laufend >= 0) { lg.phase = "laeuft"; }
    else if (lg.naechster >= 0) { lg.phase = lg.letzter >= 0 ? "frei" : "vorher"; }
    else if (lg.letzter >= 0) { lg.phase = "fertig"; }
    return lg;
  }

  function naechsterNach(i) {
    for (var j = i + 1; j < plan.length; j++) { if (zaehlt(plan[j])) { return plan[j]; } }
    return null;
  }

  /* Verlängerbar: der laufende und der eben zu Ende gegangene Abschnitt */
  function kandidaten(lg, t) {
    var k = [];
    if (lg.laufend >= 0) { k.push({ i: lg.laufend, art: "jetzt" }); }
    var l = lg.letzter >= 0 ? plan[lg.letzter] : null;
    if (l && lg.letzter !== lg.laufend && l.teil !== 1 && t - l.ende <= NACHLAUF) { k.push({ i: lg.letzter, art: "vorbei" }); }
    return k;
  }

  /* Für Sync: die letzten vergangenen, der laufende und die nächsten Abschnitte */
  function syncKandidaten(lg, t) {
    var k = [];
    var vorbei = [];
    for (var v = 0; v < plan.length; v++) {
      if (zaehlt(plan[v]) && plan[v].ende <= t && v !== lg.laufend) { vorbei.push(v); }
    }
    k = vorbei.slice();
    if (lg.laufend >= 0) { k.push(lg.laufend); }
    var ab = lg.laufend >= 0 ? lg.laufend + 1 : (lg.naechster >= 0 ? lg.naechster : plan.length);
    for (var j = ab, kommend = 0; j < plan.length && kommend < 5; j++) { if (zaehlt(plan[j])) { k.push(j); kommend++; } }
    return k;
  }

  /* ---------- Ton ---------- */

  var ctx = null;
  var master = null;

  function audioBereit() { return !!ctx && ctx.state === "running"; }

  /* Browser spielen Ton erst nach einer Berührung ab. Darum bei jeder Berührung entsperren. */
  function entsperren() {
    try { if (navigator.audioSession && navigator.audioSession.type !== "playback") { navigator.audioSession.type = "playback"; } } catch (e) { /* egal */ }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { return; }
    if (!ctx) {
      try { ctx = new AC(); } catch (e) { ctx = null; return; }
      var komp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.connect(komp);
      komp.connect(ctx.destination);
      /* Kurzer stiller Ton, damit iOS den Kanal freigibt */
      var puffer = ctx.createBuffer(1, 1, 22050);
      var q = ctx.createBufferSource();
      q.buffer = puffer;
      q.connect(ctx.destination);
      q.start(0);
      ctx.onstatechange = zeigeTonHinweis;
    }
    if (ctx.state !== "running" && ctx.resume) {
      var r = ctx.resume();
      if (r && r.then) { r.then(zeigeTonHinweis, function () {}); }
    }
    zeigeTonHinweis();
  }

  function teilton(f, t0, dauer, lautst, art, anschlag) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = art || "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(lautst, t0 + (anschlag || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dauer);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dauer + 0.05);
  }

  function glockenschlag(t0, f, lautst) {
    [[1, 0.55, 2.2], [2.0, 0.22, 1.4], [2.76, 0.2, 1.1], [5.4, 0.09, 0.6], [8.93, 0.05, 0.35]].forEach(function (p) {
      teilton(f * p[0], t0, p[2], p[1] * lautst);
    });
  }

  function gongschlag(t0, f) {
    [[1, 0.5, 4.5], [1.52, 0.32, 3.6], [2.0, 0.3, 3.2], [2.63, 0.2, 2.6], [3.47, 0.14, 2.0], [4.9, 0.08, 1.4]].forEach(function (p) {
      teilton(f * p[0], t0, p[2], p[1], "sine", 0.02);
    });
  }

  var KLAENGE = {
    glocke: function (t0) { glockenschlag(t0, 1046.5, 1); glockenschlag(t0 + 0.6, 1046.5, 0.9); glockenschlag(t0 + 1.2, 1046.5, 1); },
    gong: function (t0) { gongschlag(t0, 196); gongschlag(t0 + 1.9, 196); },
    signal: function (t0) {
      for (var r = 0; r < 2; r++) {
        for (var k = 0; k < 3; k++) { teilton(1568, t0 + r * 0.9 + k * 0.22, 0.16, 0.32, "square", 0.004); }
      }
    }
  };

  function spiele(art) {
    if (!ctx) { return false; }
    if (ctx.state !== "running" && ctx.resume) { ctx.resume().catch(function () {}); }
    master.gain.value = Math.max(0.05, E.laut / 100) * 1.4;
    var t0 = ctx.currentTime + 0.06;
    if (art === "vorwarnung") { glockenschlag(t0, 1568, 0.55); }
    else { (KLAENGE[art] || KLAENGE.glocke)(t0); }
    return true;
  }

  function vibriere(muster) {
    try {
      var ua = navigator.userActivation;
      if (navigator.vibrate && (!ua || ua.hasBeenActive)) { navigator.vibrate(muster); }
    } catch (e) { /* egal */ }
  }

  function zeigeTonHinweis() {
    $("ton-hinweis").hidden = !E.ton || audioBereit() || !(window.AudioContext || window.webkitAudioContext);
  }

  /* ---------- Bildschirm wach halten ---------- */

  var wachLock = null;
  var wachAnfrage = false;

  function wachHalten() {
    if (!E.wach || !("wakeLock" in navigator) || document.visibilityState !== "visible" || wachLock || wachAnfrage) { zeigeWachStatus(); return; }
    wachAnfrage = true;
    navigator.wakeLock.request("screen").then(function (lock) {
      wachAnfrage = false;
      wachLock = lock;
      lock.addEventListener("release", function () { wachLock = null; zeigeWachStatus(); });
      if (!E.wach) { wachLoslassen(); }
      zeigeWachStatus();
    }, function () { wachAnfrage = false; zeigeWachStatus(); });
  }
  function wachLoslassen() { if (wachLock) { wachLock.release().catch(function () {}); wachLock = null; } zeigeWachStatus(); }
  function zeigeWachStatus() {
    var text;
    if (!("wakeLock" in navigator)) { text = "Dieser Browser kann den Bildschirm nicht wach halten. Stell die automatische Sperre am Handy für den Tag länger."; }
    else if (!E.wach) { text = "Aus: Das Handy sperrt nach der eingestellten Zeit."; }
    else if (wachLock) { text = "Aktiv: Der Bildschirm bleibt an."; }
    else { text = "Wird aktiv, sobald du einmal auf die Seite tippst."; }
    setzeText($("e-wach-status"), text);
  }

  /* ---------- Hinweise als Sternchen ---------- */

  var meldungen = []; /* { zeit, real, text, eintrag, kurz } */

  function melde(text, eintrag, kurz) {
    meldungen.unshift({ zeit: jetzt(), real: Date.now(), text: text, eintrag: eintrag || null, kurz: !!kurz });
    if (meldungen.length > 6) { meldungen.length = 6; }
    ansagen(text);
    zeigeStern(true);
  }

  function zeigeStern(neu) {
    var fab = $("stern-fab");
    var n = meldungen.length;
    fab.hidden = !n;
    $("stern-zahl").hidden = n < 2;
    setzeText($("stern-zahl"), String(n));
    fab.setAttribute("aria-label", n === 1 ? "Neuer Hinweis, antippen zum Lesen" : n + " neue Hinweise, antippen zum Lesen");
    if (neu) { ploppen(fab); }
    if (!$("meldungen-pop").hidden) { zeichneMeldungen(); }
    if (!n) { $("meldungen-pop").hidden = true; fab.setAttribute("aria-expanded", "false"); }
  }

  function zeichneMeldungen() {
    var ul = $("meldungen-liste");
    ul.textContent = "";
    meldungen.forEach(function (m) {
      var li = el("li");
      li.appendChild(el("span", "mp-zeit", uhrzeit(m.zeit)));
      li.appendChild(el("p", "", m.text));
      if (m.eintrag) {
        var b = el("button", "mp-undo", "Rückgängig");
        b.type = "button";
        var noch = historie.indexOf(m.eintrag) >= 0;
        b.disabled = !noch;
        if (!noch) { b.textContent = "Schon entfernt"; }
        b.addEventListener("click", function (e) {
          e.stopPropagation(); /* sonst gilt der Klick als „daneben“, weil der Knopf neu gezeichnet wird */
          entferne(m.eintrag);
          zeichneMeldungen();
        });
        li.appendChild(b);
      }
      ul.appendChild(li);
    });
  }

  function oeffneMeldungen() {
    zeichneMeldungen();
    $("meldungen-pop").hidden = false;
    $("stern-fab").setAttribute("aria-expanded", "true");
  }
  function schliesseMeldungen() {
    if ($("meldungen-pop").hidden) { return; }
    meldungen = [];
    zeigeStern(false);
  }

  function blitz() {
    var b = $("blitz");
    b.classList.remove("an");
    void b.offsetWidth;
    b.classList.add("an");
  }

  function ansagen(text) {
    var a = $("ansage");
    a.textContent = "";
    window.setTimeout(function () { a.textContent = text; }, 50);
  }

  /* ---------- Signale am Ende und vorher ---------- */

  var letzterTick = null;

  function frisch(ms) { return ms / (probe ? probe.tempo : 1) < FRISCH; }

  function pruefeSignale(t) {
    if (letzterTick === null || t < letzterTick) { letzterTick = t; return; }
    var vorbei = null;
    var warnung = null;
    plan.forEach(function (x) {
      if (!zaehlt(x)) { return; }
      if (x.ende > letzterTick && x.ende <= t && frisch(t - x.ende)) { vorbei = x; }
      if (E.vorwarnung > 0 && x.dauer > E.vorwarnung) {
        var w = x.ende - E.vorwarnung * MIN;
        if (w > letzterTick && w <= t && frisch(t - w)) { warnung = x; }
      }
    });
    letzterTick = t;
    if (vorbei) { abschnittVorbei(vorbei); }
    else if (warnung) { vorwarnen(warnung); }
  }

  function abschnittVorbei(x) {
    var n = naechsterNach(x.i);
    var text = "Zeit ist um: " + zitat(slotTitel(x)) + ".";
    if (n) { text += n.start <= x.ende + 1000 ? " Jetzt: " + zitat(slotTitel(n)) + "." : " Weiter um " + uhrzeit(n.start) + "."; }
    blitz();
    melde(text, null, true);
    if (E.ton && !stumm[x.id]) {
      spiele(E.klang);
      vibriere([350, 150, 350, 150, 350]);
    }
  }

  function vorwarnen(x) {
    melde("Noch " + minWort(E.vorwarnung) + ": " + zitat(slotTitel(x)) + ".", null, true);
    if (E.ton && !stumm[x.id]) { spiele("vorwarnung"); vibriere(200); }
  }

  /* ---------- Anzeige: Jetzt ---------- */

  var anzeige = { chipsFuer: null, laufendId: null };

  function zeichneJetzt(lg, t) {
    var body = document.body;
    if (body.getAttribute("data-phase") !== lg.phase) { body.setAttribute("data-phase", lg.phase); }
    var status = "";
    var titel = "";
    var cdLabel = "";
    var zahl = "";
    var zeit = "";
    var zeitVerzug = "";
    var chipsFuer = null;
    var knapp = false;
    var danach = null;
    var tabTitel = "Timekeeper";

    if (lg.phase === "laeuft") {
      var x = plan[lg.laufend];
      var rest = x.ende - t;
      status = x.teil === 2 ? "Jetzt geht’s weiter" : "Jetzt";
      titel = x.a.titel;
      chipsFuer = x;
      cdLabel = "Noch";
      zahl = restText(rest);
      zeit = uhrzeit(x.start) + "–" + uhrzeit(x.ende) + " · " + Math.round(x.dauer) + " min";
      if (x.art === "normal" && !x.teil) {
        var dm = Math.round((x.ende - x.planEnde) / MIN);
        if (dm) { zeitVerzug = versatz(dm) + " gegenüber Plan"; }
      }
      knapp = rest <= Math.max(1, E.vorwarnung) * MIN;
      danach = naechsterNach(lg.laufend);
      $("j-fuell").style.width = Math.min(100, Math.max(0, (t - x.start) / (x.ende - x.start) * 100)).toFixed(2) + "%";
      tabTitel = zahl + " · " + titel;
    } else if (lg.phase === "vorher" || lg.phase === "frei") {
      var n = plan[lg.naechster];
      status = lg.phase === "vorher" ? "Gleich geht’s los" : "Frei bis " + uhrzeit(n.start);
      titel = slotTitel(n);
      chipsFuer = n;
      cdLabel = "Beginnt in";
      zahl = restText(n.start - t);
      zeit = lg.phase === "vorher"
        ? "Start um " + uhrzeit(n.start) + " · " + Math.round(n.dauer) + " min"
        : "Gerade vorbei: " + slotTitel(plan[lg.letzter]) + " (bis " + uhrzeit(plan[lg.letzter].ende) + ")";
      danach = naechsterNach(lg.naechster);
      tabTitel = zahl + " bis " + titel;
    } else if (lg.phase === "fertig") {
      var te = tagesende(plan);
      status = "Geschafft";
      titel = "Der Tag ist durch.";
      zeit = "Letzter Abschnitt endete um " + uhrzeit(te.ende) + (Math.round((te.ende - te.plan) / MIN) ? " (geplant: " + uhrzeit(te.plan) + ")" : "") + ".";
    } else {
      status = "Kein Ablauf";
      titel = "Noch kein Ablauf hinterlegt";
      zeit = "Unter Optionen kannst du einen Ablauf aus Excel einfügen.";
    }

    setzeText($("j-status"), status);
    setzeText($("j-titel"), titel);
    setzeText($("j-cd-label"), cdLabel);
    setzeText($("j-zahl"), zahl);
    var zeitEl = $("j-zeit");
    var zeitSchluessel = zeit + "|" + zeitVerzug;
    if (zeitEl.getAttribute("data-k") !== zeitSchluessel) {
      zeitEl.setAttribute("data-k", zeitSchluessel);
      zeitEl.textContent = zeit;
      if (zeitVerzug) { zeitEl.appendChild(document.createTextNode(" · ")); zeitEl.appendChild(el("span", "verzug", zeitVerzug)); }
    }
    body.classList.toggle("knapp", knapp);

    var chipsKey = chipsFuer ? chipsFuer.id + "|" + chipsFuer.teil : "";
    if (anzeige.chipsFuer !== chipsKey) {
      anzeige.chipsFuer = chipsKey;
      var box = $("j-chips");
      box.textContent = "";
      if (chipsFuer) {
        if (chipsFuer.a.typ) { box.appendChild(chip(chipsFuer.a.typ)); }
        if (chipsFuer.a.track) { box.appendChild(el("span", "chip chip-track", chipsFuer.a.track)); }
      }
    }

    var dbox = $("danach");
    dbox.hidden = !danach;
    if (danach) {
      var bezug = lg.phase === "laeuft" ? plan[lg.laufend].ende : plan[lg.naechster].ende;
      setzeText($("danach-label"), danach.start > bezug + 1000 ? "Danach, nach einer Lücke" : "Danach");
      setzeText($("danach-titel"), slotTitel(danach));
      setzeText($("danach-meta"), uhrzeit(danach.start) + "–" + uhrzeit(danach.ende) + " · " + Math.round(danach.dauer) + " min" + (danach.a.typ ? " · " + danach.a.typ : ""));
    }

    $("verlaengern").disabled = !kandidaten(lg, t).length;
    $("sync").disabled = !syncKandidaten(lg, t).length;
    $("ende-knopf").hidden = lg.phase !== "laeuft";
    $("einschub").disabled = lg.phase === "leer" || lg.phase === "fertig";
    if (document.title !== tabTitel) { document.title = tabTitel; }

    /* Ansage, wenn ein neuer Abschnitt beginnt (nicht beim ersten Laden) */
    var laufendId = lg.laufend >= 0 ? plan[lg.laufend].id : "";
    if (anzeige.laufendId !== null && laufendId && laufendId !== anzeige.laufendId) {
      ansagen("Jetzt: " + slotTitel(plan[lg.laufend]) + ", bis " + uhrzeit(plan[lg.laufend].ende) + ".");
    }
    anzeige.laufendId = laufendId;
  }

  /* ---------- Anzeige: Ablauf ---------- */

  var listeSig = "";
  var laufBalken = null;

  var SVG_NS = "http://www.w3.org/2000/svg";
  function glockenIcon(klasse, mitStrich) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "ico " + klasse);
    svg.setAttribute("aria-hidden", "true");
    var pfade = ["M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z", "M10 20.5a2.2 2.2 0 0 0 4 0"];
    if (mitStrich) { pfade.push("M4 4l16 16"); }
    pfade.forEach(function (d) { var p = document.createElementNS(SVG_NS, "path"); p.setAttribute("d", d); svg.appendChild(p); });
    return svg;
  }

  function zeichneListe(lg, t) {
    var ol = $("liste");
    ol.textContent = "";
    laufBalken = null;
    var bisher = null;
    plan.forEach(function (x, i) {
      if (bisher !== null && zaehlt(x)) {
        var frei = x.start - bisher;
        if (frei >= MIN) {
          ol.appendChild(el("li", "luecke", Math.round(frei / MIN) + " min frei (" + uhrzeit(bisher) + "–" + uhrzeit(x.start) + ")"));
        }
      }
      if (zaehlt(x)) { bisher = bisher === null ? x.ende : Math.max(bisher, x.ende); }

      var zustand = !zaehlt(x) ? "entfaellt" : i === lg.laufend ? "laeuft" : x.ende <= t ? "vorbei" : "kommt";
      var li = el("li", "zeile " + zustand + (x.art === "einschub" ? " einschub" : ""));
      if (zustand === "laeuft") { li.setAttribute("aria-current", "step"); }
      /* Planen: nur was noch kommt (auch Entfallenes in der Zukunft, um es zurückzuholen) */
      if (x.start > t && x.teil !== 1) {
        li.classList.add("planbar");
        li.setAttribute("data-plan", x.id);
        li.tabIndex = 0;
        li.setAttribute("aria-label", slotTitel(x) + ", " + uhrzeit(x.start) + ". Antippen zum Planen.");
      }

      var zeit = el("div", "z-zeit");
      zeit.appendChild(el("span", "z-start", uhrzeit(x.start)));
      if (x.art === "normal" && x.teil !== 2 && Math.round((x.start - x.planStart) / MIN)) {
        var alt = el("s", "z-alt", uhrzeit(x.planStart));
        alt.setAttribute("title", "geplant " + uhrzeit(x.planStart));
        zeit.appendChild(alt);
      }

      var inhalt = el("div", "z-inhalt");
      inhalt.appendChild(el("p", "z-titel", slotTitel(x)));
      var meta = el("p", "z-meta");
      if (x.a.typ) { meta.appendChild(chip(x.a.typ)); }
      var teile = [];
      if (x.a.track && x.teil !== 2) { teile.push(x.a.track); }
      if (x.a.wer && x.teil !== 2) { teile.push(x.a.wer); }
      if (!zaehlt(x)) { teile.push("entfällt"); }
      else { teile.push(Math.round(x.dauer) + " min, bis " + uhrzeit(x.ende)); }
      if (x.teil === 1) { teile.push("unterbrochen"); }
      meta.appendChild(el("span", "", teile.join(" · ")));
      if (x.art === "normal" && !x.teil && zaehlt(x)) {
        var diff = Math.round(x.dauer) - x.a.dauer;
        if (diff) { meta.appendChild(el("span", "z-diff " + (diff > 0 ? "plus" : "minus"), versatz(diff))); }
      }
      inhalt.appendChild(meta);
      if (zustand === "laeuft") {
        var b = el("div", "z-balken");
        laufBalken = el("i");
        b.appendChild(laufBalken);
        inhalt.appendChild(b);
      }

      var glocke = el("button", "glocke");
      glocke.type = "button";
      glocke.setAttribute("data-id", x.id);
      glocke.setAttribute("aria-pressed", stumm[x.id] ? "false" : "true");
      glocke.setAttribute("aria-label", "Ton am Ende von " + zitat(slotTitel(x)));
      glocke.title = stumm[x.id] ? "Kein Ton am Ende" : "Ton am Ende";
      glocke.appendChild(glockenIcon("ico-an", false));
      glocke.appendChild(glockenIcon("ico-aus", true));

      li.appendChild(zeit);
      li.appendChild(inhalt);
      li.appendChild(glocke);
      ol.appendChild(li);
    });

    var te = tagesende(plan);
    var ende = $("tagesende");
    ende.textContent = "";
    if (te.ende !== null) {
      ende.appendChild(document.createTextNode("Ende "));
      ende.appendChild(el("strong", "", uhrzeit(te.ende)));
      var d = Math.round((te.ende - te.plan) / MIN);
      if (d) {
        ende.appendChild(document.createTextNode(" "));
        ende.appendChild(el("span", "verzug", "(" + versatz(d) + ", Plan " + uhrzeit(te.plan) + ")"));
      }
    }
    zeichneAenderungen();
  }

  function abzugText(h) {
    return (h.abzug || []).length
      ? " · weggenommen bei " + h.abzug.map(function (a) { return zitat(titelVon(a[0])) + " −" + a[1]; }).join(", ")
      : "";
  }

  function aenderungText(h) {
    var art = h.art || "plus";
    if (art === "sync") { return uhrzeit(h.zeit) + " · Sync: " + zitat(titelVon(h.id)) + " gestartet"; }
    if (art === "plan") {
      var teile = [];
      if (h.titel && h.alterTitel && h.titel !== h.alterTitel) { teile.push("heißt jetzt " + zitat(h.titel)); }
      if (h.alterTyp != null && h.typ !== h.alterTyp) { teile.push("Typ " + (h.typ || "keiner")); }
      if (h.plus || h.start != null) {
        teile.push(h.nachher === 0 ? "entfällt" : (h.von != null ? uhrzeit(h.von) + "–" + uhrzeit(h.bis) + " (" + h.nachher + " min)" : h.vorher + " → " + h.nachher + " min"));
      }
      return uhrzeit(h.zeit) + " · Geplant: " + zitat(h.alterTitel || titelVon(h.ziel || h.id)) + " " + (teile.join(", ") || "unverändert");
    }
    if (art === "ende") { return uhrzeit(h.zeit) + " · " + zitat(titelVon(h.ziel || h.id)) + " endet um " + uhrzeit(h.bis); }
    if (art === "einschub") {
      return uhrzeit(h.zeit) + " · " + zitat(h.titel) + " (" + h.dauer + " min) " +
        (h.um != null ? "um " + uhrzeit(h.um) : "nach " + zitat(titelVon(h.nach))) + abzugText(h);
    }
    return uhrzeit(h.zeit) + " · " + zitat(titelVon(h.ziel || h.id)) + " +" + h.plus + " min" + (abzugText(h) || " · alles danach verschoben");
  }

  function zeichneAenderungen() {
    var ul = $("aend-liste");
    ul.textContent = "";
    $("aenderungen").hidden = !historie.length;
    for (var n = historie.length - 1; n >= 0; n--) {
      var li = el("li");
      li.appendChild(el("span", "", aenderungText(historie[n])));
      var x = el("button", "aend-x", "×");
      x.type = "button";
      x.setAttribute("data-n", String(n));
      x.setAttribute("aria-label", "Diese Änderung entfernen");
      x.title = "Entfernen";
      li.appendChild(x);
      ul.appendChild(li);
    }
  }

  function baueTicker() {
    var spur = $("ticker");
    spur.textContent = "";
    var woerter = [ablauf.titel, ablauf.tag].filter(Boolean).concat(TICKER_ZUSATZ);
    for (var k = 0; k < 2; k++) {
      woerter.forEach(function (w) {
        spur.appendChild(el("span", "wort", w));
        spur.appendChild(el("span", "stern stern-teal"));
      });
    }
  }

  function zeichneKopf() {
    setzeText($("kopf-titel"), ablauf.titel);
    setzeText($("tag-titel"), ablauf.tag || ablauf.titel || "Ablauf");
  }

  /* ---------- Takt ---------- */

  function tick() {
    var t = jetzt();
    var t0 = tagBeginn(t);
    if (t0 !== tag0) {
      /* Neuer Tag: gestrige Änderungen gelten nicht mehr */
      tag0 = t0;
      if (historie.length) { historie = []; speichereTag(); }
      neuBerechnen();
      letzterTick = null;
    }
    var lg = lage(plan, t);
    pruefeSignale(t);
    zeichneJetzt(lg, t);
    var sig = version + "|" + lg.laufend + "|" + lg.naechster + "|" + lg.letzter;
    if (sig !== listeSig) { listeSig = sig; zeichneListe(lg, t); }
    if (laufBalken && lg.laufend >= 0) {
      var x = plan[lg.laufend];
      laufBalken.style.width = Math.min(100, Math.max(0, (t - x.start) / (x.ende - x.start) * 100)).toFixed(1) + "%";
    }
    setzeText($("uhr"), uhrzeitSek(t));

    /* Kurzlebige Hinweise (Abschnittsende) verschwinden nach ein paar Minuten */
    var vorher = meldungen.length;
    meldungen = meldungen.filter(function (m) { return !m.kurz || Date.now() - m.real < MELDUNG_KURZ; });
    if (meldungen.length !== vorher) { zeigeStern(false); }

    if (dv && $("d-verl").open) { zeichneDv(false); }
    if ($("d-sync").open) { zeichneSync(); }
    if (dn && $("d-ende").open) { zeichneEnde(); }
  }

  /* Nach jeder Änderung: neu rechnen, speichern, ohne dass für den Moment der Änderung ein Ton kommt */
  function geaendert() {
    speichereTag();
    neuBerechnen();
    letzterTick = jetzt();
    tick();
  }

  function entferne(eintrag) {
    var n = historie.indexOf(eintrag);
    if (n < 0) { return; }
    historie.splice(n, 1);
    geaendert();
  }

  /* ---------- Verlängern und Einschub (gemeinsamer Dialog) ---------- */

  var dv = null;
  /* { modus: "plus" | "einschub", plus, abzug: {dauerId: min}, reihenfolge: [dauerId], sig,
       plus:   kandidaten, zielId
       einschub: name, wannListe, wann, eid } */

  function dialogZuruecksetzen(d) {
    d.querySelectorAll(".blase").forEach(function (b) { b.hidden = true; });
    d.querySelectorAll(".info-stern").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
  }

  function oeffneVerlaengern() {
    var t = jetzt();
    var lg = lage(plan, t);
    var k = kandidaten(lg, t);
    if (!k.length) { return; }
    dv = {
      modus: "plus",
      kandidaten: k.map(function (c) { return { id: plan[c.i].id, art: c.art }; }),
      zielId: plan[k[0].i].id,
      plus: Math.min(MAX_PLUS, Math.max(1, E.plus || 2)),
      abzug: {},
      reihenfolge: [],
      sig: ""
    };
    var opts = $("dv-welcher-opts");
    opts.textContent = "";
    $("dv-welcher").hidden = dv.kandidaten.length < 2;
    dv.kandidaten.forEach(function (c, n) {
      var x = slotVon(c.id);
      var inp = el("input");
      inp.type = "radio";
      inp.name = "dv-ziel";
      inp.id = "dv-ziel-" + n;
      inp.value = c.id;
      inp.checked = c.id === dv.zielId;
      var lab = el("label");
      lab.htmlFor = inp.id;
      lab.appendChild(el("span", "", slotTitel(x)));
      lab.appendChild(el("small", "", c.art === "jetzt" ? "läuft, bis " + uhrzeit(x.ende) : "vorbei seit " + uhrzeit(x.ende)));
      opts.appendChild(inp);
      opts.appendChild(lab);
    });
    $("dv-einschub-felder").hidden = true;
    setzeText($("dv-mini"), "Verlängern");
    setzeText($("dv-min-legend"), "Um wie viele Minuten?");
    oeffneDv();
  }

  function oeffneEinschub() {
    var t = jetzt();
    var lg = lage(plan, t);
    if (lg.phase === "leer" || lg.phase === "fertig") { return; }
    var w = [];
    if (lg.laufend >= 0) {
      var x = plan[lg.laufend];
      w.push({ text: "Jetzt (unterbricht " + zitat(slotTitel(x)) + ")", nach: x.id, jetzt: true });
    } else {
      w.push({ text: "Jetzt", nach: lg.letzter >= 0 ? plan[lg.letzter].id : "", jetzt: true });
    }
    var ab = lg.laufend >= 0 ? lg.laufend : lg.naechster;
    for (var j = ab; j >= 0 && j < plan.length; j++) {
      var y = plan[j];
      if (zaehlt(y)) { w.push({ text: "Nach " + zitat(slotTitel(y)) + " (" + uhrzeit(y.ende) + ")", nach: y.id, jetzt: false }); }
    }
    dv = {
      modus: "einschub",
      plus: Math.min(MAX_PLUS, Math.max(1, E.einschub || 3)),
      abzug: {},
      reihenfolge: [],
      name: E.einschubName || "Energizer",
      wannListe: w,
      wann: 0,
      eid: "e" + Date.now().toString(36),
      sig: ""
    };
    var sel = $("dv-wann");
    sel.textContent = "";
    w.forEach(function (o, n) { var op = el("option", "", o.text); op.value = String(n); sel.appendChild(op); });
    sel.value = "0";
    $("dv-name").value = dv.name;
    $("dv-welcher").hidden = true;
    $("dv-einschub-felder").hidden = false;
    setzeText($("dv-mini"), "Einschub");
    setzeText($("dv-min-legend"), "Wie lange?");
    oeffneDv();
  }

  function oeffneDv() {
    var radio = document.querySelector('input[name="dv-plus"][value="' + dv.plus + '"]');
    if (radio) { radio.checked = true; }
    dialogZuruecksetzen($("d-verl"));
    $("dv-fazit").textContent = "";
    zeichneDv(false);
    $("d-verl").showModal();
    var fokus = document.querySelector('input[name="dv-plus"]:checked');
    if (fokus) { fokus.focus(); }
  }

  function dvSumme() {
    var s = 0;
    Object.keys(dv.abzug).forEach(function (id) { s += dv.abzug[id]; });
    return s;
  }

  function dvEintrag() {
    var abzug = dv.reihenfolge.filter(function (id) { return dv.abzug[id] > 0; }).map(function (id) { return [id, dv.abzug[id]]; });
    if (dv.modus === "einschub") {
      var w = dv.wannListe[dv.wann] || dv.wannListe[0];
      return { art: "einschub", zeit: jetzt(), eid: dv.eid, titel: sauber(dv.name) || "Einschub", dauer: dv.plus, nach: w.nach, um: w.jetzt ? jetzt() : null, abzug: abzug };
    }
    var ziel = slotVon(dv.zielId);
    return { art: "plus", zeit: jetzt(), id: ziel ? ziel.dauerId : dv.zielId, ziel: dv.zielId, plus: dv.plus, abzug: abzug };
  }

  /* Abzüge kürzen, falls weniger Minuten gewählt wurden (zuletzt gewählte zuerst) */
  function dvKuerzen() {
    var zuViel = dvSumme() - dv.plus;
    for (var n = dv.reihenfolge.length - 1; n >= 0 && zuViel > 0; n--) {
      var id = dv.reihenfolge[n];
      var weg = Math.min(zuViel, dv.abzug[id] || 0);
      dv.abzug[id] -= weg;
      zuViel -= weg;
    }
    dvAufraeumen();
  }
  function dvAufraeumen() {
    dv.reihenfolge = dv.reihenfolge.filter(function (id) { return dv.abzug[id] > 0; });
    Object.keys(dv.abzug).forEach(function (id) { if (!(dv.abzug[id] > 0)) { delete dv.abzug[id]; } });
  }

  /* Zeilen „Wo wegnehmen?“: alles nach dem verlängerten Abschnitt bzw. nach dem Einschub */
  function dvZeilen(neu) {
    var ankerId = dv.modus === "einschub" ? dv.eid : dv.zielId;
    var ankerSlot = slotVon(ankerId, neu);
    var ab = ankerSlot ? ankerSlot.i : neu.length;
    var gesehen = {};
    if (ankerSlot) { gesehen[ankerSlot.dauerId] = true; }
    var zeilen = [];
    for (var j = ab + 1; j < neu.length; j++) {
      var nx = neu[j];
      if (gesehen[nx.dauerId]) { continue; }
      gesehen[nx.dauerId] = true;
      var genommen = dv.abzug[nx.dauerId] || 0;
      var vorherDauer = nx.dauer + genommen;
      if (vorherDauer < 0.5 && !genommen) { continue; }
      var alt = slotVon(nx.id);
      zeilen.push({
        nx: nx, id: nx.dauerId, genommen: genommen,
        max: Math.floor(vorherDauer + 1e-9),
        vorher: Math.round(vorherDauer),
        versatz: alt ? Math.round((nx.start - alt.start) / MIN) : 0
      });
    }
    return { zeilen: zeilen, ankerIdx: ab };
  }

  function zeichneDv(nachAktion) {
    if (!dv) { return; }
    if (dv.modus === "plus" && !slotVon(dv.zielId)) { $("d-verl").close(); return; }
    var neu = berechne(historie.concat([dvEintrag()]));
    var z = dvZeilen(neu);

    /* Abzüge, deren Abschnitt nicht mehr nach dem Einschub liegt, verwerfen */
    var erlaubt = {};
    var verworfen = false;
    z.zeilen.forEach(function (r) { erlaubt[r.id] = true; });
    Object.keys(dv.abzug).forEach(function (id) { if (!erlaubt[id]) { delete dv.abzug[id]; verworfen = true; } });
    dvAufraeumen();
    if (verworfen) {
      neu = berechne(historie.concat([dvEintrag()]));
      z = dvZeilen(neu);
    }
    var rest = dv.plus - dvSumme();

    var titel = dv.modus === "einschub" ? zitat(sauber(dv.name) || "Einschub") + " einbauen" : zitat(titelVon(dv.zielId)) + " verlängern";
    var fazit = dvFazit(neu, z.ankerIdx);
    var sig = JSON.stringify([titel, rest, z.zeilen.map(function (r) {
      return [r.id, uhrzeit(r.nx.start), r.versatz, r.genommen, r.max, r.vorher, Math.round(r.nx.dauer)];
    }), fazit, dv.plus]);
    if (sig === dv.sig) { return; }
    dv.sig = sig;

    setzeText($("dv-titel"), titel);

    /* Fokus merken, weil die Liste neu gebaut wird */
    var aktiv = document.activeElement;
    var merkId = aktiv && aktiv.getAttribute ? aktiv.getAttribute("data-id") : null;
    var merkAktion = aktiv && aktiv.getAttribute ? aktiv.getAttribute("data-aktion") : null;

    var ul = $("dv-liste");
    ul.textContent = "";
    z.zeilen.forEach(function (r) {
      var nx = r.nx;
      var name = slotTitel(nx);
      var li = el("li", "dv-zeile" + (r.genommen ? " gewaehlt" : ""));
      var wahl = el("button", "dv-wahl");
      wahl.type = "button";
      wahl.setAttribute("data-id", r.id);
      wahl.setAttribute("data-aktion", "alles");
      wahl.setAttribute("data-max", String(r.max));
      wahl.disabled = r.max === 0;
      var zeit = el("span", "dv-zeit", uhrzeit(nx.start));
      if (r.versatz) { zeit.appendChild(el("small", r.versatz > 0 ? "" : "frueher", versatz(r.versatz))); }
      var text = el("span", "dv-text");
      text.appendChild(el("span", "dv-titel", name));
      var meta = el("span", "dv-meta");
      if (nx.a.typ) { meta.appendChild(chip(nx.a.typ)); }
      if (r.genommen) {
        var wert = el("span", "nowrap", r.vorher + " → ");
        wert.appendChild(el("strong", "", Math.round(nx.dauer) + " min"));
        meta.appendChild(wert);
      } else {
        meta.appendChild(el("span", "nowrap", r.vorher + " min"));
      }
      text.appendChild(meta);
      wahl.appendChild(zeit);
      wahl.appendChild(text);
      wahl.setAttribute("aria-label", name + ", " + r.vorher + " min. Ganze Zeit hier wegnehmen.");

      var stepper = el("div", "stepper");
      var minus = el("button", "", "−");
      minus.type = "button";
      minus.setAttribute("data-id", r.id);
      minus.setAttribute("data-aktion", "minus");
      minus.setAttribute("aria-label", "Eine Minute weniger bei " + zitat(name) + " wegnehmen");
      minus.disabled = r.genommen === 0;
      var out = el("output", r.genommen ? "" : "null", r.genommen ? "−" + r.genommen : "0");
      out.setAttribute("aria-label", r.genommen + " min weggenommen");
      var plus = el("button", "", "+");
      plus.type = "button";
      plus.setAttribute("data-id", r.id);
      plus.setAttribute("data-aktion", "plus");
      plus.setAttribute("data-max", String(r.max));
      plus.setAttribute("aria-label", "Eine Minute mehr bei " + zitat(name) + " wegnehmen");
      plus.disabled = rest <= 0 || r.genommen >= r.max;
      stepper.appendChild(minus);
      stepper.appendChild(out);
      stepper.appendChild(plus);

      li.appendChild(wahl);
      li.appendChild(stepper);
      ul.appendChild(li);
    });
    if (!z.zeilen.length) { ul.appendChild(el("li", "dv-zeile dv-leer", "Danach kommt nichts mehr.")); }

    if (merkId && merkAktion) {
      var wieder = ul.querySelector('[data-id="' + attrSicher(merkId) + '"][data-aktion="' + merkAktion + '"]');
      if (wieder && wieder.disabled) { wieder = ul.querySelector('[data-id="' + attrSicher(merkId) + '"][data-aktion="alles"]'); }
      if (wieder) { wieder.focus(); }
    }

    var fz = $("dv-fazit");
    if (fz.textContent !== fazit) {
      fz.textContent = fazit;
      if (nachAktion) { ploppen($("dv-stern")); }
    }
    setzeText($("dv-ok"), dv.modus === "einschub" ? dv.plus + " min einbauen" : "+" + dv.plus + " min übernehmen");
  }

  function dvFazit(neu, ankerIdx) {
    var saetze = [];
    var s = neu[ankerIdx];
    if (!s) { return ""; }
    if (dv.modus === "plus") {
      var alt = slotVon(s.id);
      saetze.push(zitat(slotTitel(s)) + " geht dann bis " + uhrzeit(s.ende) + (alt ? " statt " + uhrzeit(alt.ende) : "") + ".");
    } else {
      saetze.push(zitat(s.a.titel) + " läuft " + uhrzeit(s.start) + "–" + uhrzeit(s.ende) + ".");
      var f = neu[ankerIdx + 1];
      if (f && f.teil === 2) { saetze.push("Danach geht " + zitat(f.a.titel) + " bis " + uhrzeit(f.ende) + " weiter."); }
    }
    /* Ab welcher Zeile bleibt alles wie bisher? */
    var gleichAb = -1;
    for (var m = neu.length - 1; m > ankerIdx; m--) {
      var a = slotVon(neu[m].id);
      if (a && a.start === neu[m].start && a.ende === neu[m].ende) { gleichAb = m; } else { break; }
    }
    if (gleichAb > ankerIdx) {
      saetze.push(gleichAb === ankerIdx + 1 ? "Alles danach bleibt wie bisher." : "Ab " + uhrzeit(neu[gleichAb].start) + " (" + zitat(slotTitel(neu[gleichAb])) + ") bleibt alles wie bisher.");
    } else {
      var teA = tagesende(plan).ende;
      var teN = tagesende(neu).ende;
      if (Math.round((teN - teA) / MIN)) { saetze.push("Der Tag endet um " + uhrzeit(teN) + " statt " + uhrzeit(teA) + "."); }
    }
    return saetze.join(" ");
  }

  function dvKlick(e) {
    var b = e.target.closest ? e.target.closest("button[data-aktion]") : null;
    if (!b || b.disabled || !dv) { return; }
    var id = b.getAttribute("data-id");
    var aktion = b.getAttribute("data-aktion");
    var max = Number(b.getAttribute("data-max")) || 0;
    var hatte = dv.abzug[id] || 0;
    if (aktion === "alles") {
      var voll = Math.min(dv.plus, max);
      var nurDas = hatte === voll && dv.reihenfolge.length === 1;
      dv.abzug = {};
      if (!nurDas) { dv.abzug[id] = voll; }   /* Nochmal antippen: Auswahl aufheben */
      dv.reihenfolge = dv.abzug[id] ? [id] : [];
    } else if (aktion === "plus") {
      if (dvSumme() < dv.plus && hatte < max) {
        dv.abzug[id] = hatte + 1;
        if (dv.reihenfolge.indexOf(id) < 0) { dv.reihenfolge.push(id); }
      }
    } else if (aktion === "minus") {
      if (hatte > 0) { dv.abzug[id] = hatte - 1; }
    }
    dvAufraeumen();
    zeichneDv(true);
  }

  function dvUebernehmen() {
    if (!dv) { return; }
    if (dv.modus === "plus" && !slotVon(dv.zielId)) { $("d-verl").close(); return; }
    var eintrag = dvEintrag();
    historie.push(eintrag);
    if (dv.modus === "plus") { E.plus = dv.plus; }
    else { E.einschub = dv.plus; E.einschubName = eintrag.titel; }
    speichereEinst();
    $("d-verl").close();
    geaendert();
    var text = eintrag.art === "einschub"
      ? zitat(eintrag.titel) + " " + eintrag.dauer + " min eingebaut"
      : zitat(titelVon(eintrag.ziel)) + " +" + eintrag.plus + " min";
    text += eintrag.abzug.length
      ? ", " + eintrag.abzug.map(function (a) { return zitat(titelVon(a[0])) + " −" + a[1]; }).join(", ") + "."
      : ", alles danach rückt nach.";
    melde(text, eintrag);
  }

  /* ---------- Ende eines laufenden Abschnitts auf eine Uhrzeit legen ---------- */

  var dn = null; /* { zielId, bis (Zeitpunkt) } */

  function oeffneEnde() {
    var lg = lage(plan, jetzt());
    if (lg.laufend < 0) { return; }
    var x = plan[lg.laufend];
    dn = { zielId: x.id, bis: Math.round(x.ende / MIN) * MIN };
    setzeText($("dn-titel"), zitat(slotTitel(x)) + " endet um …");
    $("dn-zeit").value = uhrzeit(dn.bis);
    zeichneEnde();
    $("d-ende").showModal();
  }

  function dnEintrag() {
    var x = slotVon(dn.zielId);
    if (!x) { return null; }
    return { art: "ende", zeit: jetzt(), id: x.dauerId, ziel: x.id, plus: (dn.bis - x.ende) / MIN, bis: dn.bis };
  }

  function zeichneEnde() {
    var info = $("dn-info");
    var x = slotVon(dn.zielId);
    var t = jetzt();
    var ok = false;
    var text;
    if (!x || x.ende <= t) {
      text = "Dieser Abschnitt läuft nicht mehr.";
    } else if (dn.bis <= t) {
      text = "Die Uhrzeit muss nach jetzt (" + uhrzeit(t) + ") liegen.";
    } else {
      var m = Math.round((dn.bis - x.ende) / MIN);
      if (!m) {
        text = "Unverändert.";
      } else {
        ok = true;
        var neu = berechne(historie.concat([dnEintrag()]));
        var teA = tagesende(plan).ende;
        var teN = tagesende(neu).ende;
        var dt = Math.round((teN - teA) / MIN);
        text = versatz(m) + " · " + (dt ? "Tag endet " + uhrzeit(teN) : "Tagesende bleibt " + uhrzeit(teA));
      }
    }
    info.className = "dn-info" + (ok || text === "Unverändert." ? "" : " fehler");
    setzeText(info, text);
    $("dn-ok").disabled = !ok;
  }

  function dnSetzeZeit(bis) {
    dn.bis = bis;
    $("dn-zeit").value = uhrzeit(bis);
    zeichneEnde();
  }

  function dnUebernehmen() {
    if (!dn) { return; }
    zeichneEnde();
    if ($("dn-ok").disabled) { return; }
    var eintrag = dnEintrag();
    var x = slotVon(dn.zielId);
    var m = Math.round(eintrag.plus);
    historie.push(eintrag);
    $("d-ende").close();
    geaendert();
    melde(zitat(slotTitel(x)) + " endet um " + uhrzeit(eintrag.bis) + " (" + versatz(m) + "), alles danach rückt nach.", eintrag);
  }

  /* ---------- Planen: kommende Abschnitte im Ablauf ändern ---------- */

  var dp = null; /* { zielId, von, bis } */

  function minuteGenau(t) { return Math.round(t / MIN) * MIN; }

  function oeffnePlan(id) {
    var x = slotVon(id);
    if (!x || x.start <= jetzt()) { return; }
    dp = { zielId: id, von: minuteGenau(x.start), bis: minuteGenau(x.ende) };
    setzeText($("dp-titel"), zitat(slotTitel(x)));
    $("dp-von").value = uhrzeit(dp.von);
    $("dp-bis").value = uhrzeit(dp.bis);
    zeichnePlan();
    $("d-plan").showModal();
  }

  function dpEintrag() {
    var x = slotVon(dp.zielId);
    if (!x) { return null; }
    var startNeu = Math.abs(dp.von - minuteGenau(x.start)) >= MIN;
    var vonEff = startNeu ? dp.von : x.start;
    var bisEff = Math.abs(dp.bis - minuteGenau(x.ende)) >= MIN || startNeu ? dp.bis : x.ende;
    var neueDauer = Math.max(0, bisEff - vonEff) / MIN;
    return {
      art: "plan", zeit: jetzt(), id: x.dauerId, ziel: x.id,
      alterTitel: x.a.titel,
      start: startNeu ? dp.von : null,
      plus: Math.abs(neueDauer - x.dauer) < 0.01 ? 0 : neueDauer - x.dauer,
      vorher: Math.round(x.dauer), nachher: Math.round(neueDauer),
      von: vonEff, bis: bisEff
    };
  }

  function zeichnePlan() {
    var x = slotVon(dp.zielId);
    var t = jetzt();
    if (!x || x.start <= t) { $("d-plan").close(); return; }
    var fehler = "";
    if (dp.von <= t) { fehler = "Der Start muss nach jetzt (" + uhrzeit(t) + ") liegen."; }
    else if (dp.bis < dp.von) { fehler = "Das Ende muss nach dem Start liegen."; }
    var info = $("dp-info");
    var e = fehler ? null : dpEintrag();
    if (fehler) {
      info.className = "dn-info fehler";
      setzeText(info, fehler);
    } else {
      var neu = berechne(historie.concat([e]));
      var teA = tagesende(plan).ende;
      var teN = tagesende(neu).ende;
      var dt = Math.round((teN - teA) / MIN);
      info.className = "dn-info";
      setzeText(info, (e.nachher === 0 ? "Entfällt" : e.nachher + " min") + " · " +
        (dt ? "Tag endet " + uhrzeit(teN) + " (" + versatz(dt) + ")" : "Tagesende bleibt " + uhrzeit(teA)));
    }
    $("dp-weg").hidden = dp.bis === dp.von;
    $("dp-zurueck").hidden = !(dp.bis === dp.von && x.a.dauer > 0);
    var geaendertJa = !!e && (e.plus !== 0 || e.start != null);
    $("dp-ok").disabled = !geaendertJa;
  }

  function dpSetzeEnde(bis) {
    dp.bis = bis;
    $("dp-bis").value = uhrzeit(bis);
    zeichnePlan();
  }

  function dpUebernehmen() {
    if (!dp) { return; }
    zeichnePlan();
    if ($("dp-ok").disabled) { return; }
    var e = dpEintrag();
    historie.push(e);
    $("d-plan").close();
    geaendert();
    melde("Geplant: " + aenderungText(e).replace(/^.*? · Geplant: /, "") + ".", e);
  }

  /* ---------- Sync: „Das startet jetzt“ ---------- */

  var syncSig = "";

  function oeffneSync() {
    var t = jetzt();
    var lg = lage(plan, t);
    if (!syncKandidaten(lg, t).length) { return; }
    syncSig = "";
    dialogZuruecksetzen($("d-sync"));
    $("ds-liste").textContent = "";
    $("d-sync").showModal();
    zeichneSync();
  }

  function zeichneSync() {
    var t = jetzt();
    var T = t;
    var lg = lage(plan, t);
    var k = syncKandidaten(lg, t);
    setzeText($("ds-uhr"), "jetzt " + uhrzeit(t));

    var zeilen = k.map(function (i) {
      var x = plan[i];
      var info;
      var vergangen = x.ende <= t && i !== lg.laufend;
      if (vergangen) {
        info = "laut App " + uhrzeit(x.start) + "–" + uhrzeit(x.ende);
      } else if (i === lg.laufend) {
        info = "läuft laut App seit " + uhrzeit(x.start);
      } else {
        var ueber = [];
        for (var j = lg.laufend >= 0 ? lg.laufend + 1 : 0; j < i; j++) { if (zaehlt(plan[j]) && plan[j].start > T) { ueber.push(plan[j]); } }
        info = ueber.length
          ? "überspringt " + (ueber.length === 1 ? zitat(slotTitel(ueber[0])) : ueber.length + " Abschnitte")
          : (lg.laufend >= 0 ? "beendet " + zitat(slotTitel(plan[lg.laufend])) : "als Nächstes");
      }
      return { id: x.id, titel: slotTitel(x), zeit: uhrzeit(x.start), info: info, m: Math.round((T - x.start) / MIN), vergangen: vergangen };
    });
    /* Chronologisch: Vergangenes oben (per Scrollen erreichbar), Jetzt und Kommendes darunter */
    var sig = JSON.stringify([uhrzeit(T), zeilen]);
    if (sig === syncSig) { return; }
    syncSig = sig;
    var ul = $("ds-liste");
    var body = $("ds-body");
    var merkJetzt = ul.querySelector(".sync-jetzt");
    var abstand = merkJetzt ? merkJetzt.getBoundingClientRect().top - body.getBoundingClientRect().top : null;
    ul.textContent = "";
    var hatVergangene = zeilen.some(function (z) { return z.vergangen; });
    if (hatVergangene) {
      ul.appendChild(el("li", "feld-label sync-trenner", "Schon vorbei"));
    }
    var jetztGesetzt = false;
    zeilen.forEach(function (z) {
      if (!z.vergangen && !jetztGesetzt) {
        jetztGesetzt = true;
        ul.appendChild(el("li", "feld-label sync-trenner sync-jetzt", "Jetzt und als Nächstes"));
      }
      var li = el("li");
      var b = el("button", "sync-zeile" + (z.vergangen ? " vergangen" : ""));
      b.type = "button";
      b.setAttribute("data-id", z.id);
      var text = el("span", "sz-text");
      text.appendChild(el("span", "sz-titel", z.titel));
      text.appendChild(el("span", "sz-meta", z.info));
      b.appendChild(el("span", "sz-zeit", z.zeit));
      b.appendChild(text);
      b.appendChild(el("span", "sz-effekt" + (z.m > 0 ? " spaeter" : z.m < 0 ? " frueher" : ""), z.m ? versatz(z.m) : "pünktlich"));
      b.setAttribute("aria-label", z.titel + " startet jetzt. " + z.info + ". Alles danach " + (z.m ? versatz(z.m) : "unverändert") + ".");
      li.appendChild(b);
      ul.appendChild(li);
    });
    /* Platz unten, damit „Jetzt“ ganz nach oben gescrollt werden kann */
    var platz = el("li", "sync-platz");
    ul.appendChild(platz);
    var jetztKopf = ul.querySelector(".sync-jetzt");
    if (jetztKopf && body.clientHeight) {
      var kopfHoehe = body.querySelector(".sync-kopf").offsetHeight;
      var unterhalb = ul.getBoundingClientRect().bottom - jetztKopf.getBoundingClientRect().top;
      platz.style.height = Math.max(0, body.clientHeight - kopfHoehe - unterhalb) + "px";
      /* Beim Öffnen: „Jetzt“ direkt unter die Überschrift; beim Aktualisieren: Position halten */
      var ziel = abstand === null ? kopfHoehe : abstand;
      body.scrollTop += jetztKopf.getBoundingClientRect().top - body.getBoundingClientRect().top - ziel;
    }
  }

  function syncSetzen(id) {
    var x = slotVon(id);
    var t = jetzt();
    var T = t;
    if (!x) { return; }
    var m = Math.round((T - x.start) / MIN);
    var eintrag = { art: "sync", zeit: T, id: id };
    historie.push(eintrag);
    $("d-sync").close();
    geaendert();
    melde("Sync: " + zitat(slotTitel(x)) + " läuft seit " + uhrzeit(T) + "." + (m ? " Alles danach " + versatz(m) + "." : ""), eintrag);
  }

  /* ---------- Ablauf aus Excel einfügen ---------- */

  /* Tabellen-Text (Tab oder Semikolon, Excel-Anführungszeichen) in Zeilen und Zellen */
  function parseTabelle(text) {
    var trenner = text.indexOf("\t") >= 0 ? "\t" : (text.indexOf(";") >= 0 ? ";" : "\t");
    var zeilen = [];
    var zeile = [];
    var feld = "";
    var inQ = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQ) {
        if (c === '"') {
          if (text[i + 1] === '"') { feld += '"'; i++; } else { inQ = false; }
        } else { feld += c; }
        continue;
      }
      if (c === '"' && feld === "") { inQ = true; }
      else if (c === trenner) { zeile.push(feld); feld = ""; }
      else if (c === "\n") { zeile.push(feld); zeilen.push(zeile); zeile = []; feld = ""; }
      else if (c !== "\r") { feld += c; }
    }
    zeile.push(feld);
    zeilen.push(zeile);
    return zeilen
      .map(function (z) { return z.map(sauber); })
      .filter(function (z) { return z.some(Boolean); });
  }

  var KOPF = [
    ["start", /^(start|beginn|von|uhrzeit)\b/i], ["ende", /^(ende|bis)\b/i], ["dauer", /^(dauer|minuten|min\b)/i],
    ["typ", /^(typ|art)\b/i], ["session", /^(session|titel|programm|inhalt|thema|was)\b/i],
    ["track", /^(track|gruppe)/i], ["wer", /^(wer|verantwortlich|moderation)\b/i]
  ];

  function erkenneKopf(zellen) {
    var map = {};
    var n = 0;
    zellen.forEach(function (z, i) {
      for (var k = 0; k < KOPF.length; k++) {
        if (map[KOPF[k][0]] == null && KOPF[k][1].test(z)) { map[KOPF[k][0]] = i; n++; break; }
      }
    });
    return map.start != null && n >= 2 ? map : null;
  }

  /* Ohne Überschrift: Spalten wie in der Tabelle (Start, Ende, Dauer, Typ, Session, Track, Wer).
     Die Aufteilung wird an der vollständigsten Zeile abgelesen und gilt dann für alle,
     weil Excel leere Zellen beim Kopieren mitliefert. */
  function positionen(zellen) {
    var s = -1;
    for (var i = 0; i < zellen.length; i++) { if (zuMinuten(zellen[i]) != null) { s = i; break; } }
    if (s < 0) { return null; }
    var p = { start: s };
    var k = s + 1;
    if (zuMinuten(zellen[k]) != null) { p.ende = k++; }
    if (/^\d+(\s*min\.?)?$/i.test(zellen[k] || "")) { p.dauer = k++; }
    var rest = zellen.slice(k).filter(Boolean).length;
    if (rest === 1) { p.session = zellen.slice(k).findIndex(Boolean) + k; return p; }
    p.typ = k; p.session = k + 1; p.track = k + 2; p.wer = k + 3;
    return p;
  }

  function musterZeile(zeilen) {
    var beste = null;
    var max = -1;
    zeilen.forEach(function (z) {
      var n = z.filter(Boolean).length;
      if (n > max && z.some(function (c) { return zuMinuten(c) != null; })) { beste = z; max = n; }
    });
    return beste ? positionen(beste) : null;
  }

  function leseAblauf(text) {
    var zeilen = parseTabelle(text || "");
    var kopf = null;
    var muster = musterZeile(zeilen);
    var titel = "";
    var roh = [];
    var unlesbar = 0;
    zeilen.forEach(function (z) {
      var k = erkenneKopf(z);
      if (k) { kopf = k; return; }
      var p = kopf || muster;
      var start = p ? zuMinuten(z[p.start]) : null;
      if (start == null) {
        var gefuellt = z.filter(Boolean);
        if (!titel && !roh.length && gefuellt.length === 1 && !/^quelle/i.test(gefuellt[0])) { titel = gefuellt[0]; }
        return;
      }
      function zelle(n) { return n == null ? "" : (z[n] || ""); }
      var dauer = p.dauer != null ? parseInt(zelle(p.dauer), 10) : NaN;
      var ende = p.ende != null ? zuMinuten(zelle(p.ende)) : null;
      if (!(dauer >= 0) && ende != null) { dauer = (ende - start + 1440) % 1440; }
      roh.push({ start: start, dauer: dauer, typ: zelle(p.typ), session: zelle(p.session), track: zelle(p.track), wer: zelle(p.wer) });
    });
    roh.sort(function (a, b) { return a.start - b.start; });
    /* Fehlende Dauer: bis zum nächsten Start */
    var abschnitte = [];
    roh.forEach(function (a, i) {
      if (!(a.dauer >= 0) && roh[i + 1]) { a.dauer = roh[i + 1].start - a.start; }
      if (!(a.dauer >= 0) || !(a.session || a.typ)) { unlesbar++; return; }
      abschnitte.push({ start: minutenText(a.start), dauer: a.dauer, typ: a.typ, session: a.session || a.typ, track: a.track, wer: a.wer });
    });
    var teile = titel.split(/\s+[·|]\s+/);
    return {
      titel: teile.length > 1 ? teile[0] : "",
      tag: teile.length > 1 ? teile.slice(1).join(" · ") : (titel || "Eigener Ablauf"),
      abschnitte: abschnitte,
      unlesbar: unlesbar
    };
  }

  var importVorschau = null;

  function pruefeImport() {
    var text = $("agenda-text").value;
    var info = $("agenda-vorschau");
    importVorschau = null;
    info.className = "hilfe";
    if (!text.trim()) { info.textContent = ""; $("agenda-ok").disabled = true; return; }
    var r = leseAblauf(text);
    var n = normalisiere(r);
    if (!n.abschnitte.length) {
      info.className = "hilfe fehler";
      info.textContent = "Keine Zeilen mit Uhrzeit erkannt. Bitte die Zeilen samt Spalte „Start“ kopieren.";
      $("agenda-ok").disabled = true;
      return;
    }
    importVorschau = r;
    var erst = n.abschnitte[0];
    var letzt = n.abschnitte[n.abschnitte.length - 1];
    info.className = "hilfe ok";
    info.textContent = n.abschnitte.length + " Abschnitte erkannt, " + minutenText(erst.start) + " bis " + minutenText(letzt.start + letzt.dauer) +
      (r.titel || r.tag !== "Eigener Ablauf" ? ". Titel: " + [r.titel, r.tag].filter(Boolean).join(" · ") : "") +
      (r.unlesbar ? ". " + r.unlesbar + " Zeile(n) ohne Dauer oder Titel übersprungen." : ".");
    $("agenda-ok").disabled = false;
  }

  function setzeAblauf(roh, alsEigen) {
    if (historie.length && !window.confirm("Die heutigen Änderungen am Plan werden dabei zurückgesetzt. Weiter?")) { return false; }
    eigenerAblauf = alsEigen ? { titel: roh.titel, tag: roh.tag, abschnitte: roh.abschnitte } : null;
    schreib(KEY.ablauf, eigenerAblauf);
    ablauf = normalisiere(alsEigen ? eigenerAblauf : window.AGENDA);
    ablaufKey = schluessel(ablauf);
    historie = [];
    speichereTag();
    ladeStumm();
    zeichneKopf();
    baueTicker();
    neuBerechnen();
    letzterTick = null;
    zeigeAblaufInfo();
    tick();
    return true;
  }

  function zeigeAblaufInfo() {
    var ab = ablauf.abschnitte;
    var text = ab.length
      ? "Aktuell: " + (ablauf.tag || ablauf.titel || "Ablauf") + ", " + ab.length + " Abschnitte, " + minutenText(ab[0].start) + " bis " +
        minutenText(ab[ab.length - 1].start + ab[ab.length - 1].dauer) + (eigenerAblauf ? " (eingefügt, nur auf diesem Gerät)." : " (Standard aus agenda.js).")
      : "Kein Ablauf hinterlegt.";
    setzeText($("agenda-info"), text);
    $("agenda-standard").hidden = !eigenerAblauf;
  }

  /* ---------- Einstellungen ---------- */

  function zeigeTonSchnell() {
    $("ton-schnell").setAttribute("aria-pressed", E.ton ? "true" : "false");
    setzeText($("ton-schnell-text"), E.ton ? "Ton an" : "Ton aus");
  }

  function oeffneEinst() {
    $("e-ton").checked = E.ton;
    var k = document.querySelector('input[name="e-klang"][value="' + E.klang + '"]');
    if (k) { k.checked = true; }
    $("e-laut").value = E.laut;
    $("e-vorwarnung").value = String(E.vorwarnung);
    $("e-wach").checked = E.wach;
    zeigeWachStatus();
    zeigeAblaufInfo();
    var erst = ablauf.abschnitte[0];
    if (!$("probe-zeit").value) { $("probe-zeit").value = erst ? minutenText(erst.start) : "12:00"; }
    if (probe) { $("probe-tempo").value = String(probe.tempo); }
    $("d-einst").showModal();
  }

  function verbindeEinst() {
    $("e-ton").addEventListener("change", function () { E.ton = this.checked; speichereEinst(); zeigeTonSchnell(); zeigeTonHinweis(); });
    document.querySelectorAll('input[name="e-klang"]').forEach(function (r) {
      r.addEventListener("change", function () { if (this.checked) { E.klang = this.value; speichereEinst(); entsperren(); spiele(E.klang); } });
    });
    $("e-laut").addEventListener("input", function () { E.laut = Number(this.value) || 80; speichereEinst(); });
    $("e-laut").addEventListener("change", function () { entsperren(); spiele("vorwarnung"); });
    $("e-anhoeren").addEventListener("click", function () { entsperren(); spiele(E.klang); vibriere([200, 100, 200]); });
    $("e-vorwarnung").addEventListener("change", function () { E.vorwarnung = Number(this.value) || 0; speichereEinst(); });
    $("e-wach").addEventListener("change", function () {
      E.wach = this.checked;
      speichereEinst();
      if (E.wach) { wachHalten(); } else { wachLoslassen(); }
    });
    $("agenda-text").addEventListener("input", pruefeImport);
    $("agenda-ok").addEventListener("click", function () {
      if (!importVorschau) { return; }
      if (setzeAblauf(importVorschau, true)) {
        $("agenda-text").value = "";
        pruefeImport();
        $("d-einst").close();
      }
    });
    $("agenda-standard").addEventListener("click", function () {
      if (setzeAblauf(null, false)) { $("d-einst").close(); }
    });
    $("probe-start").addEventListener("click", function () {
      var z = $("probe-zeit").value || "12:00";
      var tempo = $("probe-tempo").value || "1";
      window.location.href = "?zeit=" + encodeURIComponent(z.slice(0, 5)) + (tempo !== "1" ? "&tempo=" + tempo : "");
    });
    $("de-schliessen").addEventListener("click", function () { $("d-einst").close(); });
  }

  /* ---------- Groß-Ansicht ---------- */

  function fokus(an) {
    document.body.classList.toggle("fokus", an);
    $("fokus").setAttribute("aria-pressed", an ? "true" : "false");
    setzeText($("fokus-text"), an ? "Klein" : "Groß");
    var de = document.documentElement;
    try {
      if (an && de.requestFullscreen && !document.fullscreenElement) { de.requestFullscreen().catch(function () {}); }
      if (!an && document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(function () {}); }
    } catch (e) { /* Vollbild geht nicht überall (z. B. iPhone), die Groß-Ansicht trotzdem */ }
  }

  /* ---------- Start ---------- */

  function verbinde() {
    /* Ton entsperren: Browser zählen je nach Gerät unterschiedliche Ereignisse als Berührung */
    ["pointerdown", "pointerup", "touchend", "click", "keydown"].forEach(function (art) {
      document.addEventListener(art, function () { entsperren(); wachHalten(); }, true);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") { return; }
      if (!$("meldungen-pop").hidden) { schliesseMeldungen(); return; }
      if (document.body.classList.contains("fokus") && !document.fullscreenElement) { fokus(false); }
    });

    $("verlaengern").addEventListener("click", oeffneVerlaengern);
    $("einschub").addEventListener("click", oeffneEinschub);
    $("sync").addEventListener("click", oeffneSync);
    $("ton-schnell").addEventListener("click", function () {
      E.ton = !E.ton;
      speichereEinst();
      zeigeTonSchnell();
      zeigeTonHinweis();
    });
    $("ton-hinweis").addEventListener("click", function () { entsperren(); spiele("vorwarnung"); });
    $("fokus").addEventListener("click", function () { fokus(!document.body.classList.contains("fokus")); });
    document.addEventListener("fullscreenchange", function () {
      if (!document.fullscreenElement && document.body.classList.contains("fokus")) { fokus(false); }
    });
    $("einst-oeffnen").addEventListener("click", oeffneEinst);

    $("liste").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".glocke") : null;
      if (!b) {
        var zeile = e.target.closest ? e.target.closest("[data-plan]") : null;
        if (zeile) { oeffnePlan(zeile.getAttribute("data-plan")); }
        return;
      }
      var id = b.getAttribute("data-id");
      if (stumm[id]) { delete stumm[id]; } else { stumm[id] = true; }
      speichereStumm();
      version++;
      tick();
      var neu = $("liste").querySelector('.glocke[data-id="' + attrSicher(id) + '"]');
      if (neu) { neu.focus(); }
    });
    $("liste").addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.hasAttribute && e.target.hasAttribute("data-plan")) {
        e.preventDefault();
        oeffnePlan(e.target.getAttribute("data-plan"));
      }
    });
    $("dp-von").addEventListener("input", function () {
      var m = zuMinuten(this.value);
      if (!dp || m == null) { return; }
      var dauer = dp.bis - dp.von;
      dp.von = tag0 + m * MIN;
      dpSetzeEnde(dp.von + Math.max(0, dauer)); /* Start verschieben: Dauer bleibt, Ende wandert mit */
    });
    $("dp-bis").addEventListener("input", function () {
      var m = zuMinuten(this.value);
      if (dp && m != null) { dp.bis = tag0 + m * MIN; zeichnePlan(); }
    });
    $("dp-weg").addEventListener("click", function () { if (dp) { dpSetzeEnde(dp.von); } });
    $("dp-zurueck").addEventListener("click", function () { var x = dp && slotVon(dp.zielId); if (x) { dpSetzeEnde(dp.von + (x.a.dauer || 5) * MIN); } });
    $("dp-ok").addEventListener("click", dpUebernehmen);
    $("dp-abbrechen").addEventListener("click", function () { $("d-plan").close(); });
    $("d-plan").addEventListener("close", function () { dp = null; });
    $("aend-liste").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".aend-x") : null;
      if (!b) { return; }
      var h = historie[Number(b.getAttribute("data-n"))];
      if (h) { entferne(h); }
    });
    $("rueckgaengig").addEventListener("click", function () {
      if (historie.length) { entferne(historie[historie.length - 1]); }
    });
    $("alle-zurueck").addEventListener("click", function () {
      if (!historie.length || !window.confirm("Alle Änderungen von heute zurücksetzen? Dann gilt wieder der ursprüngliche Plan.")) { return; }
      historie = [];
      geaendert();
    });

    /* Dialog Verlängern / Einschub */
    $("dv-min").addEventListener("change", function (e) {
      if (!dv || e.target.name !== "dv-plus") { return; }
      dv.plus = Number(e.target.value);
      dvKuerzen();
      zeichneDv(true);
    });
    $("dv-welcher-opts").addEventListener("change", function (e) {
      if (!dv || e.target.name !== "dv-ziel") { return; }
      dv.zielId = e.target.value;
      zeichneDv(true);
    });
    $("dv-name").addEventListener("input", function () { if (dv) { dv.name = this.value; zeichneDv(false); } });
    $("dv-wann").addEventListener("change", function () { if (dv) { dv.wann = Number(this.value) || 0; zeichneDv(true); } });
    $("dv-liste").addEventListener("click", dvKlick);
    $("dv-ok").addEventListener("click", dvUebernehmen);
    $("dv-abbrechen").addEventListener("click", function () { $("d-verl").close(); });
    $("d-verl").addEventListener("close", function () { dv = null; });

    /* Dialog Ende festlegen */
    $("ende-knopf").addEventListener("click", oeffneEnde);
    $("dn-zeit").addEventListener("input", function () {
      var m = zuMinuten(this.value);
      if (dn && m != null) { dn.bis = tag0 + m * MIN; zeichneEnde(); }
    });
    $("dn-reihe").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("button[data-d]") : null;
      if (b && dn) { dnSetzeZeit(dn.bis + Number(b.getAttribute("data-d")) * MIN); }
    });
    $("dn-ok").addEventListener("click", dnUebernehmen);
    $("dn-abbrechen").addEventListener("click", function () { $("d-ende").close(); });
    $("d-ende").addEventListener("close", function () { dn = null; });

    /* Dialog Sync */
    $("ds-liste").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".sync-zeile") : null;
      if (b) { syncSetzen(b.getAttribute("data-id")); }
    });
    $("ds-abbrechen").addEventListener("click", function () { $("d-sync").close(); });

    /* Klick auf den dunklen Hintergrund schließt die Dialoge */
    ["d-verl", "d-einst", "d-sync", "d-ende", "d-plan"].forEach(function (id) {
      $(id).addEventListener("click", function (e) { if (e.target === this) { this.close(); } });
    });

    /* Sternchen: Erklärungen in Dialogen auf- und zuklappen */
    document.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".info-stern") : null;
      if (!b) { return; }
      var ziel = $(b.getAttribute("aria-controls"));
      if (!ziel) { return; }
      var auf = ziel.hidden;
      ziel.hidden = !auf;
      b.setAttribute("aria-expanded", auf ? "true" : "false");
    });

    /* Sternchen unten rechts: Hinweise lesen */
    $("stern-fab").addEventListener("click", function () {
      if ($("meldungen-pop").hidden) { oeffneMeldungen(); } else { schliesseMeldungen(); }
    });
    $("meldungen-zu").addEventListener("click", schliesseMeldungen);
    document.addEventListener("click", function (e) {
      if ($("meldungen-pop").hidden) { return; }
      if (!$("meldungen").contains(e.target)) { schliesseMeldungen(); }
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        if (ctx && ctx.state !== "running" && ctx.resume) { ctx.resume().catch(function () {}); }
        wachHalten();
        tick();
      }
    });

    verbindeEinst();
  }

  function start() {
    if (probe) {
      $("probe").hidden = false;
      $("probe-text").textContent = "Probelauf ab " + probe.text + (probe.tempo > 1 ? " · " + probe.tempo + "×" : "");
    }
    ladeTag();
    ladeStumm();
    zeichneKopf();
    baueTicker();
    zeigeTonSchnell();
    zeigeTonHinweis();
    neuBerechnen();
    verbinde();
    tick();
    wachHalten();
    window.setInterval(tick, probe && probe.tempo > 1 ? 100 : 250);
  }

  start();
})();
