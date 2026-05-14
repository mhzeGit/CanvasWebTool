import { state } from './state.js';

let _nextId = 1;
export function nextNodeId() { return _nextId++; }
export function initNodeId(v) { _nextId = v; }

function findNodeById(nodes, id) {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) return { node: nodes[i], index: i };
  }
  return null;
}

export function createHistoryManager() {
  let undoStack = [];
  let redoStack = [];
  const MAX_SIZE = 200;
  let isUndoRedoing = false;

  return {
    push(cmd) {
      if (isUndoRedoing) return;
      undoStack.push(cmd);
      if (undoStack.length > MAX_SIZE) undoStack.shift();
      redoStack = [];
      state.isDirty = true;
    },

    undo() {
      if (undoStack.length === 0) return false;
      isUndoRedoing = true;
      const cmd = undoStack.pop();
      cmd.undo();
      redoStack.push(cmd);
      isUndoRedoing = false;
      state.isDirty = true;
      return true;
    },

    redo() {
      if (redoStack.length === 0) return false;
      isUndoRedoing = true;
      const cmd = redoStack.pop();
      cmd.redo();
      undoStack.push(cmd);
      isUndoRedoing = false;
      state.isDirty = true;
      return true;
    },

    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },

    clear() {
      undoStack = [];
      redoStack = [];
    }
  };
}

export function createAddNodeCmd(nodes, selected, refreshPanelFn, node, insertedAt) {
  const nodeId = node.id;
  return {
    undo() {
      const found = findNodeById(nodes, nodeId);
      if (found) nodes.splice(found.index, 1);
      selected.clear();
      refreshPanelFn();
    },
    redo() {
      nodes.splice(insertedAt, 0, node);
      selected.clear();
      selected.add(insertedAt);
      refreshPanelFn();
    },
    description: 'Add Node'
  };
}

export function createDeleteNodesCmd(nodes, selected, refreshPanelFn, deletedEntries) {
  return {
    undo() {
      for (let i = 0; i < deletedEntries.length; i++) {
        nodes.splice(deletedEntries[i].index, 0, deletedEntries[i].node);
      }
      selected.clear();
      for (const entry of deletedEntries) selected.add(entry.index);
      refreshPanelFn();
    },
    redo() {
      const ids = new Set(deletedEntries.map(e => e.node.id));
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (ids.has(nodes[i].id)) nodes.splice(i, 1);
      }
      selected.clear();
      refreshPanelFn();
    },
    description: deletedEntries.length === 1 ? 'Delete Node' : `Delete ${deletedEntries.length} Nodes`
  };
}

export function createMoveNodesCmd(nodes, selected, refreshPanelFn, moves) {
  return {
    undo() {
      for (const m of moves) {
        const found = findNodeById(nodes, m.id);
        if (found) { found.node.x = m.fromX; found.node.y = m.fromY; }
      }
      refreshPanelFn();
    },
    redo() {
      for (const m of moves) {
        const found = findNodeById(nodes, m.id);
        if (found) { found.node.x = m.toX; found.node.y = m.toY; }
      }
      refreshPanelFn();
    },
    description: moves.length === 1 ? 'Move Node' : `Move ${moves.length} Nodes`
  };
}

export function createResizeNodeCmd(nodes, selected, refreshPanelFn, nodeId, fromBounds, toBounds) {
  return {
    undo() {
      const found = findNodeById(nodes, nodeId);
      if (found) {
        found.node.x = fromBounds.x;
        found.node.y = fromBounds.y;
        found.node.w = fromBounds.w;
        found.node.h = fromBounds.h;
      }
      refreshPanelFn();
    },
    redo() {
      const found = findNodeById(nodes, nodeId);
      if (found) {
        found.node.x = toBounds.x;
        found.node.y = toBounds.y;
        found.node.w = toBounds.w;
        found.node.h = toBounds.h;
      }
      refreshPanelFn();
    },
    description: 'Resize Node'
  };
}

export function createPropertyChangeCmd(nodes, selected, refreshPanelFn, nodeId, property, oldValue, newValue) {
  const label = property === 'title' ? 'Change Title'
    : property === 'titleColor' ? 'Change Title Color'
    : property === 'color' ? 'Change Color'
    : property === 'w' ? 'Change Width'
    : property === 'h' ? 'Change Height'
    : property === 'text' ? 'Change Text'
    : `Change ${property}`;

  return {
    undo() {
      const found = findNodeById(nodes, nodeId);
      if (found) found.node[property] = oldValue;
      refreshPanelFn();
    },
    redo() {
      const found = findNodeById(nodes, nodeId);
      if (found) found.node[property] = newValue;
      refreshPanelFn();
    },
    description: label
  };
}

