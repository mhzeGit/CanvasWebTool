function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function isMobile() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function showAlertDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog-box';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.innerHTML = `
      <div class="dialog-icon">&#9888;</div>
      <div class="dialog-message">${escHtml(message)}</div>
      <div class="dialog-buttons">
        <button class="dialog-btn dialog-btn-primary" data-action="ok">OK</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const okBtn = dialog.querySelector('[data-action="ok"]');

    let resolved = false;

    function cleanup() {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        cleanup();
      }
    }

    okBtn.addEventListener('click', cleanup);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup();
    });
    document.addEventListener('keydown', onKeyDown);

    okBtn.focus();
  });
}

export { isMobile };

export function showConfirmDialog(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog-box';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');

    dialog.innerHTML = `
      <div class="dialog-icon">&#9888;</div>
      <div class="dialog-message">${escHtml(message)}</div>
      <div class="dialog-buttons">
        <button class="dialog-btn dialog-btn-secondary" data-action="no">No</button>
        <button class="dialog-btn dialog-btn-primary" data-action="yes">Yes</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const yesBtn = dialog.querySelector('[data-action="yes"]');
    const noBtn = dialog.querySelector('[data-action="no"]');

    let resolved = false;

    function cleanup(result) {
      if (resolved) return;
      resolved = true;
      document.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      resolve(result);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(false);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const focusable = [noBtn, yesBtn];
        const currentIndex = focusable.indexOf(document.activeElement);
        if (e.shiftKey) {
          const prev = (currentIndex - 1 + focusable.length) % focusable.length;
          focusable[prev].focus();
        } else {
          const next = (currentIndex + 1) % focusable.length;
          focusable[next].focus();
        }
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (document.activeElement === yesBtn) cleanup(true);
        else cleanup(false);
      }
    }

    noBtn.addEventListener('click', () => cleanup(false));
    yesBtn.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });
    document.addEventListener('keydown', onKeyDown);

    noBtn.focus();
  });
}
