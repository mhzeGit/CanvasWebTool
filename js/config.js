export const GRID = {
  backgroundColor: 'rgb(24, 24, 24)',
  lineColor: [30, 30, 30],
  lineWidth: 2,
  spacing: 20,
  panLerp: 0.2,
  zoomLerp: 0.2,
  zoomFactor: 1.1,
  minScale: 0.05,
  maxScale: 5,
  gridLevels: [
    { spacing: 10,   weight: 0.6, minPx: 8,  peakPx: 24, maxPx: 70  },
    { spacing: 40,   weight: 0.8, minPx: 10, peakPx: 28, maxPx: 80  },
    { spacing: 200,  weight: 1.1, minPx: 16, peakPx: 60, maxPx: 180 },
    { spacing: 1000, weight: 1.4, minPx: 24, peakPx: 100, maxPx: 320 },
  ]
};

export const ARROW_END_RADIUS = 8;
export const ARROW_END_HIT_RADIUS = 14;
export const ARROW_BODY_HIT_THRESHOLD = 6;
export const ARROW_HEAD_LENGTH = 14;
export const ARROW_HEAD_ANGLE = Math.PI / 6;

export const DRAG_THRESHOLD_PX = 3;
export const RMB_MENU_THRESHOLD_MS = 250;

export const EDGE_MARGIN = 12;
export const NODE_MIN_W = 100;
export const NODE_MIN_H = 70;

export const CONN_HIT_THRESHOLD = 8;

export const DEFAULT_NODE_COLOR = '#2b2b2b';
export const DEFAULT_TITLE_COLOR = '#e7e7e7';
export const DEFAULT_TEXT_COLOR = '#ddd';
export const DEFAULT_CONN_COLOR = '#6bb5ff';
export const DEFAULT_ARROW_COLOR = '#6bb5ff';

export const MAX_HISTORY_SIZE = 200;

export const PLACEHOLDER_COLOR = '#777';
export const TITLE_PLACEHOLDER = 'Add Title';
export const TEXT_PLACEHOLDER = 'Add description...';