export function createPasteNodesCmd(nodes, selected, refreshPanelFn, pastedNodes) {
  return {
    undo() {
      const ids = new Set(pastedNodes.map(e => e.node.id));
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (ids.has(nodes[i].id)) nodes.splice(i, 1);
      }
      selected.clear();
      refreshPanelFn();
    },
    redo() {
      for (let i = 0; i < pastedNodes.length; i++) {
        nodes.splice(pastedNodes[i].index, 0, pastedNodes[i].node);
      }
      selected.clear();
      for (const entry of pastedNodes) selected.add(entry.index);
      refreshPanelFn();
    },
    description: pastedNodes.length === 1 ? 'Paste Node' : `Paste ${pastedNodes.length} Nodes`
  };
}

export function createDuplicateNodesCmd(nodes, selected, refreshPanelFn, entries) {
  return {
    undo() {
      const ids = new Set(entries.map(e => e.node.id));
      for (let i = nodes.length - 1; i >= 0; i--) {
        if (ids.has(nodes[i].id)) nodes.splice(i, 1);
      }
      selected.clear();
      refreshPanelFn();
    },
    redo() {
      for (let i = 0; i < entries.length; i++) {
        nodes.splice(entries[i].index, 0, entries[i].node);
      }
      selected.clear();
      for (const entry of entries) selected.add(entry.index);
      refreshPanelFn();
    },
    description: entries.length === 1 ? 'Duplicate Node' : `Duplicate ${entries.length} Nodes`
  };
}

export function createMoveArrowEndCmd(arrows, arrowIdx, fromState, toState) {
  return {
    undo() {
      const arrow = arrows[arrowIdx];
      if (!arrow) return;
      Object.assign(arrow, fromState);
    },
    redo() {
      const arrow = arrows[arrowIdx];
      if (!arrow) return;
      Object.assign(arrow, toState);
    },
    description: 'Move Arrow Point'
  };
}

export function createAddShapeCmd(shapes, selectedShapes, refreshPanelFn, shape, insertedAt) {
  const shapeId = shape.id;
  return {
    undo() {
      const idx = shapes.findIndex(s => s.id === shapeId);
      if (idx !== -1) shapes.splice(idx, 1);
      selectedShapes.clear();
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      shapes.splice(insertedAt, 0, shape);
      selectedShapes.clear();
      selectedShapes.add(insertedAt);
      if (refreshPanelFn) refreshPanelFn();
    },
    description: 'Add Shape'
  };
}

export function createDeleteShapesCmd(shapes, selectedShapes, refreshPanelFn, deletedEntries) {
  return {
    undo() {
      for (let i = 0; i < deletedEntries.length; i++) {
        shapes.splice(deletedEntries[i].index, 0, deletedEntries[i].shape);
      }
      selectedShapes.clear();
      for (const entry of deletedEntries) selectedShapes.add(entry.index);
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const ids = new Set(deletedEntries.map(e => e.shape.id));
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (ids.has(shapes[i].id)) shapes.splice(i, 1);
      }
      selectedShapes.clear();
      if (refreshPanelFn) refreshPanelFn();
    },
    description: deletedEntries.length === 1 ? 'Delete Shape' : `Delete ${deletedEntries.length} Shapes`
  };
}

