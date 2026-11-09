'use strict';

(function () {
  const configured = window.NETFISCAL_SUPPORT_URL;
  if (!configured) return;
  let destination;
  try {
    destination = new URL(configured);
    if (destination.protocol !== 'https:') return;
  } catch (error) {
    return;
  }
  document.querySelectorAll('[data-support]').forEach(function (button) {
    button.disabled = false;
    button.removeAttribute('title');
    button.removeAttribute('aria-describedby');
    button.addEventListener('click', function () {
      window.open(destination.href, '_blank', 'noopener,noreferrer');
    });
  });
  document.querySelectorAll('[data-support-pending]').forEach(function (note) {
    note.hidden = true;
  });
})();
