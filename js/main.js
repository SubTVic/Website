// Skizze zeichnet sich, sobald sie ins Bild scrollt.
(function () {
  var sketch = document.querySelector('[data-sketch]');
  if (!sketch) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) return;
  sketch.classList.add('sk-armed');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        sketch.classList.add('sk-play');
        io.disconnect();
      }
    });
  }, { threshold: 0.35 });
  io.observe(sketch);
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
