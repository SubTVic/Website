// Skizze: Der Strich wächst mit dem Scrollen (und schrumpft beim Zurückscrollen).
// Die Skizze bleibt dabei in der Bildschirmmitte stehen, bis der Strich fertig ist.
(function () {
  var fig = document.querySelector('[data-sketch]');
  var track = fig && fig.parentNode;
  if (!fig || !window.requestAnimationFrame) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Wie weit man scrollt, während die Skizze steht (Anteil der Fensterhöhe).
  var RUN = 0.75;
  // Über welchen Anteil des Strichs eine Beschriftung einblendet.
  var FADE = 0.06;

  var svgs = [].slice.call(fig.querySelectorAll('svg')).map(function (svg) {
    var path = svg.querySelector('.sk-line');
    return {
      svg: svg,
      path: path,
      len: path.getTotalLength(),
      tip: svg.querySelector('.sk-tip'),
      marks: [].slice.call(svg.querySelectorAll('[data-at]')).map(function (el) {
        return { el: el, at: parseFloat(el.getAttribute('data-at')) };
      })
    };
  });
  fig.classList.add('sk-scroll');

  var ticking = false;
  var vh, figH, inset, pin, top, run, lastW, lastH;
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // Misst die Skizze und verlängert die Spur, damit die Skizze anhalten kann.
  function layout() {
    lastW = window.innerWidth;
    lastH = vh = window.innerHeight;
    track.classList.remove('sk-pin');
    track.style.height = '';
    fig.style.top = '';
    figH = fig.offsetHeight;
    inset = track.offsetHeight - figH; // Rand und Abstand über der Skizze
    pin = figH + 32 <= vh; // nur anheften, wenn die Skizze ganz ins Fenster passt
    if (pin) {
      top = Math.max(16, Math.round((vh - figH) / 2));
      run = Math.round(vh * RUN);
      track.style.height = (inset + figH + run) + 'px';
      fig.style.top = top + 'px';
      track.classList.add('sk-pin');
    }
  }

  function update() {
    ticking = false;
    // Oberkante der Skizze, als würde sie normal mitscrollen.
    var y = track.getBoundingClientRect().top + inset;
    var start, end;
    if (pin) {
      // Start: drei Viertel der Skizze sind im Bild.
      // Ende: kurz bevor sie sich wieder löst, damit das fertige Bild noch steht.
      start = vh - figH * 0.75;
      end = top - run * 0.85;
    } else {
      start = vh * 0.85;
      end = vh * 0.45 - figH / 2;
    }
    var p = clamp((start - y) / (start - end));
    svgs.forEach(function (s) {
      if (!s.svg.getBoundingClientRect().width) return; // ausgeblendete Variante
      s.path.style.strokeDashoffset = (100 * (1 - p)).toFixed(2);
      s.path.style.visibility = p > 0 ? 'visible' : 'hidden';
      if (s.tip) {
        var pt = s.path.getPointAtLength(s.len * p);
        s.tip.setAttribute('cx', pt.x.toFixed(1));
        s.tip.setAttribute('cy', pt.y.toFixed(1));
        s.tip.style.opacity = p > 0.003 && p < 0.997 ? 1 : 0;
      }
      s.marks.forEach(function (m) {
        // Blendet ein, während der Strich die Stelle erreicht.
        var from = Math.max(0, m.at - FADE);
        var t = m.at > from ? clamp((p - from) / (m.at - from)) : (p > 0 ? 1 : 0);
        m.el.style.opacity = t.toFixed(3);
        if (m.el.classList.contains('sk-pill')) {
          m.el.style.transform = 'translateY(' + (8 * (1 - t)).toFixed(2) + 'px) scale(' + (0.92 + 0.08 * t).toFixed(3) + ')';
        }
      });
    });
  }
  function request() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
  }
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', function () {
    // Ein- und ausfahrende Browserleisten am Handy ändern nur die Höhe ein wenig:
    // dann nicht neu messen, sonst springt die Seite beim Scrollen.
    if (window.innerWidth !== lastW || Math.abs(window.innerHeight - lastH) > 160) layout();
    request();
  });
  window.addEventListener('load', function () { layout(); update(); });
  layout();
  update();
})();

// Kontaktformular: öffnet das E-Mail-Programm mit vorausgefüllter Anfrage.
// Die Zieladresse steht im Attribut data-to des Formulars in index.html.
(function () {
  var form = document.querySelector('.a-form');
  if (!form) return;
  var status = form.querySelector('.a-form-status');
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var name = form.elements.name.value.trim();
    var firma = form.elements.unternehmen.value.trim();
    var text = form.elements.nachricht.value.trim();
    if (!name || !text) {
      status.textContent = 'Bitte geben Sie Ihren Namen und Ihr Anliegen an.';
      (name ? form.elements.nachricht : form.elements.name).focus();
      return;
    }
    var to = (form.getAttribute('data-to') || '').trim();
    if (!to) {
      status.textContent = 'Das Kontaktformular wird gerade eingerichtet. Bitte versuchen Sie es in Kürze erneut.';
      return;
    }
    var subject = 'Gesprächsanfrage' + (firma ? ' von ' + firma : '');
    var body = text + '\n\n' + name + (firma ? '\n' + firma : '');
    window.location.href = 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    status.textContent = 'Ihr E-Mail-Programm öffnet sich mit der Anfrage. Sie müssen sie dort nur noch absenden.';
  });
})();
