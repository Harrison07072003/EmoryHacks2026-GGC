// Every gameplay number lives here. Change values in this file, not in the systems that
// use them. Times are seconds unless a name ends in Ms. Positions are normalized 0-1 of the
// play area (x 0 = left, y 0 = top), the same units as the eye-controller.

export const LAYOUT = {
  lanes: 4,                 // target columns, left to right (must match the eye-controller layout)
  bandSplit: 0.5,           // y where the top (straight-note) band ends and the bottom (curve) band starts
  upperLineY: 0.36,         // the shiny line where straight notes are judged (inside the top band)
  lowerLineY: 0.80,         // the shiny line where curved notes are followed (inside the bottom band)
  horizonY: -0.04,          // vanishing point of the highway (slightly above the screen)
  horizonWidth: 0.10,       // width of the highway at the horizon, as a fraction of its width at the upper line
};

/** Difficulty modes. `failEnabled: false` = the song always plays to the end. */
export const MODES = {
  practice: {
    id: 'practice', label: 'Practice', subtitle: 'Casual', characterId: 'onyx',
    blurb: 'Forgiving timing, simple patterns. You can\'t lose: the song always plays to the end.',
    failEnabled: false,
    approachSec: 2.4,       // time a straight note takes from the horizon to the upper line
    windows: { perfect: 0.16, good: 0.38 },   // +- seconds around the note time
    zoneTolerance: 0.05,    // how far outside its column the gaze may stray and still count (fraction of screen width)
    bandTolerance: 0.10,    // how far past the band split the gaze may go and still count as the right band
    minDwellMs: 0,          // gaze must be in the zone this long before it counts (filters passing glances)
    curve: { tolerance: 0.15, perfectCoverage: 0.75, goodCoverage: 0.45 },
  },
  normal: {
    id: 'normal', label: 'Normal', subtitle: 'Moderate', characterId: 'volt',
    blurb: 'Standard difficulty. Miss too many notes in a row and the song ends.',
    failEnabled: true,
    approachSec: 1.9,
    windows: { perfect: 0.12, good: 0.30 },
    zoneTolerance: 0.03,
    bandTolerance: 0.06,
    minDwellMs: 50,
    curve: { tolerance: 0.12, perfectCoverage: 0.82, goodCoverage: 0.55 },
  },
  hard: {
    id: 'hard', label: 'Challenge', subtitle: 'Hard', characterId: 'nova',
    blurb: 'Dense charts, fast jumps and tight curves. Health drains faster.',
    failEnabled: true,
    approachSec: 1.45,
    windows: { perfect: 0.09, good: 0.24 },
    zoneTolerance: 0.015,
    bandTolerance: 0.04,
    minDwellMs: 70,
    curve: { tolerance: 0.10, perfectCoverage: 0.85, goodCoverage: 0.6 },
  },
};
export const MODE_ORDER = ['practice', 'normal', 'hard'];

export const SCORING = {
  points: { perfect: 300, good: 120, miss: 0 },
  frenzyMultiplier: 2,
  // accuracy % = (perfect * 1 + good * goodWeight) / judged notes
  goodWeight: 0.6,
};

/** Health drops on a miss, comes back on hits. Danger levels are health thresholds. */
export const HEALTH = {
  max: 100,
  start: 100,
  missPenalty: { practice: 0, normal: 9, hard: 12 },
  regen: { perfect: 2.5, good: 1.2 },
  danger: [               // checked top to bottom; first match wins
    { level: 2, below: 30 },   // darker red, slow pulse
    { level: 1, below: 60 },   // pink/red edge glow
  ],                           // level 3 = health 0 = song ends (failure)
};

export const FRENZY = {
  max: 100,
  gain: { perfect: 7, good: 3.5, miss: 0 },
  durationSec: 5,         // exactly five seconds of Frenzy Mode
};

/** Result grades by accuracy %, checked top to bottom. A failed song is always F. */
export const GRADES = [
  { grade: 'S', min: 95 },
  { grade: 'A', min: 85 },
  { grade: 'B', min: 70 },
  { grade: 'C', min: 0 },
];

