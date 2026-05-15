import { TOOLS, getActiveTool, setActiveTool, getShapeSubType, setShapeSubType, onToolChange } from './toolManager.js';
import { state } from './state.js';

const SHAPE_TYPES = [
  { key: 'rectangle', label: 'Rectangle' },
  { key: 'circle',    label: 'Circle' },
  { key: 'triangle',  label: 'Triangle' },
  { key: 'diamond',   label: 'Diamond' },
];

const shapeSvgs = {
  rectangle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>',
  circle:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/></svg>',
  triangle:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l10 20H2z"/></svg>',
  diamond:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l10 10-10 10L2 12z"/></svg>',
};

const svgIcons = {
  cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 19L19 5"/><path d="M12 5h7v7"/></svg>',
  connectionLine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="4" y1="20" x2="20" y2="4"/><circle cx="4" cy="20" r="1.5" fill="currentColor"/><circle cx="20" cy="4" r="1.5" fill="currentColor"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
};

function shapeIconHtml(key) {
  return shapeSvgs[key] || shapeSvgs.rectangle;
}

let shapesBtn = null;

function createToolbar() {
  const toolbar = document.createElement('div');
  toolbar.id = 'leftToolbar';
  toolbar.className = 'left-toolbar';

  const tools = [
    { id: TOOLS.CURSOR, icon: svgIcons.cursor, label: 'Cursor (V)' },
    { id: TOOLS.ARROW, icon: svgIcons.arrow, label: 'Arrow' },
    { id: TOOLS.CONNECTION_LINE, icon: svgIcons.connectionLine, label: 'Connection Line' },
    { id: TOOLS.TEXT, icon: svgIcons.text, label: 'Text Box' },
  ];

  for (const tool of tools) {
    const btn = document.createElement('button');
    btn.className = 'toolbar-btn';
    btn.dataset.tool = tool.id;
    btn.title = tool.label;
    btn.innerHTML = tool.icon;
    btn.addEventListener('click', () => {
      setActiveTool(tool.id);
      updateActiveState();
    });
    toolbar.appendChild(btn);
  }

  const shapesContainer = document.createElement('div');
  shapesContainer.className = 'toolbar-shapes-container';

  shapesBtn = document.createElement('button');
  shapesBtn.className = 'toolbar-btn';
  shapesBtn.dataset.tool = TOOLS.SHAPES;
  shapesBtn.title = 'Shapes';
  const initialType = getShapeSubType();
  shapesBtn.innerHTML = shapeIconHtml(initialType);
  shapesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const submenu = shapesContainer.querySelector('.toolbar-shapes-submenu');
    if (submenu) submenu.classList.toggle('visible');
    setActiveTool(TOOLS.SHAPES);
    updateActiveState();
  });
  shapesContainer.appendChild(shapesBtn);

  const submenu = document.createElement('div');
  submenu.className = 'toolbar-shapes-submenu';
  for (const st of SHAPE_TYPES) {
    const opt = document.createElement('button');
    opt.className = 'toolbar-submenu-item';
    opt.dataset.shapeType = st.key;
    opt.title = st.label;
    opt.innerHTML = shapeIconHtml(st.key);
    opt.addEventListener('click', (e) => {
      e.stopPropagation();
      setShapeSubType(st.key);
      setActiveTool(TOOLS.SHAPES, st.key);
      updateActiveState();
      submenu.classList.remove('visible');
    });
    submenu.appendChild(opt);
  }
  shapesContainer.appendChild(submenu);

  toolbar.appendChild(shapesContainer);

  document.addEventListener('click', (e) => {
    if (!shapesContainer.contains(e.target)) {
      const submenu = shapesContainer.querySelector('.toolbar-shapes-submenu');
      if (submenu) submenu.classList.remove('visible');
    }
  });

  document.body.appendChild(toolbar);
  updateActiveState();
}

function updateActiveState() {
  const active = getActiveTool();
  const allBtns = document.querySelectorAll('.toolbar-btn');
  allBtns.forEach(b => {
    if (b.dataset.tool === active) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  const canDrawingTool = active !== TOOLS.CURSOR;
  state.canvas.style.cursor = canDrawingTool ? 'crosshair' : '';

  if (shapesBtn) {
    shapesBtn.innerHTML = shapeIconHtml(getShapeSubType());
  }
}

onToolChange(() => {
  updateActiveState();
});

export function initToolbar() {
  createToolbar();
}

export function updateToolCursor() {
  const active = getActiveTool();
  if (active === TOOLS.CURSOR) return;
  state.canvas.style.cursor = 'crosshair';
}
