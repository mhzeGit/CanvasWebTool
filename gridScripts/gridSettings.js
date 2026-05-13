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
    { spacing: 10,   weight: 0.6, minPx: 8,  peakPx: 24, maxPx: 70  },
    { spacing: 40,   weight: 0.8, minPx: 10, peakPx: 28, maxPx: 80  },
    { spacing: 200,  weight: 1.1, minPx: 16, peakPx: 60, maxPx: 180 },
    { spacing: 1000, weight: 1.4, minPx: 24, peakPx: 100, maxPx: 320 },
  ]
};