/** Curves are split into segments; each segment is judged on its own. */
export const CURVE = {
  segmentSec: 1.0,
  // eyes and smoothing trail a moving target; a sample counts as on-path if the gaze is
  // close to where the path was at any moment in the last `lagSec`
  lagSec: 0.18,
};

export const INPUT = {
  gazeLatencyMs: { live: 115, sim: 90, mouse: 0 },  // judge notes against where the eyes were this long ago
                                                     // (live 115: the tracker's measured average lag on a moving target)
  refineOnPerfect: true,  // tell the tracker "the player was certainly looking here" on Perfect hits
};

export const DWELL = {
  activateMs: 2000,       // continuous gaze needed to press a button
  decayRate: 2,           // progress drains this many times faster than it fills when the gaze leaves
  hitPadding: 0.03,       // buttons accept gaze this far outside their box (fraction of screen width)
  stickyPadding: 0.05,    // once a button is being dwelled on, it keeps it until the gaze leaves this padding
  cooldownMs: 900,        // after any activation, nothing can activate for this long
  previewDelayMs: 450,    // song previews start after the gaze rests on a song this long
};

export const PREVIEW = { durationSec: 8, fadeSec: 1.2 };

export const CALIBRATION = {
  minScore: 60,           // below this the engine reports the calibration as not ready
  betweenSongs: 'quick',  // 'quick' (8 dots + short follow + 4 band hops), 'full', or 'off'
  quickPursuitMs: 5000,
  fullPursuitMs: 10000,
  quickHops: 4,           // top/bottom band hops at the end (the engine checks the player looks at each)
  fullHops: 8,
  keepWorseBy: 8,         // a between-song recalibration that scores this much lower than the saved one is discarded
  resultAutoMs: 4000,     // a good result screen continues by itself after this long
};

/** Mouse input next to the eyes. The mode is chosen in Settings. */
export const MOUSE = {
  defaultMode: 'off',        // 'off': eyes only; 'assist': eyes first, the mouse drives only while it moves
                             // or the face is lost
  assistTravelPx: 60,        // assist: mouse travel within takeoverWindowMs that counts as deliberate use
  takeoverWindowMs: 400,
  assistHoldMs: 1500,        // assist: the mouse keeps control this long after it stops
  offerAfterFailures: 2,     // failed calibrations in a row before the game offers to play with the mouse
};

/**
 * Tracking drifted during a song: the head moved away from where it was at calibration.
 * Not the overall quality number: that also falls with glare, pupil contrast and a modest
 * calibration score (a 63 calibration sat below 30 for 75% of a recorded song with nothing wrong).
 */
export const DRIFT = {
  headBelow: 0.8,         // the engine's head factor (1 = same pose as at calibration, 0.5 = far off);
                          // 0.8 is about a 15 degree turn or a fifth of the camera view sideways
  sustainSec: 2.5,        // ...for this long
  noticeSec: 3,           // "Recalibrating in 3…" (with Cancel) before the quick recalibration starts
};

/** Face check before calibration. The checks themselves are the engine's positionChecks(). */
export const FACE_CHECK = {
  holdSec: 1.5,           // all required checks green this long -> continue by itself
};

/** Pausing during a song. */
export const PAUSE = {
  autoPauseOnFaceLostSec: 3,   // pause by itself when no face is seen this long (0 = never)
  resumeRewindSec: 1,          // resume this far back so the player can find the notes again
  resumeCountdownSec: 2,
};

export const COUNTDOWN_SEC = 3;
export const LEAD_IN_SEC = 1.0;        // silence before the audio starts so the first notes can travel in
export const MISSED_NOTE_TRAIL_SEC = 0.45; // missed notes keep sliding this long before fading out

export const AUDIO_DEFAULTS = { master: 0.9, music: 0.8, sfx: 0.7, offsetMs: 0 };
