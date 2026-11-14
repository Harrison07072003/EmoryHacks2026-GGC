// The data-collection checklist shown on the debug page. Edit freely: `id` becomes part of
// the clip file name (<player>-<id>_<date>.json), `clips` is how many to aim for.
// `calibrate: false` records only the test run, using the calibration already loaded:
// that is how drift (accuracy some time after calibrating) is measured.
export const PROTOCOL = [
  { id: 'baseline', clips: 5, text: 'Your normal setup. Five repeats show how much scores move by chance.' },
  { id: 'bright', clips: 2, text: 'Strong light in front of you (lamp or screen brightness up).' },
  { id: 'dim', clips: 2, text: 'Room lights low or off.' },
  { id: 'backlit', clips: 2, text: 'Window or lamp behind you.' },
  { id: 'busy', clips: 2, text: 'People moving behind you.' },
  { id: 'noglasses', clips: 2, text: 'Glasses off (skip if you never wear any).' },
  { id: 'close', clips: 2, text: 'Lean in: face about 40 cm from the screen.' },
  { id: 'far', clips: 2, text: 'Lean back: about 80 cm.' },
  { id: 'headmove', clips: 2, text: 'Move your head naturally during the test run, like you would in a game.' },
  { id: 'drift5', clips: 2, calibrate: false, text: 'Right after a baseline clip, use the computer normally for 5 minutes, then run this (no recalibration).' },
];
