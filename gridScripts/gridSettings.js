export const gridSettings = {
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
    { spacing: 20,   weight: 1,   minPx: 4,  peakPx: 14, maxPx: 40  },
    { spacing: 100,  weight: 1.5, minPx: 8,  peakPx: 35, maxPx: 90  },
    { spacing: 500,  weight: 2.5, minPx: 15, peakPx: 60, maxPx: 180 },
  ]
};
