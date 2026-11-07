// Skizze: Der Strich wächst mit dem Scrollen (und schrumpft beim Zurückscrollen).
(function () {
  var fig = document.querySelector('[data-sketch]');
  if (!fig || !window.requestAnimationFrame) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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
  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function update() {
    ticking = false;
    var vh = window.innerHeight;
    var r = fig.getBoundingClientRect();
    // Start: Oberkante der Skizze bei 85 % der Fensterhöhe.
    // Ende: Mitte der Skizze bei 45 % der Fensterhöhe.
    var start = vh * 0.85;
    var end = vh * 0.45 - r.height / 2;
    var p = clamp((start - r.top) / (start - end));
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
        m.el.classList.toggle('on', p >= m.at - 0.001);
      });
    });
  }
  function request() {
    if (!ticking) { ticking = true; window.requestAnimationFrame(update); }
  }
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
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