export function createMoveShapesCmd(shapes, selectedShapes, refreshPanelFn, moves) {
  return {
    undo() {
      for (const m of moves) {
        const found = shapes.find(s => s.id === m.id);
        if (found) { found.x = m.fromX; found.y = m.fromY; }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      for (const m of moves) {
        const found = shapes.find(s => s.id === m.id);
        if (found) { found.x = m.toX; found.y = m.toY; }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: moves.length === 1 ? 'Move Shape' : `Move ${moves.length} Shapes`
  };
}

export function createResizeShapeCmd(shapes, selectedShapes, refreshPanelFn, shapeId, fromBounds, toBounds) {
  return {
    undo() {
      const found = shapes.find(s => s.id === shapeId);
      if (found) {
        found.x = fromBounds.x; found.y = fromBounds.y;
        found.w = fromBounds.w; found.h = fromBounds.h;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const found = shapes.find(s => s.id === shapeId);
      if (found) {
        found.x = toBounds.x; found.y = toBounds.y;
        found.w = toBounds.w; found.h = toBounds.h;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: 'Resize Shape'
  };
}

export function createResizeTextBoxCmd(textBoxes, selectedTextBoxes, refreshPanelFn, tbId, fromBounds, toBounds) {
  return {
    undo() {
      const found = textBoxes.find(t => t.id === tbId);
      if (found) {
        found.x = fromBounds.x; found.y = fromBounds.y;
        found.w = fromBounds.w; found.h = fromBounds.h;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const found = textBoxes.find(t => t.id === tbId);
      if (found) {
        found.x = toBounds.x; found.y = toBounds.y;
        found.w = toBounds.w; found.h = toBounds.h;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: 'Resize Text Box'
  };
}

export function createShapePropertyChangeCmd(shapes, selectedShapes, refreshPanelFn, shapeId, property, oldValue, newValue) {
  return {
    undo() {
      const found = shapes.find(s => s.id === shapeId);
      if (found) found[property] = oldValue;
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const found = shapes.find(s => s.id === shapeId);
      if (found) found[property] = newValue;
      if (refreshPanelFn) refreshPanelFn();
    },
    description: `Change Shape ${property}`
  };
}

export function createAddTextBoxCmd(textBoxes, selectedTextBoxes, refreshPanelFn, textBox, insertedAt) {
  const tbId = textBox.id;
  return {
    undo() {
      const idx = textBoxes.findIndex(t => t.id === tbId);
      if (idx !== -1) textBoxes.splice(idx, 1);
      selectedTextBoxes.clear();
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      textBoxes.splice(insertedAt, 0, textBox);
      selectedTextBoxes.clear();
      selectedTextBoxes.add(insertedAt);
      if (refreshPanelFn) refreshPanelFn();
    },
    description: 'Add Text Box'
  };
}

export function createDeleteTextBoxesCmd(textBoxes, selectedTextBoxes, refreshPanelFn, deletedEntries) {
  return {
    undo() {
      for (let i = 0; i < deletedEntries.length; i++) {
        textBoxes.splice(deletedEntries[i].index, 0, deletedEntries[i].textBox);
      }
      selectedTextBoxes.clear();
      for (const entry of deletedEntries) selectedTextBoxes.add(entry.index);
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const ids = new Set(deletedEntries.map(e => e.textBox.id));
      for (let i = textBoxes.length - 1; i >= 0; i--) {
        if (ids.has(textBoxes[i].id)) textBoxes.splice(i, 1);
      }
      selectedTextBoxes.clear();
      if (refreshPanelFn) refreshPanelFn();
    },
    description: deletedEntries.length === 1 ? 'Delete Text Box' : `Delete ${deletedEntries.length} Text Boxes`
  };
}

export function createMoveTextBoxesCmd(textBoxes, selectedTextBoxes, refreshPanelFn, moves) {
  return {
    undo() {
      for (const m of moves) {
        const found = textBoxes.find(t => t.id === m.id);
        if (found) { found.x = m.fromX; found.y = m.fromY; }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      for (const m of moves) {
        const found = textBoxes.find(t => t.id === m.id);
        if (found) { found.x = m.toX; found.y = m.toY; }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: moves.length === 1 ? 'Move Text Box' : `Move ${moves.length} Text Boxes`
  };
}

export function createAddConnectorCmd(connectors, selectedConnectors, refreshPanelFn, connector, insertedAt) {
  const connId = connector.id;
  return {
    undo() {
      const idx = connectors.findIndex(c => c.id === connId);
      if (idx !== -1) connectors.splice(idx, 1);
      selectedConnectors.clear();
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      connectors.splice(insertedAt, 0, connector);
      selectedConnectors.clear();
      selectedConnectors.add(insertedAt);
      if (refreshPanelFn) refreshPanelFn();
    },
    description: 'Add Connector'
  };
}

export function createDeleteConnectorsCmd(connectors, selectedConnectors, refreshPanelFn, deletedEntries) {
  return {
    undo() {
      for (let i = 0; i < deletedEntries.length; i++) {
        connectors.splice(deletedEntries[i].index, 0, deletedEntries[i].connector);
      }
      selectedConnectors.clear();
      for (const entry of deletedEntries) selectedConnectors.add(entry.index);
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const ids = new Set(deletedEntries.map(e => e.connector.id));
      for (let i = connectors.length - 1; i >= 0; i--) {
        if (ids.has(connectors[i].id)) connectors.splice(i, 1);
      }
      selectedConnectors.clear();
      if (refreshPanelFn) refreshPanelFn();
    },
    description: deletedEntries.length === 1 ? 'Delete Connector' : `Delete ${deletedEntries.length} Connectors`
  };
}

export function createAddArrowCmd(arrows, selectedArrows, refreshPanelFn, arrow, insertedAt) {
  const arrowId = arrow.id;
  return {
    undo() {
      const idx = arrows.findIndex(a => a.id === arrowId);
      if (idx !== -1) arrows.splice(idx, 1);
      selectedArrows.clear();
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      arrows.splice(insertedAt, 0, arrow);
      selectedArrows.clear();
      selectedArrows.add(insertedAt);
      if (refreshPanelFn) refreshPanelFn();
    },
    description: 'Add Arrow'
  };
}

export function createDeleteArrowsCmd(arrows, selectedArrows, refreshPanelFn, deletedEntries) {
  return {
    undo() {
      for (let i = 0; i < deletedEntries.length; i++) {
        arrows.splice(deletedEntries[i].index, 0, deletedEntries[i].arrow);
      }
      selectedArrows.clear();
      for (const entry of deletedEntries) selectedArrows.add(entry.index);
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const ids = new Set(deletedEntries.map(e => e.arrow.id));
      for (let i = arrows.length - 1; i >= 0; i--) {
        if (ids.has(arrows[i].id)) arrows.splice(i, 1);
      }
      selectedArrows.clear();
      if (refreshPanelFn) refreshPanelFn();
    },
    description: deletedEntries.length === 1 ? 'Delete Arrow' : `Delete ${deletedEntries.length} Arrows`
  };
}

export function createAddConnectionCmd(connections, selectedConnection, refreshPanelFn, connection) {
  const connId = connection.id;
  return {
    undo() {
      const idx = connections.findIndex(c => c.id === connId);
      if (idx !== -1) connections.splice(idx, 1);
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      connections.push(connection);
      if (refreshPanelFn) refreshPanelFn();
    },
    description: 'Add Connection'
  };
}

export function createDeleteConnectionCmd(connections, selectedConnection, refreshPanelFn, deletedConnection, deletedIndex) {
  const connId = deletedConnection.id;
  return {
    undo() {
      connections.splice(deletedIndex, 0, deletedConnection);
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const idx = connections.findIndex(c => c.id === connId);
      if (idx !== -1) connections.splice(idx, 1);
      if (refreshPanelFn) refreshPanelFn();
    },
    description: 'Delete Connection'
  };
}

export function createTextBoxPropertyChangeCmd(textBoxes, selectedTextBoxes, refreshPanelFn, tbId, property, oldValue, newValue) {
  return {
    undo() {
      const found = textBoxes.find(t => t.id === tbId);
      if (found) found[property] = oldValue;
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const found = textBoxes.find(t => t.id === tbId);
      if (found) found[property] = newValue;
      if (refreshPanelFn) refreshPanelFn();
    },
    description: `Change TextBox ${property}`
  };
}

export function createConnectionPropertyChangeCmd(connections, selectedConnection, refreshPanelFn, connId, property, oldValue, newValue) {
  return {
    undo() {
      const found = connections.find(c => c.id === connId);
      if (found) found[property] = oldValue;
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const found = connections.find(c => c.id === connId);
      if (found) found[property] = newValue;
      if (refreshPanelFn) refreshPanelFn();
    },
    description: `Change Connection ${property}`
  };
}

export function createArrowPropertyChangeCmd(arrows, selectedArrows, refreshPanelFn, arrowId, property, oldValue, newValue) {
  return {
    undo() {
      const found = arrows.find(a => a.id === arrowId);
      if (found) found[property] = oldValue;
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      const found = arrows.find(a => a.id === arrowId);
      if (found) found[property] = newValue;
      if (refreshPanelFn) refreshPanelFn();
    },
    description: `Change Arrow ${property}`
  };
}

export function createMoveConnectorsCmd(connectors, selectedConnectors, moves) {
  return {
    undo() {
      for (const m of moves) {
        const found = connectors.find(c => c.id === m.id);
        if (found) {
          found.x1 = m.fromX1; found.y1 = m.fromY1;
          found.x2 = m.fromX2; found.y2 = m.fromY2;
        }
      }
    },
    redo() {
      for (const m of moves) {
        const found = connectors.find(c => c.id === m.id);
        if (found) {
          found.x1 = m.toX1; found.y1 = m.toY1;
          found.x2 = m.toX2; found.y2 = m.toY2;
        }
      }
    },
    description: moves.length === 1 ? 'Move Connector' : `Move ${moves.length} Connectors`
  };
}

export function createBatchNodePropertyChangeCmd(nodes, selected, refreshPanelFn, changes) {
  return {
    undo() {
      for (const c of changes) {
        const found = findNodeById(nodes, c.nodeId);
        if (found) found.node[c.property] = c.oldValue;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      for (const c of changes) {
        const found = findNodeById(nodes, c.nodeId);
        if (found) found.node[c.property] = c.newValue;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: changes.length === 1 ? `Change ${changes[0].property}` : `Change ${changes[0].property} (${changes.length} items)`
  };
}

export function createBatchResizeNodeCmd(nodes, selected, refreshPanelFn, changes) {
  return {
    undo() {
      for (const c of changes) {
        const found = findNodeById(nodes, c.nodeId);
        if (found) {
          found.node.x = c.fromBounds.x;
          found.node.y = c.fromBounds.y;
          found.node.w = c.fromBounds.w;
          found.node.h = c.fromBounds.h;
        }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      for (const c of changes) {
        const found = findNodeById(nodes, c.nodeId);
        if (found) {
          found.node.x = c.toBounds.x;
          found.node.y = c.toBounds.y;
          found.node.w = c.toBounds.w;
          found.node.h = c.toBounds.h;
        }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: `Resize ${changes.length} nodes`
  };
}

export function createBatchShapePropertyChangeCmd(shapes, selectedShapes, refreshPanelFn, changes) {
  return {
    undo() {
      for (const c of changes) {
        const found = shapes.find(s => s.id === c.shapeId);
        if (found) found[c.property] = c.oldValue;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      for (const c of changes) {
        const found = shapes.find(s => s.id === c.shapeId);
        if (found) found[c.property] = c.newValue;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: changes.length === 1 ? `Change Shape ${changes[0].property}` : `Change Shape ${changes[0].property} (${changes.length} items)`
  };
}

export function createBatchResizeShapeCmd(shapes, selectedShapes, refreshPanelFn, changes) {
  return {
    undo() {
      for (const c of changes) {
        const found = shapes.find(s => s.id === c.shapeId);
        if (found) {
          found.x = c.fromBounds.x; found.y = c.fromBounds.y;
          found.w = c.fromBounds.w; found.h = c.fromBounds.h;
        }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      for (const c of changes) {
        const found = shapes.find(s => s.id === c.shapeId);
        if (found) {
          found.x = c.toBounds.x; found.y = c.toBounds.y;
          found.w = c.toBounds.w; found.h = c.toBounds.h;
        }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: `Resize ${changes.length} shapes`
  };
}

export function createBatchTextBoxPropertyChangeCmd(textBoxes, selectedTextBoxes, refreshPanelFn, changes) {
  return {
    undo() {
      for (const c of changes) {
        const found = textBoxes.find(t => t.id === c.tbId);
        if (found) found[c.property] = c.oldValue;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      for (const c of changes) {
        const found = textBoxes.find(t => t.id === c.tbId);
        if (found) found[c.property] = c.newValue;
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: changes.length === 1 ? `Change TextBox ${changes[0].property}` : `Change TextBox ${changes[0].property} (${changes.length} items)`
  };
}

export function createBatchResizeTextBoxCmd(textBoxes, selectedTextBoxes, refreshPanelFn, changes) {
  return {
    undo() {
      for (const c of changes) {
        const found = textBoxes.find(t => t.id === c.tbId);
        if (found) {
          found.x = c.fromBounds.x; found.y = c.fromBounds.y;
          found.w = c.fromBounds.w; found.h = c.fromBounds.h;
        }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    redo() {
      for (const c of changes) {
        const found = textBoxes.find(t => t.id === c.tbId);
        if (found) {
          found.x = c.toBounds.x; found.y = c.toBounds.y;
          found.w = c.toBounds.w; found.h = c.toBounds.h;
        }
      }
      if (refreshPanelFn) refreshPanelFn();
    },
    description: `Resize ${changes.length} text boxes`
  };
}
