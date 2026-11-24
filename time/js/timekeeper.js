/* Timekeeper: Der Ablauf läuft nach der Uhr des Geräts. Die App zeigt, was
   gerade dran ist und wie lange es noch läuft, spielt am Ende eines Abschnitts
   auf Wunsch einen Ton und lässt einen Abschnitt um 1 bis 5 Minuten verlängern.
   Die Zeit kann bei späteren Abschnitten wieder weggenommen werden; alles
   dazwischen verschiebt sich, alles danach bleibt wie geplant.

   Der Ablauf steht in agenda.js. Diese Datei muss man dafür nicht anfassen.

   Zeitmodell: Jeder Abschnitt hat eine geplante Startzeit und eine Dauer.
   Er beginnt nie vor seiner Startzeit, aber später, wenn der vorige länger
   läuft (Verzug). Eine Lücke im Plan schluckt Verzug. Verlängern heißt
   Dauer + n, Wegnehmen heißt Dauer − n bei einem späteren Abschnitt. */
(function () {
  "use strict";

  var MIN = 60000;
  var KEY = {
    ablauf: "timekeeper.ablauf",
    tag: "timekeeper.tag",
    einst: "timekeeper.einstellungen",
    stumm: "timekeeper.stumm"
  };
  var FRISCH = 20000;        /* Ton nur, wenn das Ende höchstens 20 s (echte Zeit) her ist */
  var NACHLAUF = 10 * MIN;   /* So lange nach seinem Ende lässt sich ein Abschnitt noch verlängern */
  var MAX_PLUS = 5;
  var TYPEN = [
    [/coach/i, "coaches"], [/check|retro/i, "check"], [/input/i, "input"], [/aktion/i, "aktion"],
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

  var eigenerAblauf = lies(KEY.ablauf);
  var ablauf = normalisiere(eigenerAblauf && eigenerAblauf.abschnitte ? eigenerAblauf : window.AGENDA);
  if (!ablauf.abschnitte.length && eigenerAblauf) { eigenerAblauf = null; ablauf = normalisiere(window.AGENDA); }
  var ablaufKey = schluessel(ablauf);

  /* ---------- Einstellungen und Zustand ---------- */

  var E = { ton: true, klang: "glocke", laut: 80, vorwarnung: 0, wach: true, plus: 2 };
  (function () {
    var s = lies(KEY.einst) || {};
    Object.keys(E).forEach(function (k) { if (s[k] != null && typeof s[k] === typeof E[k]) { E[k] = s[k]; } });
  })();
  function speichereEinst() { schreib(KEY.einst, E); }

  var historie = [];  /* [{ zeit, id, plus, abzug: [[id, minuten], …] }] */
  var stumm = {};     /* id -> true: kein Ton am Ende dieses Abschnitts */
  var tag0 = tagBeginn(jetzt());
  var plan = [];
  var version = 0;

  function ladeTag() {
    historie = [];
    if (probe) { return; }
    var s = lies(KEY.tag);
    if (s && s.datum === datumText(jetzt()) && s.key === ablaufKey && Array.isArray(s.historie)) { historie = s.historie; }
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

  /* ---------- Zeitplan berechnen ---------- */

  function deltas(hist) {
    var d = {};
    hist.forEach(function (h) {
      d[h.id] = (d[h.id] || 0) + h.plus;
      h.abzug.forEach(function (a) { d[a[0]] = (d[a[0]] || 0) - a[1]; });
    });
    return d;
  }

  function berechne(hist) {
    var d = deltas(hist);
    var res = [];
    var vorPlanEnde = null;
    var vorVerzug = 0;
    ablauf.abschnitte.forEach(function (a, i) {
      var planStart = tag0 + a.start * MIN;
      var planEnde = planStart + a.dauer * MIN;
      var luecke = vorPlanEnde === null ? 0 : Math.max(0, planStart - vorPlanEnde);
      var verzug = Math.max(0, vorVerzug - luecke);
      var dauer = Math.max(0, a.dauer + (d[a.id] || 0));
      var start = planStart + verzug;
      var ende = start + dauer * MIN;
      res.push({ a: a, i: i, planStart: planStart, planEnde: planEnde, start: start, ende: ende, dauer: dauer });
      vorPlanEnde = planEnde;
      vorVerzug = ende - planEnde;
    });
    return res;
  }

  function neuBerechnen() {
    plan = berechne(historie);
    version++;
  }

  /* Wo stehen wir? laufend / naechster / letzter sind Indizes in plan (−1 = keiner) */
  function lage(p, t) {
    var lg = { laufend: -1, naechster: -1, letzter: -1, phase: "leer" };
    for (var i = 0; i < p.length; i++) {
      var x = p[i];
      if (x.dauer === 0) { continue; }
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
    for (var j = i + 1; j < plan.length; j++) { if (plan[j].dauer > 0) { return plan[j]; } }
    return null;
  }
  function indexVon(id) {
    for (var i = 0; i < plan.length; i++) { if (plan[i].a.id === id) { return i; } }
    return -1;
  }
  function titelVon(id) { var i = indexVon(id); return i >= 0 ? plan[i].a.titel : id; }
  function tagesende(p) {
    var e = null;
    var pe = null;
    p.forEach(function (x) { if (e === null || x.ende > e) { e = x.ende; } if (pe === null || x.planEnde > pe) { pe = x.planEnde; } });
    return { ende: e, plan: pe };
  }

  /* Welche Abschnitte lassen sich gerade verlängern? Der laufende und der, der eben zu Ende ging. */
  function kandidaten(lg, t) {
    var k = [];
    if (lg.laufend >= 0) { k.push({ i: lg.laufend, art: "jetzt" }); }
    if (lg.letzter >= 0 && lg.letzter !== lg.laufend && t - plan[lg.letzter].ende <= NACHLAUF) {
      k.push({ i: lg.letzter, art: "vorbei" });
    }
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

  /* ---------- Hinweise: Toast, Blitz, Ansage ---------- */

  var toastTimer = null;
  var toastUndo = null;

  function zeigeToast(text, undo, ms) {
    var t = $("toast");
    $("toast-text").textContent = text;
    toastUndo = undo || null;
    $("toast-undo").hidden = !undo;
    t.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(versteckeToast, ms || 7000);
  }
  function versteckeToast() { $("toast").hidden = true; toastUndo = null; }

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
      if (x.dauer === 0) { return; }
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
    var text = "Zeit ist um: " + zitat(x.a.titel) + ".";
    if (n) { text += n.start <= x.ende ? " Jetzt: " + zitat(n.a.titel) + "." : " Weiter um " + uhrzeit(n.start) + "."; }
    blitz();
    zeigeToast(text, null, 9000);
    ansagen(text);
    if (E.ton && !stumm[x.a.id]) {
      spiele(E.klang);
      vibriere([350, 150, 350, 150, 350]);
    }
  }

  function vorwarnen(x) {
    var text = "Noch " + minWort(E.vorwarnung) + ": " + zitat(x.a.titel) + ".";
    zeigeToast(text, null, 6000);
    ansagen(text);
    if (E.ton && !stumm[x.a.id]) { spiele("vorwarnung"); vibriere(200); }
  }

  /* ---------- Anzeige: Jetzt ---------- */

  var anzeige = { chipsFuer: null, laufendId: null };

  function baueChips(box, a, hell) {
    box.textContent = "";
    if (a.typ) {
      var k = typKlasse(a.typ);
      box.appendChild(el("span", "chip" + (k ? " chip-" + k : ""), a.typ));
    }
    if (hell && a.track) { box.appendChild(el("span", "chip chip-track", a.track)); }
  }

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
      status = "Jetzt";
      titel = x.a.titel;
      chipsFuer = x.a;
      cdLabel = "Noch";
      zahl = restText(rest);
      zeit = uhrzeit(x.start) + "–" + uhrzeit(x.ende) + " · " + x.dauer + " min";
      if (x.ende !== x.planEnde) {
        var d = Math.round((x.ende - x.planEnde) / MIN);
        zeitVerzug = (d > 0 ? "+" : "−") + Math.abs(d) + " min gegenüber Plan";
      }
      knapp = rest <= Math.max(1, E.vorwarnung) * MIN;
      danach = naechsterNach(lg.laufend);
      $("j-fuell").style.width = Math.min(100, Math.max(0, (t - x.start) / (x.ende - x.start) * 100)).toFixed(2) + "%";
      tabTitel = zahl + " · " + titel;
    } else if (lg.phase === "vorher" || lg.phase === "frei") {
      var n = plan[lg.naechster];
      status = lg.phase === "vorher" ? "Gleich geht’s los" : "Frei bis " + uhrzeit(n.start);
      titel = n.a.titel;
      chipsFuer = n.a;
      cdLabel = "Beginnt in";
      zahl = restText(n.start - t);
      zeit = lg.phase === "vorher"
        ? "Start um " + uhrzeit(n.start) + " · " + n.dauer + " min"
        : "Gerade vorbei: " + plan[lg.letzter].a.titel + " (bis " + uhrzeit(plan[lg.letzter].ende) + ")";
      danach = naechsterNach(lg.naechster);
      tabTitel = zahl + " bis " + titel;
    } else if (lg.phase === "fertig") {
      var te = tagesende(plan);
      status = "Geschafft";
      titel = "Der Tag ist durch.";
      zeit = "Letzter Abschnitt endete um " + uhrzeit(te.ende) + (te.ende !== te.plan ? " (geplant: " + uhrzeit(te.plan) + ")" : "") + ".";
    } else {
      status = "Kein Ablauf";
      titel = "Noch kein Ablauf hinterlegt";
      zeit = "Unter Einstellungen kannst du einen Ablauf aus Excel einfügen.";
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

    var chipsKey = chipsFuer ? chipsFuer.id : "";
    if (anzeige.chipsFuer !== chipsKey) {
      anzeige.chipsFuer = chipsKey;
      if (chipsFuer) { baueChips($("j-chips"), chipsFuer, true); } else { $("j-chips").textContent = ""; }
    }

    var box = $("danach");
    box.hidden = !danach;
    if (danach) {
      setzeText($("danach-label"), danach.start > (lg.phase === "laeuft" ? plan[lg.laufend].ende : plan[lg.naechster].ende) ? "Danach, nach einer Lücke" : "Danach");
      setzeText($("danach-titel"), danach.a.titel);
      setzeText($("danach-meta"), uhrzeit(danach.start) + "–" + uhrzeit(danach.ende) + " · " + danach.dauer + " min" + (danach.a.typ ? " · " + danach.a.typ : ""));
    }

    $("verlaengern").disabled = !kandidaten(lg, t).length;
    if (document.title !== tabTitel) { document.title = tabTitel; }

    /* Ansage, wenn ein neuer Abschnitt beginnt (nicht beim ersten Laden) */
    var laufendId = lg.laufend >= 0 ? plan[lg.laufend].a.id : "";
    if (anzeige.laufendId !== null && laufendId && laufendId !== anzeige.laufendId) {
      ansagen("Jetzt: " + plan[lg.laufend].a.titel + ", bis " + uhrzeit(plan[lg.laufend].ende) + ".");
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
    plan.forEach(function (x, i) {
      if (i > 0) {
        var frei = x.start - plan[i - 1].ende;
        if (frei >= MIN) {
          var lu = el("li", "luecke", Math.round(frei / MIN) + " min frei (" + uhrzeit(plan[i - 1].ende) + "–" + uhrzeit(x.start) + ")");
          ol.appendChild(lu);
        }
      }
      var zustand = x.dauer === 0 ? "entfaellt" : i === lg.laufend ? "laeuft" : x.ende <= t ? "vorbei" : "kommt";
      var li = el("li", "zeile " + zustand);
      if (zustand === "laeuft") { li.setAttribute("aria-current", "step"); }

      var zeit = el("div", "z-zeit");
      zeit.appendChild(el("span", "z-start", uhrzeit(x.start)));
      if (x.start !== x.planStart) {
        var alt = el("s", "z-alt", uhrzeit(x.planStart));
        alt.setAttribute("title", "geplant " + uhrzeit(x.planStart));
        zeit.appendChild(alt);
      }

      var inhalt = el("div", "z-inhalt");
      inhalt.appendChild(el("p", "z-titel", x.a.titel));
      var meta = el("p", "z-meta");
      if (x.a.typ) {
        var k = typKlasse(x.a.typ);
        meta.appendChild(el("span", "chip" + (k ? " chip-" + k : ""), x.a.typ));
      }
      var teile = [];
      if (x.a.track) { teile.push(x.a.track); }
      if (x.a.wer) { teile.push(x.a.wer); }
      teile.push(x.dauer === 0 ? "entfällt" : x.dauer + " min, bis " + uhrzeit(x.ende));
      meta.appendChild(el("span", "", teile.join(" · ")));
      var diff = x.dauer - x.a.dauer;
      if (diff) { meta.appendChild(el("span", "z-diff " + (diff > 0 ? "plus" : "minus"), (diff > 0 ? "+" : "−") + Math.abs(diff) + " min")); }
      inhalt.appendChild(meta);
      if (zustand === "laeuft") {
        var b = el("div", "z-balken");
        laufBalken = el("i");
        b.appendChild(laufBalken);
        inhalt.appendChild(b);
      }

      var glocke = el("button", "glocke");
      glocke.type = "button";
      glocke.setAttribute("data-id", x.a.id);
      glocke.setAttribute("aria-pressed", stumm[x.a.id] ? "false" : "true");
      glocke.setAttribute("aria-label", "Ton am Ende von " + zitat(x.a.titel));
      glocke.title = stumm[x.a.id] ? "Kein Ton am Ende" : "Ton am Ende";
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
      if (te.ende !== te.plan) {
        var d = Math.round((te.ende - te.plan) / MIN);
        ende.appendChild(document.createTextNode(" "));
        ende.appendChild(el("span", "verzug", "(" + (d > 0 ? "+" : "−") + Math.abs(d) + " min, Plan " + uhrzeit(te.plan) + ")"));
      }
    }
    zeichneAenderungen();
  }

  function zeichneAenderungen() {
    var ul = $("aend-liste");
    ul.textContent = "";
    $("aenderungen").hidden = !historie.length;
    historie.slice().reverse().forEach(function (h) {
      var text = uhrzeit(h.zeit) + " · " + zitat(titelVon(h.id)) + " +" + h.plus + " min";
      text += h.abzug.length
        ? " · weggenommen bei " + h.abzug.map(function (a) { return zitat(titelVon(a[0])) + " −" + a[1]; }).join(", ")
        : " · nirgends weggenommen";
      ul.appendChild(el("li", "", text));
    });
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
      /* Neuer Tag: gestrige Verlängerungen gelten nicht mehr */
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
    if (dv && $("d-verl").open && (t - dv.gezeichnet) > 1000) { zeichneDv(); }
  }

  /* ---------- Verlängern ---------- */

  var dv = null; /* { kandidaten, zielId, plus, abzug: {id: min}, reihenfolge: [id], gezeichnet } */

  function oeffneVerlaengern() {
    var t = jetzt();
    var lg = lage(plan, t);
    var k = kandidaten(lg, t);
    if (!k.length) { return; }
    dv = {
      kandidaten: k.map(function (c) { return { id: plan[c.i].a.id, art: c.art }; }),
      zielId: plan[k[0].i].a.id,
      plus: Math.min(MAX_PLUS, Math.max(1, E.plus || 2)),
      abzug: {},
      reihenfolge: [],
      gezeichnet: 0
    };
    var welcher = $("dv-welcher");
    var opts = $("dv-welcher-opts");
    opts.textContent = "";
    welcher.hidden = dv.kandidaten.length < 2;
    dv.kandidaten.forEach(function (c, n) {
      var x = plan[indexVon(c.id)];
      var inp = el("input");
      inp.type = "radio";
      inp.name = "dv-ziel";
      inp.id = "dv-ziel-" + n;
      inp.value = c.id;
      inp.checked = c.id === dv.zielId;
      var lab = el("label");
      lab.htmlFor = inp.id;
      lab.appendChild(el("span", "", x.a.titel));
      lab.appendChild(el("small", "", c.art === "jetzt" ? "läuft gerade, bis " + uhrzeit(x.ende) : "gerade vorbei, seit " + uhrzeit(x.ende)));
      opts.appendChild(inp);
      opts.appendChild(lab);
    });
    var radio = document.querySelector('input[name="dv-plus"][value="' + dv.plus + '"]');
    if (radio) { radio.checked = true; }
    zeichneDv();
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
    return {
      zeit: jetzt(),
      id: dv.zielId,
      plus: dv.plus,
      abzug: dv.reihenfolge.filter(function (id) { return dv.abzug[id] > 0; }).map(function (id) { return [id, dv.abzug[id]]; })
    };
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

  function zeichneDv() {
    var t = jetzt();
    dv.gezeichnet = t;
    var zi = indexVon(dv.zielId);
    if (zi < 0) { $("d-verl").close(); return; }
    var ziel = plan[zi];
    var neu = berechne(historie.concat([dvEintrag()]));
    var rest = dv.plus - dvSumme();

    setzeText($("dv-titel"), zitat(ziel.a.titel) + " verlängern");

    /* Fokus merken, weil die Liste neu gebaut wird */
    var aktiv = document.activeElement;
    var merkId = aktiv && aktiv.getAttribute ? aktiv.getAttribute("data-id") : null;
    var merkAktion = aktiv && aktiv.getAttribute ? aktiv.getAttribute("data-aktion") : null;

    var ul = $("dv-liste");
    ul.textContent = "";
    var spaeter = 0;
    for (var j = zi + 1; j < plan.length; j++) {
      var alt = plan[j];
      var nx = neu[j];
      var id = alt.a.id;
      var genommen = dv.abzug[id] || 0;
      var max = alt.dauer;
      spaeter++;

      var li = el("li", "dv-zeile" + (genommen ? " gewaehlt" : ""));
      var wahl = el("button", "dv-wahl");
      wahl.type = "button";
      wahl.setAttribute("data-id", id);
      wahl.setAttribute("data-aktion", "alles");
      wahl.disabled = max === 0;
      var zeit = el("span", "dv-zeit", uhrzeit(nx.start));
      var versatz = Math.round((nx.start - alt.start) / MIN);
      if (versatz) { zeit.appendChild(el("small", "", (versatz > 0 ? "+" : "−") + Math.abs(versatz) + " min")); }
      var text = el("span", "dv-text");
      text.appendChild(el("span", "dv-titel", alt.a.titel));
      var meta = el("span", "dv-meta");
      if (alt.a.typ) {
        var k = typKlasse(alt.a.typ);
        meta.appendChild(el("span", "chip" + (k ? " chip-" + k : ""), alt.a.typ));
      }
      if (genommen) {
        var wert = el("span", "nowrap", alt.dauer + " → ");
        wert.appendChild(el("strong", "", nx.dauer + " min"));
        meta.appendChild(wert);
      } else {
        meta.appendChild(document.createTextNode(alt.dauer === 0 ? "entfällt schon" : alt.dauer + " min"));
      }
      text.appendChild(meta);
      wahl.appendChild(zeit);
      wahl.appendChild(text);
      wahl.setAttribute("aria-label", alt.a.titel + ", " + alt.dauer + " min. Ganze Verlängerung hier wegnehmen.");

      var stepper = el("div", "stepper");
      var minus = el("button", "", "−");
      minus.type = "button";
      minus.setAttribute("data-id", id);
      minus.setAttribute("data-aktion", "minus");
      minus.setAttribute("aria-label", "Eine Minute weniger bei " + zitat(alt.a.titel) + " wegnehmen");
      minus.disabled = genommen === 0;
      var out = el("output", genommen ? "" : "null", genommen ? "−" + genommen : "0");
      out.setAttribute("aria-label", genommen + " min weggenommen");
      var plus = el("button", "", "+");
      plus.type = "button";
      plus.setAttribute("data-id", id);
      plus.setAttribute("data-aktion", "plus");
      plus.setAttribute("aria-label", "Eine Minute mehr bei " + zitat(alt.a.titel) + " wegnehmen");
      plus.disabled = rest <= 0 || genommen >= max;
      stepper.appendChild(minus);
      stepper.appendChild(out);
      stepper.appendChild(plus);

      li.appendChild(wahl);
      li.appendChild(stepper);
      ul.appendChild(li);
    }
    if (!spaeter) { ul.appendChild(el("li", "dv-zeile", "Danach kommt nichts mehr, der Tag endet einfach später.")); }

    if (merkId && merkAktion) {
      var wieder = ul.querySelector('[data-id="' + merkId.replace(/["\\]/g, "\\$&") + '"][data-aktion="' + merkAktion + '"]');
      if (wieder && !wieder.disabled) { wieder.focus(); }
      else if (wieder) { var w2 = ul.querySelector('[data-id="' + merkId.replace(/["\\]/g, "\\$&") + '"][data-aktion="alles"]'); if (w2) { w2.focus(); } }
    }

    zeichneFazit(zi, neu, rest);
    setzeText($("dv-ok"), "+" + dv.plus + " min übernehmen");
  }

  function zeichneFazit(zi, neu, rest) {
    var box = $("dv-fazit");
    var alt = plan;
    var saetze = [];
    saetze.push(zitat(alt[zi].a.titel) + " geht dann bis " + uhrzeit(neu[zi].ende) + " statt " + uhrzeit(alt[zi].ende) + ".");

    /* Ab welchem Abschnitt bleibt alles wie bisher? */
    var gleichAb = -1;
    for (var m = alt.length - 1; m > zi; m--) {
      if (neu[m].start === alt[m].start && neu[m].ende === alt[m].ende) { gleichAb = m; } else { break; }
    }
    if (gleichAb > zi) {
      saetze.push(gleichAb === zi + 1
        ? (neu[zi].ende > alt[zi].ende && neu[zi].ende <= alt[gleichAb].start
          ? "Die freie Zeit bis " + uhrzeit(alt[gleichAb].start) + " fängt das auf, alles danach bleibt wie bisher."
          : "Alles danach bleibt wie bisher.")
        : "Ab " + uhrzeit(alt[gleichAb].start) + " (" + zitat(alt[gleichAb].a.titel) + ") bleibt alles wie bisher.");
    } else if (alt.length) {
      var teAlt = tagesende(alt).ende;
      var teNeu = tagesende(neu).ende;
      if (teNeu !== teAlt) {
        saetze.push((rest > 0 && rest < dv.plus ? "Der Rest verschiebt alles danach. " : (zi < alt.length - 1 ? "Alles danach verschiebt sich. " : "")) +
          "Der Tag endet um " + uhrzeit(teNeu) + " statt " + uhrzeit(teAlt) + ".");
      }
    }

    /* Warnung: Minuten weggenommen, wo gar kein Verzug ankommt (Lücke fängt ihn schon auf) */
    var leer = [];
    dv.reihenfolge.forEach(function (id) {
      var j = indexVon(id);
      if (j < 0) { return; }
      var verschiebung = Math.round((neu[j].start - alt[j].start) / MIN);
      var genommen = dv.abzug[id] || 0;
      if (genommen > verschiebung) { leer.push(zitat(alt[j].a.titel) + " (" + (genommen - verschiebung) + " min)"); }
    });

    box.textContent = saetze.join(" ");
    if (leer.length) {
      box.appendChild(el("span", "warn", "Achtung: Eine Lücke im Plan fängt die Verlängerung schon auf. Bei " + leer.join(", ") + " entsteht dadurch freie Zeit."));
    }
  }

  function dvKlick(e) {
    var b = e.target.closest ? e.target.closest("button[data-aktion]") : null;
    if (!b || b.disabled || !dv) { return; }
    var id = b.getAttribute("data-id");
    var aktion = b.getAttribute("data-aktion");
    var j = indexVon(id);
    if (j < 0) { return; }
    var max = plan[j].dauer;
    var hatte = dv.abzug[id] || 0;
    if (aktion === "alles") {
      if (hatte && hatte === Math.min(dv.plus, max) && dv.reihenfolge.length === 1) {
        dv.abzug = {};                       /* Nochmal antippen: Auswahl aufheben */
      } else {
        dv.abzug = {};
        dv.abzug[id] = Math.min(dv.plus, max);
      }
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
    zeichneDv();
  }

  function dvUebernehmen() {
    if (!dv || indexVon(dv.zielId) < 0) { $("d-verl").close(); return; }
    var eintrag = dvEintrag();
    historie.push(eintrag);
    E.plus = dv.plus;
    speichereEinst();
    speichereTag();
    neuBerechnen();
    $("d-verl").close();
    tick();
    var text = zitat(titelVon(eintrag.id)) + " +" + eintrag.plus + " min";
    text += eintrag.abzug.length
      ? ", weggenommen bei " + eintrag.abzug.map(function (a) { return zitat(titelVon(a[0])) + " −" + a[1]; }).join(", ") + "."
      : ", alles danach verschiebt sich.";
    zeigeToast(text, function () { rueckgaengig(eintrag); }, 9000);
  }

  function rueckgaengig(eintrag) {
    var n = eintrag ? historie.indexOf(eintrag) : historie.length - 1;
    if (n < 0) { return; }
    historie.splice(n, 1);
    speichereTag();
    neuBerechnen();
    tick();
    zeigeToast("Rückgängig gemacht.", null, 3000);
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
    if (historie.length && !window.confirm("Die heutigen Verlängerungen werden dabei zurückgesetzt. Weiter?")) { return false; }
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
    var b = $("ton-schnell");
    b.setAttribute("aria-pressed", E.ton ? "true" : "false");
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
        zeigeToast("Neuer Ablauf übernommen.", null, 4000);
      }
    });
    $("agenda-standard").addEventListener("click", function () {
      if (setzeAblauf(null, false)) {
        $("d-einst").close();
        zeigeToast("Standard-Ablauf wiederhergestellt.", null, 4000);
      }
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
    document.addEventListener("pointerdown", function () { entsperren(); wachHalten(); }, true);
    document.addEventListener("keydown", function (e) {
      entsperren();
      wachHalten();
      if (e.key === "Escape" && document.body.classList.contains("fokus") && !document.fullscreenElement) { fokus(false); }
    }, true);

    $("verlaengern").addEventListener("click", oeffneVerlaengern);
    $("ton-schnell").addEventListener("click", function () {
      E.ton = !E.ton;
      speichereEinst();
      zeigeTonSchnell();
      zeigeTonHinweis();
      zeigeToast(E.ton ? "Ton an: Am Ende jedes Abschnitts kommt ein Signal." : "Ton aus.", null, 3000);
    });
    $("ton-hinweis").addEventListener("click", function () { entsperren(); spiele("vorwarnung"); });
    $("fokus").addEventListener("click", function () { fokus(!document.body.classList.contains("fokus")); });
    document.addEventListener("fullscreenchange", function () {
      if (!document.fullscreenElement && document.body.classList.contains("fokus")) { fokus(false); }
    });
    $("einst-oeffnen").addEventListener("click", oeffneEinst);

    $("liste").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(".glocke") : null;
      if (!b) { return; }
      var id = b.getAttribute("data-id");
      if (stumm[id]) { delete stumm[id]; } else { stumm[id] = true; }
      speichereStumm();
      version++;
      tick();
      var neu = $("liste").querySelector('.glocke[data-id="' + id.replace(/["\\]/g, "\\$&") + '"]');
      if (neu) { neu.focus(); }
    });
    $("rueckgaengig").addEventListener("click", function () { rueckgaengig(null); });
    $("alle-zurueck").addEventListener("click", function () {
      if (!historie.length || !window.confirm("Alle Verlängerungen von heute zurücksetzen? Dann gilt wieder der ursprüngliche Plan.")) { return; }
      historie = [];
      speichereTag();
      neuBerechnen();
      tick();
      zeigeToast("Zurück auf den ursprünglichen Plan.", null, 3000);
    });

    $("dv-min").addEventListener("change", function (e) {
      if (!dv || e.target.name !== "dv-plus") { return; }
      dv.plus = Number(e.target.value);
      dvKuerzen();
      zeichneDv();
    });
    $("dv-welcher-opts").addEventListener("change", function (e) {
      if (!dv || e.target.name !== "dv-ziel") { return; }
      dv.zielId = e.target.value;
      var zi = indexVon(dv.zielId);
      Object.keys(dv.abzug).forEach(function (id) { if (indexVon(id) <= zi) { delete dv.abzug[id]; } });
      dvAufraeumen();
      zeichneDv();
    });
    $("dv-liste").addEventListener("click", dvKlick);
    $("dv-ok").addEventListener("click", dvUebernehmen);
    $("dv-abbrechen").addEventListener("click", function () { $("d-verl").close(); });
    $("d-verl").addEventListener("close", function () { dv = null; });

    /* Klick auf den dunklen Hintergrund schließt die Dialoge */
    ["d-verl", "d-einst"].forEach(function (id) {
      $(id).addEventListener("click", function (e) { if (e.target === this) { this.close(); } });
    });

    $("toast-undo").addEventListener("click", function () {
      var f = toastUndo;
      versteckeToast();
      if (f) { f(); }
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
      $("probe-text").textContent = "Probelauf: Die Uhr startete bei " + probe.text +
        (probe.tempo > 1 ? " und läuft " + probe.tempo + "× schneller" : "") + ". Verlängerungen werden nicht gespeichert.";
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
