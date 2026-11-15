// Colours and fonts for the ready-made screens (face view, face check, calibration, result).
// Pass `theme: 'neon'`, or your own partial object, to reskin them; anything left out falls
// back to the default.

export const THEMES = {
  default: {
    font: 'system-ui, sans-serif', display: 'system-ui, sans-serif',
    bg: '#07070d', panel: '#1a1a2a', text: '#e8ecff', dim: 'rgba(255,255,255,0.18)',
    ok: '#39ffb0', accent: '#4de1ff', warn: '#ffd34d', bad: '#ff4d6d', secondary: '#4de1ff',
  },
  // the RhythmEyez game's look (game/src/styles/theme.css)
  neon: {
    font: "'Rajdhani', 'Segoe UI', system-ui, sans-serif", display: "'Orbitron', 'Segoe UI', system-ui, sans-serif",
    bg: '#05060a', panel: 'rgba(18,22,36,0.92)', text: '#e6f1ff', dim: 'rgba(230,241,255,0.2)',
    ok: '#39ffb0', accent: '#5dfcff', warn: '#ffd84d', bad: '#ff3b6b', secondary: '#a45bff',
  },
};

/** A theme name or partial object -> a complete theme. */
export function resolveTheme(theme) {
  if (typeof theme === 'string') return { ...THEMES.default, ...THEMES[theme] };
  return { ...THEMES.default, ...theme };
}

/** '#rrggbb' + alpha -> 'rgba(r,g,b,a)' (other colour formats are returned unchanged). */
export function alpha(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * A button for the ready-made screens. It carries `data-gaze`, so a game's gaze-dwell system
 * (which presses [data-gaze] elements) can press it with the eyes; `cls` adds the game's own
 * button class (the RhythmEyez game passes 'gbtn' for its look and dwell fill).
 */
export function screenButton(label, action, T, cls = '') {
  const b = document.createElement('button');
  b.textContent = label; b.dataset.a = action; b.dataset.gaze = '';
  if (cls) b.className = cls;
  else b.style.cssText = `font:600 16px ${T.font};color:${T.text};background:${T.panel};border:1px solid ${T.accent};border-radius:8px;padding:9px 14px;cursor:pointer`;
  return b;
}
