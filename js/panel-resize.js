const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 700;
const STORAGE_KEY = 'canvasWebToolPanelWidth';

export function initPanelResize() {
  const panel = document.getElementById('sidePanel');
  const handle = document.getElementById('panelResizeHandle');

  let isResizing = false;

  function restorePanelWidth() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const w = parseFloat(saved);
        if (!Number.isNaN(w) && w >= MIN_PANEL_WIDTH && w <= MAX_PANEL_WIDTH) {
          panel.style.width = w + 'px';
        }
      }
    } catch {}
  }

  function savePanelWidth() {
    try {
      const w = parseFloat(panel.style.width);
      if (!Number.isNaN(w)) {
        localStorage.setItem(STORAGE_KEY, w);
      }
    } catch {}
  }

  function syncHandlePosition() {
    const panelRect = panel.getBoundingClientRect();
    handle.style.left = panelRect.left + 'px';
  }

  restorePanelWidth();
  syncHandlePosition();

  function onPointerDown(e) {
    if (e.button !== 0) return;
    isResizing = true;
    handle.classList.add('active');
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isResizing) return;
    const newWidth = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, window.innerWidth - e.clientX));
    panel.style.width = newWidth + 'px';
    handle.style.left = (window.innerWidth - newWidth) + 'px';
    window.dispatchEvent(new Event('resize'));
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (!isResizing) return;
    isResizing = false;
    handle.classList.remove('active');
    try { handle.releasePointerCapture(e.pointerId); } catch {}
    savePanelWidth();
  }

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);

  window.addEventListener('resize', syncHandlePosition);
}
