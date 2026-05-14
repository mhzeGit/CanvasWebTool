const STORAGE_KEY = 'canvasWebToolSettings';

const defaultSettings = {
  theme: 'dark',
  dark: {
    background: '#101010',
    gridLine: '#191919',
  },
  light: {
    background: '#e8e8e8',
    gridLine: '#c8c8c8',
  },
};

let currentSettings = null;
let changeListeners = [];

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        theme: parsed.theme || defaultSettings.theme,
        dark: { ...defaultSettings.dark, ...(parsed.dark || {}) },
        light: { ...defaultSettings.light, ...(parsed.light || {}) },
      };
    }
  } catch (e) {}
  return deepClone(defaultSettings);
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  } catch (e) {}
}

function applyThemeToDOM() {
  const theme = currentSettings.theme;
  document.documentElement.setAttribute('data-theme', theme);

  const colors = currentSettings[theme];
  if (colors) {
    if (colors.background) document.documentElement.style.setProperty('--user-bg', colors.background);
    if (colors.gridLine) document.documentElement.style.setProperty('--user-grid', colors.gridLine);
  }
}

function notifyListeners() {
  for (const fn of changeListeners) {
    try { fn(currentSettings); } catch (e) {}
  }
}

export function initSettings() {
  currentSettings = loadSettings();
  applyThemeToDOM();
}

export function getSettings() {
  if (!currentSettings) currentSettings = loadSettings();
  return currentSettings;
}

export function getTheme() {
  return getSettings().theme;
}

export function setTheme(theme) {
  const s = getSettings();
  if (s.theme === theme) return;
  s.theme = theme;
  saveSettings();
  applyThemeToDOM();
  notifyListeners();
}

export function getEffectiveBackground() {
  const s = getSettings();
  return s[s.theme].background || defaultSettings[s.theme].background;
}

export function getEffectiveGridLine() {
  const s = getSettings();
  return s[s.theme].gridLine || defaultSettings[s.theme].gridLine;
}

export function setCustomColor(theme, key, value) {
  const s = getSettings();
  if (!s[theme]) s[theme] = {};
  s[theme][key] = value;
  saveSettings();
  applyThemeToDOM();
  notifyListeners();
}

export function resetColor(theme, key) {
  const s = getSettings();
  if (s[theme] && s[theme][key] !== undefined) {
    delete s[theme][key];
  }
  saveSettings();
  applyThemeToDOM();
  notifyListeners();
}

export function resetAllSettings() {
  currentSettings = deepClone(defaultSettings);
  saveSettings();
  applyThemeToDOM();
  notifyListeners();
}

export function onChange(fn) {
  changeListeners.push(fn);
}

export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
