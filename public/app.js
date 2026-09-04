'use strict';

// Confirm before submitting any form that carries a data-confirm message.
document.addEventListener('submit', function (event) {
  var form = event.target;
  var message = form.getAttribute && form.getAttribute('data-confirm');
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});

// Show timestamps in the viewer's local timezone. Server stores/sends UTC ISO
// strings; without JS the element still shows the UTC text as a fallback.
(function () {
  var fmt;
  try {
    fmt = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch (e) {
    return;
  }
  var nodes = document.querySelectorAll('time.localtime[datetime]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var d = new Date(el.getAttribute('datetime'));
    if (isNaN(d.getTime())) continue;
    el.textContent = fmt.format(d);
    el.title = el.getAttribute('datetime');
  }
})();

// Auto-dismiss success flashes after a few seconds. Errors stay put so they can
// be read.
(function () {
  var alerts = document.querySelectorAll('.alert.ok');
  for (var i = 0; i < alerts.length; i++) {
    (function (el) {
      setTimeout(function () {
        el.style.transition = 'opacity .4s ease';
        el.style.opacity = '0';
        setTimeout(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        }, 450);
      }, 4000);
    })(alerts[i]);
  }
})();
