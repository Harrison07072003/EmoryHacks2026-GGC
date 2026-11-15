// Character definitions: data only. Each mode has its own character (no picker).
// `image` is the team's artwork (transparent PNG cut from the design sheet); when it is set,
// portrait.js shows it instead of drawing the SVG fallback from the colours below. Frenzy
// makes the whole portrait glow in `eyeGlow` (add `eyesImage`, a transparent eye layer, to
// make only the eyes glow).
const art = name => new URL(`./art/${name}.png`, import.meta.url).href;

export const CHARACTERS = {
  volt: {
    id: 'volt', name: 'VOLT', mode: 'normal', image: art('volt'), artScale: 0.90,
    blurb: 'Mint-haired beat runner. Cool, cocky, always on tempo.',
    skin: '#8a5a3c', skinShade: '#6f452c',
    hair: '#5ef2c0', hairShade: '#27b48a', hairStyle: 'spiky',
    iris: '#2be3a4', eyeGlow: '#7dffd8', outfit: '#141a2b', trim: '#39ffb0',
    earrings: true, lashes: false, blush: false, mouth: 'smirk',
  },
  nova: {
    id: 'nova', name: 'NOVA', mode: 'hard', image: art('nova'), artScale: 1,
    blurb: 'Pink-haired speed demon. Lives for the hardest charts.',
    skin: '#c48a5c', skinShade: '#a36d44',
    hair: '#ff7ac8', hairShade: '#d9479e', hairStyle: 'fluffy',
    iris: '#8a5cc8', eyeGlow: '#ffc2ea', outfit: '#1d1430', trim: '#ff5bd6',
    earrings: false, lashes: true, blush: true, mouth: 'grin',
  },
  onyx: {
    id: 'onyx', name: 'ONYX', mode: 'practice', image: art('onyx'), artScale: 0.79,
    blurb: 'Calm purple-haired guide. Patient, steady, never rushes you.',
    skin: '#f4dccb', skinShade: '#ddbca6',
    hair: '#3a2550', hairShade: '#1f1430', hairStyle: 'long',
    iris: '#9b7ad0', eyeGlow: '#e0c2ff', outfit: '#121624', trim: '#a45bff',
    earrings: false, lashes: false, blush: false, mouth: 'smile',
  },
};
export const CHARACTER_ORDER = ['onyx', 'volt', 'nova'];
