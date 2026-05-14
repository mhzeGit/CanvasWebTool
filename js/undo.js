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
    },

    undo() {
      if (undoStack.length === 0) return false;
      isUndoRedoing = true;
      const cmd = undoStack.pop();
      cmd.undo();
      redoStack.push(cmd);
      isUndoRedoing = false;
      return true;
    },

    redo() {
      if (redoStack.length === 0) return false;
      isUndoRedoing = true;
      const cmd = redoStack.pop();
      cmd.redo();
      undoStack.push(cmd);
      isUndoRedoing = false;
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
