import { getSettings, setTheme, setCustomColor, resetColor, resetAllSettings, getPalette, addPaletteColor, removePaletteColor } from './settings.js';

let overlay = null;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildDialog() {
  const s = getSettings();
  const theme = s.theme;
  const colors = s[theme];
  const otherTheme = theme === 'dark' ? 'light' : 'dark';

  const bgVal = colors.background || (theme === 'dark' ? '#101010' : '#e8e8e8');
  const gridVal = colors.gridLine || (theme === 'dark' ? '#191919' : '#c8c8c8');

  return '<div class="settings-overlay" id="settingsOverlay">' +
    '<div class="settings-dialog">' +
      '<div class="settings-header">Settings</div>' +

      '<div class="settings-section">' +
        '<div class="settings-section-title">Theme</div>' +
        '<div class="settings-row">' +
          '<label class="settings-toggle">' +
            '<input type="radio" name="settingsTheme" value="dark"' + (theme === 'dark' ? ' checked' : '') + '> Dark' +
          '</label>' +
          '<label class="settings-toggle">' +
            '<input type="radio" name="settingsTheme" value="light"' + (theme === 'light' ? ' checked' : '') + '> Light' +
          '</label>' +
        '</div>' +
      '</div>' +

      '<div class="settings-section">' +
        '<div class="settings-section-title">' + esc(theme === 'dark' ? 'Dark' : 'Light') + ' Theme Colors</div>' +
        '<div class="settings-row">' +
          '<label class="settings-label">Background</label>' +
          '<input type="color" id="settingsBgColor" class="settings-color" value="' + esc(bgVal) + '">' +
          '<button class="settings-reset-btn" id="settingsBgReset" title="Reset to default">&olarr;</button>' +
        '</div>' +
        '<div class="settings-row">' +
          '<label class="settings-label">Grid lines</label>' +
          '<input type="color" id="settingsGridColor" class="settings-color" value="' + esc(gridVal) + '">' +
          '<button class="settings-reset-btn" id="settingsGridReset" title="Reset to default">&olarr;</button>' +
        '</div>' +
      '</div>' +

      '<div class="settings-section">' +
        '<div class="settings-section-title">Color Palette</div>' +
        '<div class="settings-row" style="gap:4px;flex-wrap:wrap;" id="settingsPaletteColors">' +
          paletteSwatchesHTML() +
        '</div>' +
        '<div class="settings-row" style="margin-top:6px;gap:4px;">' +
          '<input type="text" id="settingsPaletteInput" class="settings-palette-input" placeholder="#ff6600" maxlength="7" />' +
          '<button class="dialog-btn dialog-btn-primary" id="settingsPaletteAdd">Add</button>' +
        '</div>' +
      '</div>' +

      '<div class="settings-footer">' +
        '<button class="dialog-btn dialog-btn-secondary" id="settingsResetAll">Reset all</button>' +
        '<button class="dialog-btn dialog-btn-primary" id="settingsClose">Close</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function paletteSwatchesHTML() {
  const palette = getPalette();
  if (palette.length === 0) return '<span class="settings-palette-empty">No custom colors yet</span>';
  return palette.map((c, i) =>
    '<span class="settings-palette-item">' +
      '<span class="settings-palette-swatch" style="background:' + c + '" title="' + c + '"></span>' +
      '<button class="settings-palette-remove" data-idx="' + i + '" title="Remove">&times;</button>' +
    '</span>'
  ).join('');
}

function hexOrFallback(hex) {
  return /^#[a-f\d]{6}$/i.test(hex) ? hex : null;
}

function wireDialog() {
  const themeRadios = document.querySelectorAll('input[name="settingsTheme"]');
  const bgInput = document.getElementById('settingsBgColor');
  const gridInput = document.getElementById('settingsGridColor');
  const bgReset = document.getElementById('settingsBgReset');
  const gridReset = document.getElementById('settingsGridReset');
  const resetAll = document.getElementById('settingsResetAll');
  const closeBtn = document.getElementById('settingsClose');

  const s = getSettings();

  if (themeRadios) {
    for (const radio of themeRadios) {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          setTheme(radio.value);
          refreshDialog();
        }
      });
    }
  }

  if (bgInput) {
    bgInput.addEventListener('input', () => {
      const v = bgInput.value;
      if (hexOrFallback(v)) {
        setCustomColor(s.theme, 'background', v);
      }
    });
  }

  if (gridInput) {
    gridInput.addEventListener('input', () => {
      const v = gridInput.value;
      if (hexOrFallback(v)) {
        setCustomColor(s.theme, 'gridLine', v);
      }
    });
  }

  if (bgReset) {
    bgReset.addEventListener('click', () => {
      resetColor(s.theme, 'background');
      refreshDialog();
    });
  }

  if (gridReset) {
    gridReset.addEventListener('click', () => {
      resetColor(s.theme, 'gridLine');
      refreshDialog();
    });
  }

  if (resetAll) {
    resetAll.addEventListener('click', () => {
      resetAllSettings();
      refreshDialog();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSettings);
  }

  const paletteInput = document.getElementById('settingsPaletteInput');
  const paletteAddBtn = document.getElementById('settingsPaletteAdd');
  if (paletteAddBtn && paletteInput) {
    const doAdd = () => {
      const v = paletteInput.value.trim();
      if (addPaletteColor(v)) {
        paletteInput.value = '';
        refreshDialog();
      } else {
        paletteInput.style.borderColor = '#e74c3c';
        setTimeout(() => { paletteInput.style.borderColor = ''; }, 800);
      }
    };
    paletteAddBtn.addEventListener('click', doAdd);
    paletteInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  }

  document.querySelectorAll('.settings-palette-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      const palette = getPalette();
      if (!Number.isNaN(idx) && idx >= 0 && idx < palette.length) {
        removePaletteColor(palette[idx]);
        refreshDialog();
      }
    });
  });
}

function refreshDialog() {
  if (!overlay || !overlay.parentNode) return;
  const parent = overlay.parentNode;
  overlay.remove();
  overlay.innerHTML = buildDialog();
  parent.appendChild(overlay);
  wireDialog();
}

export function openSettings() {
  if (overlay) {
    closeSettings();
    return;
  }

  overlay = document.createElement('div');
  overlay.innerHTML = buildDialog();
  document.body.appendChild(overlay.firstElementChild);
  overlay = document.getElementById('settingsOverlay');

  const s = getSettings();

  const onOverlayClick = (e) => {
    if (e.target && e.target.id === 'settingsOverlay') {
      closeSettings();
    }
  };
  overlay.addEventListener('pointerdown', onOverlayClick);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      closeSettings();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  overlay._cleanup = () => {
    overlay.removeEventListener('pointerdown', onOverlayClick);
    document.removeEventListener('keydown', onKeyDown);
  };

  wireDialog();
}

export function closeSettings() {
  if (overlay) {
    if (overlay._cleanup) overlay._cleanup();
    overlay.remove();
    overlay = null;
  }
}
