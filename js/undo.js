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
