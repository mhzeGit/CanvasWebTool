import { getPalette, addPaletteColor, removePaletteColor } from './settings.js';

const BUILT_IN_COLORS = [
  '#ffffff', '#000000', '#888888',
  '#e74c3c', '#f39c12', '#f1c40f',
  '#2ecc71', '#3498db', '#9b59b6', '#2c3e50',
];

let popoverEl = null;
let activeSwatch = null;
let activeCallbacks = null;

function getAllColors() {
  const custom = getPalette();
  return { builtin: BUILT_IN_COLORS, custom };
}

function createPopover() {
  if (popoverEl) return;
  popoverEl = document.createElement('div');
  popoverEl.className = 'color-popover';
  popoverEl.style.display = 'none';
  document.body.appendChild(popoverEl);

  popoverEl.addEventListener('pointerdown', (e) => e.stopPropagation());
}

function renderPopover() {
  if (!popoverEl || !activeSwatch) return;
  const { builtin, custom } = getAllColors();
  const currentColor = activeSwatch.dataset.color || '#000000';

  let html = '<div class="color-popover-grid">';
  for (const c of builtin) {
    html += '<button type="button" class="color-popover-swatch' + (c === currentColor ? ' active' : '') + '" style="background:' + c + '" data-color="' + c + '" title="' + c + '"></button>';
  }
  if (custom.length > 0) {
    html += '<div class="color-popover-divider"></div>';
    for (const c of custom) {
      html += '<button type="button" class="color-popover-swatch' + (c === currentColor ? ' active' : '') + '" style="background:' + c + '" data-color="' + c + '" title="' + c + '"></button>';
    }
  }
  html += '</div>';
  html += '<div class="color-popover-footer"><button type="button" class="color-popover-custom" id="colorPopoverCustom">Custom...</button></div>';

  popoverEl.innerHTML = html;

  popoverEl.querySelectorAll('.color-popover-swatch').forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const color = btn.dataset.color;
      selectColor(color);
    });
  });

  const customBtn = document.getElementById('colorPopoverCustom');
  if (customBtn) {
    customBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      openNativePicker();
    });
  }
}

function positionPopover() {
  if (!popoverEl || !activeSwatch) return;
  const swatchRect = activeSwatch.getBoundingClientRect();
  const popoverRect = popoverEl.getBoundingClientRect();
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let left = swatchRect.left;
  let top = swatchRect.bottom + 4;

  if (left + popoverRect.width > viewportW - 8) {
    left = viewportW - popoverRect.width - 8;
  }
  if (top + popoverRect.height > viewportH - 8) {
    top = swatchRect.top - popoverRect.height - 4;
  }
  if (left < 8) left = 8;

  popoverEl.style.left = left + 'px';
  popoverEl.style.top = top + 'px';
}

function showPopover(swatchEl, callbacks) {
  createPopover();
  activeSwatch = swatchEl;
  activeCallbacks = callbacks;
  renderPopover();
  popoverEl.style.display = '';
  positionPopover();
}

function hidePopover() {
  if (!popoverEl) return;
  popoverEl.style.display = 'none';
  if (activeCallbacks && activeCallbacks.onClose) {
    activeCallbacks.onClose();
  }
  activeSwatch = null;
  activeCallbacks = null;
}

function selectColor(color) {
  if (activeSwatch) {
    activeSwatch.style.background = color;
    activeSwatch.dataset.color = color;
  }
  if (activeCallbacks && activeCallbacks.onSelect) {
    activeCallbacks.onSelect(color);
  }
  hidePopover();
}

function openNativePicker() {
  const input = document.createElement('input');
  input.type = 'color';
  input.value = activeSwatch ? (activeSwatch.dataset.color || '#000000') : '#000000';
  input.addEventListener('input', () => {
    selectColor(input.value);
  });
  input.click();
}

document.addEventListener('pointerdown', (e) => {
  if (popoverEl && popoverEl.style.display !== 'none') {
    if (!popoverEl.contains(e.target)) {
      hidePopover();
    }
  }
});

window.addEventListener('resize', () => {
  if (popoverEl && popoverEl.style.display !== 'none') {
    positionPopover();
  }
});

export function colorSwatchHTML(id, color) {
  return '<button type="button" class="panel-color-swatch" id="' + id + '" style="background:' + color + '" data-color="' + color + '"></button>';
}

export function initColorSwatch(el, { onSelect, onOpen, onClose }) {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (onOpen) onOpen();
    showPopover(el, { onSelect, onClose });
  });
}
