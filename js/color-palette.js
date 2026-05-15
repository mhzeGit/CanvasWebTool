import { getPalette } from './settings.js';

const BUILT_IN_COLORS = [
  '#ffffff', '#000000', '#888888',
  '#e74c3c', '#f39c12', '#f1c40f',
  '#2ecc71', '#3498db', '#9b59b6', '#2c3e50',
];

const WHEEL_SIZE = 140;

let popoverEl = null;
let activeSwatch = null;
let activeCallbacks = null;
let currentHSV = { h: 0, s: 0, v: 1 };

function getAllColors() {
  const custom = getPalette();
  return { builtin: BUILT_IN_COLORS, custom };
}

function hsvToRgb(h, s, v) {
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hsvToHex(h, s, v) {
  const [r, g, b] = hsvToRgb(h, s, v);
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function hexToHsv(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, v: 1 };
  let r = parseInt(m[1], 16) / 255;
  let g = parseInt(m[2], 16) / 255;
  let b = parseInt(m[3], 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, v = max;
  const d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max !== min) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h, s, v };
}

function drawColorWheel(canvas, hsv) {
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = Math.min(cx, cy) - 2;
  const radius2 = radius * radius;
  const edgeRadius2 = (radius + 1) * (radius + 1);

  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const data = imageData.data;

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > edgeRadius2) continue;
      const dist = Math.sqrt(dist2);
      let alpha = 255;
      if (dist > radius) {
        alpha = Math.round((1 - (dist - radius)) * 255);
      }
      const hue = (Math.atan2(dy, dx) / Math.PI / 2 + 1) % 1;
      const sat = Math.min(dist / radius, 1);
      const [r, g, b] = hsvToRgb(hue, sat, 1);
      const idx = (y * canvas.width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = alpha;
    }
  }
  ctx.putImageData(imageData, 0, 0);

  ctx.beginPath();
  ctx.arc(cx, cy, radius + 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const angle = hsv.h * Math.PI * 2;
  const pickR = hsv.s * radius;
  const pickX = cx + pickR * Math.cos(angle);
  const pickY = cy + pickR * Math.sin(angle);
  const dotR = 4;
  ctx.beginPath();
  ctx.arc(pickX, pickY, dotR, 0, Math.PI * 2);
  ctx.strokeStyle = hsv.v > 0.5 ? '#000' : '#fff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pickX, pickY, dotR - 1.5, 0, Math.PI * 2);
  ctx.strokeStyle = hsv.v > 0.5 ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function colorFromWheelPoint(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const radius = Math.min(cx, cy) - 2;
  if (dist > radius) return null;
  if (dist < 0.5) return { h: 0, s: 0 };
  const hue = (Math.atan2(dy, dx) / Math.PI / 2 + 1) % 1;
  const sat = Math.min(dist / radius, 1);
  return { h: hue, s: sat };
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
  const initHsv = hexToHsv(currentColor);

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

  html += '<div class="color-popover-divider"></div>';

  html += '<div class="color-popover-wheel-wrap">';
  html += '<canvas class="color-popover-wheel" id="colorPopoverWheel" width="' + WHEEL_SIZE + '" height="' + WHEEL_SIZE + '"></canvas>';
  html += '</div>';

  html += '<div class="color-popover-sliders">';

  html += '<div class="color-popover-slider-row">';
  html += '<span class="color-popover-slider-label">H</span>';
  html += '<div class="color-popover-slider" id="cpSliderH">';
  html += '<div class="color-popover-slider-track" id="cpSliderHTrack"></div>';
  html += '<div class="color-popover-slider-thumb" id="cpSliderHThumb"></div>';
  html += '</div>';
  html += '<span class="color-popover-slider-value" id="cpSliderHVal">' + Math.round(initHsv.h * 360) + '\u00B0</span>';
  html += '</div>';

  html += '<div class="color-popover-slider-row">';
  html += '<span class="color-popover-slider-label">S</span>';
  html += '<div class="color-popover-slider" id="cpSliderS">';
  html += '<div class="color-popover-slider-track" id="cpSliderSTrack"></div>';
  html += '<div class="color-popover-slider-thumb" id="cpSliderSThumb"></div>';
  html += '</div>';
  html += '<span class="color-popover-slider-value" id="cpSliderSVal">' + Math.round(initHsv.s * 100) + '%</span>';
  html += '</div>';

  html += '<div class="color-popover-slider-row">';
  html += '<span class="color-popover-slider-label">V</span>';
  html += '<div class="color-popover-slider" id="cpSliderV">';
  html += '<div class="color-popover-slider-track" id="cpSliderVTrack"></div>';
  html += '<div class="color-popover-slider-thumb" id="cpSliderVThumb"></div>';
  html += '</div>';
  html += '<span class="color-popover-slider-value" id="cpSliderVVal">' + Math.round(initHsv.v * 100) + '%</span>';
  html += '</div>';

  html += '</div>';

  html += '<div class="color-popover-preview" id="colorPopoverPreview">' + currentColor + '</div>';

  popoverEl.innerHTML = html;

  popoverEl.querySelectorAll('.color-popover-swatch').forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      applyHex(btn.dataset.color);
      hidePopover();
    });
  });

  currentHSV = { ...initHsv };
  const canvas = document.getElementById('colorPopoverWheel');
  if (canvas) {
    drawColorWheel(canvas, currentHSV);
    initWheel(canvas);
  }
  initSlider('H');
  initSlider('S');
  initSlider('V');
  updateAllSliders();
}

