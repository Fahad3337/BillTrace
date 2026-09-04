'use strict';

// Confirm before submitting any form that carries a data-confirm message.
document.addEventListener('submit', function (event) {
  var form = event.target;
  var message = form.getAttribute && form.getAttribute('data-confirm');
  if (message && !window.confirm(message)) {
    event.preventDefault();
  }
});
