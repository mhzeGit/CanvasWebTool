export class ParentTree {

  constructor() {
    this._entities = new Map();
    this._parent = new Map();
    this._children = new Map();
    this._dirty = new Set();
    this._depths = new Map();
    this._depthDirty = true;
  }

  rebuildAll(shapes, textBoxes) {
    this._entities.clear();
    this._parent.clear();
    this._children.clear();
    this._dirty.clear();
    this._depths.clear();
    this._depthDirty = true;

    for (const s of shapes) {
      this._entities.set('shape:' + s.id, { type: 'shape', id: s.id, entity: s });
    }
    for (const tb of textBoxes) {
      this._entities.set('textBox:' + tb.id, { type: 'textBox', id: tb.id, entity: tb });
    }

    for (const [key, info] of this._entities) {
      this._recomputeEntityParent(key, info.entity);
    }
  }

  register(type, id, entity) {
    const key = type + ':' + id;
    this._entities.set(key, { type, id, entity });
    this._recomputeEntityParent(key, entity);
    this._depthDirty = true;
  }

  unregister(type, id) {
    const key = type + ':' + id;
    this._entities.delete(key);
    this._depths.delete(key);
    this._dirty.delete(key);

    const parentKey = this._parent.get(key);
    if (parentKey) {
      const siblings = this._children.get(parentKey);
      if (siblings) siblings.delete(key);
      this._parent.delete(key);
    }

    const children = this._children.get(key);
    if (children) {
      for (const childKey of children) {
        this._parent.delete(childKey);
        this._dirty.add(childKey);
        const parts = childKey.split(':');
        const childType = parts[0];
        const childId = parseInt(parts[1], 10);
        const childInfo = this._entities.get(childKey);
        if (childInfo) {
          childInfo.entity.parentId = null;
          childInfo.entity.parentType = null;
        }
      }
      this._children.delete(key);
    }

    this._depthDirty = true;
  }

  markDirty(type, id) {
    this._dirty.add(type + ':' + id);
  }

  recomputeDirty() {
    if (this._dirty.size === 0) return;

    for (const key of this._dirty) {
      const info = this._entities.get(key);
      if (!info) continue;

      const oldParentKey = this._parent.get(key);
      if (oldParentKey) {
        const siblings = this._children.get(oldParentKey);
        if (siblings) siblings.delete(key);
        this._parent.delete(key);
      }

      this._recomputeEntityParent(key, info.entity);
    }

    this._dirty.clear();
    this._depthDirty = true;
  }

  getParent(type, id) {
    const key = type + ':' + id;
    const parentKey = this._parent.get(key);
    if (!parentKey) return null;
    const idx = parentKey.indexOf(':');
    return { type: parentKey.substring(0, idx), id: parseInt(parentKey.substring(idx + 1), 10) };
  }

  getChildren(type, id) {
    const key = type + ':' + id;
    const children = this._children.get(key);
    if (!children) return [];
    const result = [];
    for (const childKey of children) {
      const idx = childKey.indexOf(':');
      result.push({ type: childKey.substring(0, idx), id: parseInt(childKey.substring(idx + 1), 10) });
    }
    return result;
  }

  getDescendants(type, id) {
    const results = [];
    const stack = [type + ':' + id];
    const seen = new Set();
    while (stack.length > 0) {
      const key = stack.pop();
      if (seen.has(key)) continue;
      seen.add(key);
      const children = this._children.get(key);
      if (children) {
        for (const childKey of children) {
          if (!seen.has(childKey)) {
            const idx = childKey.indexOf(':');
            results.push({ type: childKey.substring(0, idx), id: parseInt(childKey.substring(idx + 1), 10) });
            stack.push(childKey);
          }
        }
      }
    }
    return results;
  }

  getDepth(type, id) {
    this._ensureDepths();
    return this._depths.get(type + ':' + id) || 0;
  }

  getDrawOrder(shapes, textBoxes) {
    this._ensureDepths();
    const items = [];

    for (let i = 0; i < shapes.length; i++) {
      const depth = this._depths.get('shape:' + shapes[i].id) || 0;
      items.push({ type: 'shape', i, area: shapes[i].w * shapes[i].h, depth });
    }
    for (let i = 0; i < textBoxes.length; i++) {
      const depth = this._depths.get('textBox:' + textBoxes[i].id) || 0;
      items.push({ type: 'textBox', i, area: textBoxes[i].w * textBoxes[i].h, depth });
    }

    items.sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return b.area - a.area;
    });

    return items;
  }

  markDepthDirty() {
    this._depthDirty = true;
  }

  _ensureDepths() {
    if (!this._depthDirty) return;
    this._depths.clear();

    const visiting = new Set();
    for (const key of this._entities.keys()) {
      this._computeDepth(key, visiting);
    }

    this._depthDirty = false;
  }

  _computeDepth(key, visiting) {
    if (this._depths.has(key)) return this._depths.get(key);

    const parentKey = this._parent.get(key);
    if (!parentKey) {
      this._depths.set(key, 0);
      return 0;
    }

    if (visiting.has(key)) {
      this._depths.set(key, 0);
      return 0;
    }

    visiting.add(key);
    let parentDepth;
    if (this._depths.has(parentKey)) {
      parentDepth = this._depths.get(parentKey);
    } else {
      parentDepth = this._computeDepth(parentKey, visiting);
    }
    visiting.delete(key);

    const depth = parentDepth + 1;
    this._depths.set(key, depth);
    return depth;
  }

  _recomputeEntityParent(key, entity) {
    entity.parentId = null;
    entity.parentType = null;

    const oldParentKey = this._parent.get(key);
    if (oldParentKey) {
      const siblings = this._children.get(oldParentKey);
      if (siblings) siblings.delete(key);
      this._parent.delete(key);
    }

    const parentInfo = this._findParent(entity);
    if (parentInfo) {
      const parentKey = parentInfo.type + ':' + parentInfo.id;

      if (!this._wouldCreateCycle(key, parentKey)) {
        this._parent.set(key, parentKey);

        if (!this._children.has(parentKey)) {
          this._children.set(parentKey, new Set());
        }
        this._children.get(parentKey).add(key);

        entity.parentId = parentInfo.id;
        entity.parentType = parentInfo.type;
      }
    }
  }

  _findParent(entity) {
    let bestKey = null;
    let bestArea = Infinity;

    for (const [key, info] of this._entities) {
      if (info.entity === entity) continue;
      const p = info.entity;
      const area = p.w * p.h;
      if (area < bestArea && p.x <= entity.x && p.y <= entity.y &&
          p.x + p.w >= entity.x + entity.w && p.y + p.h >= entity.y + entity.h) {
        bestKey = key;
        bestArea = area;
      }
    }

    if (!bestKey) return null;
    const idx = bestKey.indexOf(':');
    return { type: bestKey.substring(0, idx), id: parseInt(bestKey.substring(idx + 1), 10) };
  }

  _wouldCreateCycle(childKey, potentialParentKey) {
    let current = this._parent.get(potentialParentKey);
    while (current) {
      if (current === childKey) return true;
      current = this._parent.get(current);
    }
    return false;
  }
}
