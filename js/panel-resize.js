const MIN_PANEL_WIDTH = 220;
const MAX_PANEL_WIDTH = 700;

export function initPanelResize() {
  const panel = document.getElementById('sidePanel');
  const handle = document.getElementById('panelResizeHandle');

  let isResizing = false;

  function syncHandlePosition() {
    const panelRect = panel.getBoundingClientRect();
    handle.style.left = panelRect.left + 'px';
  }

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
  }

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);

  window.addEventListener('resize', syncHandlePosition);
}
