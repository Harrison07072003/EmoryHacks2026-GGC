// Character definitions: data only. The portrait builder (portrait.js) turns these into SVG.
// To use real artwork later, set `image` to an image URL (with the eyes drawn on a separate
// transparent layer in `eyesImage` if you want the Frenzy glow) and the builder will use it.
// Names are placeholders: rename freely.

export const CHARACTERS = {
  volt: {
    id: 'volt', name: 'VOLT', mode: 'normal',
    blurb: 'Mint-haired beat runner. Cool, cocky, always on tempo.',
    skin: '#8a5a3c', skinShade: '#6f452c',
    hair: '#5ef2c0', hairShade: '#27b48a', hairStyle: 'spiky',
    iris: '#2be3a4', eyeGlow: '#7dffd8', outfit: '#141a2b', trim: '#39ffb0',
    earrings: true, lashes: false, blush: false, mouth: 'smirk',
  },
  nova: {
    id: 'nova', name: 'NOVA', mode: 'hard',
    blurb: 'Pink-haired speed demon. Lives for the hardest charts.',
    skin: '#c48a5c', skinShade: '#a36d44',
    hair: '#ff7ac8', hairShade: '#d9479e', hairStyle: 'fluffy',
    iris: '#ff4fb0', eyeGlow: '#ffc2ea', outfit: '#1d1430', trim: '#ff5bd6',
    earrings: false, lashes: true, blush: true, mouth: 'grin',
  },
  onyx: {
    id: 'onyx', name: 'ONYX', mode: 'practice',
    blurb: 'Calm black-haired guide. Patient, steady, never rushes you.',
    skin: '#f4dccb', skinShade: '#ddbca6',
    hair: '#1b1b26', hairShade: '#08080e', hairStyle: 'long',
    iris: '#a45bff', eyeGlow: '#e0c2ff', outfit: '#121624', trim: '#a45bff',
    earrings: false, lashes: false, blush: false, mouth: 'smile',
  },
};
export const CHARACTER_ORDER = ['onyx', 'volt', 'nova'];