function initWheel(canvas) {
  let isDragging = false;

  function pickFromEvent(e) {
    const result = colorFromWheelPoint(canvas, e.clientX, e.clientY);
    if (!result) return;
    currentHSV.h = result.h;
    currentHSV.s = result.s;
    applyCurrentColor();
  }

  function onDown(e) {
    if (e.button !== 0) return;
    isDragging = true;
    canvas.setPointerCapture(e.pointerId);
    pickFromEvent(e);
  }

  function onMove(e) {
    if (!isDragging) return;
    pickFromEvent(e);
  }

  function onUp(e) {
    if (!isDragging) return;
    isDragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
}

function initSlider(component) {
  const track = document.getElementById('cpSlider' + component + 'Track');
  const thumb = document.getElementById('cpSlider' + component + 'Thumb');
  if (!track || !thumb) return;

  let isDragging = false;

  function fracFromEvent(e) {
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function applyFrac(frac) {
    const key = component.toLowerCase();
    currentHSV[key] = frac;
    applyCurrentColor();
  }

  function onDown(e) {
    if (e.button !== 0) return;
    isDragging = true;
    track.setPointerCapture(e.pointerId);
    applyFrac(fracFromEvent(e));
  }

  function onMove(e) {
    if (!isDragging) return;
    applyFrac(fracFromEvent(e));
  }

  function onUp(e) {
    if (!isDragging) return;
    isDragging = false;
    try { track.releasePointerCapture(e.pointerId); } catch {}
  }

  track.addEventListener('pointerdown', onDown);
  track.addEventListener('pointermove', onMove);
  track.addEventListener('pointerup', onUp);
  thumb.addEventListener('pointerdown', (e) => { e.stopPropagation(); onDown(e); });
}

function hueGradient() {
  const stops = [];
  for (let i = 0; i <= 6; i++) {
    const hex = hsvToHex(i / 6, 1, 1);
    stops.push(hex + ' ' + (i / 6 * 100) + '%');
  }
  return 'linear-gradient(to right, ' + stops.join(', ') + ')';
}

function satGradient() {
  return 'linear-gradient(to right, ' + hsvToHex(currentHSV.h, 0, 1) + ', ' + hsvToHex(currentHSV.h, 1, 1) + ')';
}

function valGradient() {
  return 'linear-gradient(to right, #000, ' + hsvToHex(currentHSV.h, currentHSV.s, 1) + ')';
}

function updateAllSliders() {
  const update = (comp, frac, valText) => {
    const t = document.getElementById('cpSlider' + comp + 'Track');
    const th = document.getElementById('cpSlider' + comp + 'Thumb');
    const v = document.getElementById('cpSlider' + comp + 'Val');
    if (t) t.style.background = comp === 'H' ? hueGradient() : comp === 'S' ? satGradient() : valGradient();
    if (th) th.style.left = (frac * 100) + '%';
    if (v) v.textContent = valText;
  };
  update('H', currentHSV.h, Math.round(currentHSV.h * 360) + '\u00B0');
  update('S', currentHSV.s, Math.round(currentHSV.s * 100) + '%');
  update('V', currentHSV.v, Math.round(currentHSV.v * 100) + '%');
}

function syncUI(hex) {
  if (activeSwatch) {
    activeSwatch.style.background = hex;
    activeSwatch.dataset.color = hex;
  }
  const preview = document.getElementById('colorPopoverPreview');
  if (preview) preview.textContent = hex;
  const canvas = document.getElementById('colorPopoverWheel');
  if (canvas) drawColorWheel(canvas, currentHSV);
  updateAllSliders();
  if (activeCallbacks && activeCallbacks.onSelect) {
    activeCallbacks.onSelect(hex);
  }
}

function applyCurrentColor() {
  syncUI(hsvToHex(currentHSV.h, currentHSV.s, currentHSV.v));
}

function applyHex(hex) {
  currentHSV = hexToHsv(hex);
  syncUI(hex);
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
    e.stopPropagation();
    e.preventDefault();
    if (onOpen) onOpen();
    showPopover(el, { onSelect, onClose });
  });
}
