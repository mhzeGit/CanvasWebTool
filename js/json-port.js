import { state } from './state.js';
import { refreshSidePanel } from './side-panel.js';
import { destroyAllEntities } from './dom-entities.js';
import { history, flushPanelEdit } from './history.js';
import { showAlertDialog, showConfirmDialog } from './dialog.js';
import { fromPortable, isPortable, toPortable } from './portable-format.js';
import { requestRender } from './render-scheduler.js';

export { FORMAT, VERSION } from './portable-format.js';

/** The live document in the plain shape `portable-format` understands. */
export function getPlainDocument() {
  return {
    textBoxes: state.textBoxes,
    shapes: state.shapes,
    arrows: state.arrows,
    connectors: state.connectors,
    connections: state.connections,
    viewport: {
      offsetX: state.targetOffsetX,
      offsetY: state.targetOffsetY,
      scale: state.targetScale,
    },
  };
}

export function exportAsPortableJSON() {
  return toPortable(getPlainDocument());
}

function clearAllEntities() {
  flushPanelEdit();
  state.connections.length = 0;
  state.arrows.length = 0;
  state.shapes.length = 0;
  state.textBoxes.length = 0;
  state.connectors.length = 0;
  state.selectedTextBoxes.clear();
  state.selectedConnection = null;
  state.selectedArrows.clear();
  state.selectedShapes.clear();
  state.selectedConnectors.clear();
  state.arrowDragTarget = null;
  state.clipboard = [];
  state.connectingFrom = null;
  history.clear();
  state.panelPendingEdit = null;
  destroyAllEntities();
}

export function importFromPortableJSON(json) {
  if (!isPortable(json)) {
    throw new Error('Invalid portable document format');
  }

  const { document: doc, nextIds } = fromPortable(json);

  clearAllEntities();

  for (const textBox of doc.textBoxes) {
    state.textBoxes.push(textBox);
    state.parentTree.register('textBox', textBox.id, textBox);
  }
  for (const shape of doc.shapes) {
    state.shapes.push(shape);
    state.parentTree.register('shape', shape.id, shape);
  }
  state.arrows.push(...doc.arrows);
  state.connectors.push(...doc.connectors);
  state.connections.push(...doc.connections);

  state.nextTextBoxId = Math.max(state.nextTextBoxId, nextIds.textBox);
  state.nextShapeId = Math.max(state.nextShapeId, nextIds.shape);
  state.nextArrowId = Math.max(state.nextArrowId, nextIds.arrow);
  state.nextConnectorId = Math.max(state.nextConnectorId, nextIds.connector);
  state.nextConnectionId = Math.max(state.nextConnectionId, nextIds.connection);

  state.offsetX = state.targetOffsetX = doc.viewport.offsetX;
  state.offsetY = state.targetOffsetY = doc.viewport.offsetY;
  state.scale = state.targetScale = doc.viewport.scale;

  state.markDrawOrderDirty();
  state.reparentAll();
  state.isDirty = false;
  refreshSidePanel();
  requestRender();
}

export function downloadPortableJSON() {
  const jsonString = JSON.stringify(exportAsPortableJSON(), null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  link.download = `canvas-export-${timestamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function openPortableJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (state.isDirty) {
      const confirmed = await showConfirmDialog('This project has unsaved changes. Importing will replace the current document. Continue?');
      if (!confirmed) return;
    }
    try {
      importFromPortableJSON(JSON.parse(await file.text()));
    } catch (err) {
      console.error('Failed to import portable JSON:', err);
      showAlertDialog('Failed to import JSON file.\n\n' + (err.message || 'Unknown error'));
    }
  };
  input.click();
}
