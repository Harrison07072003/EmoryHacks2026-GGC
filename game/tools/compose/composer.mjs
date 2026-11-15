// Song-writing helpers: place instruments on a bar/beat grid and record the musical events
// the chart generator needs (exact onset times, lengths, pitches, and whether a phrase is
// staccato -> straight notes, or legato -> curves). Audio and chart come from the same
// events, so they are in sync by construction.
import { SR, createMix, kick, snare, clap, hat, riser, voice, bell, midiHz } from './synth.mjs';

export function createComposer({ bpm, bars, tailSec = 1.5, beatsPerBar = 4 }) {
  const beatSec = 60 / bpm;
  const t = (bar, beat = 0) => (bar * beatsPerBar + beat) * beatSec;
  const totalSec = t(bars) + tailSec;
  const mix = createMix(totalSec);
  const events = [];   // { t, dur, midi, role: 'tap' | 'flow', accent }
  const cache = new Map();
  const cached = (key, make) => (cache.has(key) ? cache.get(key) : cache.set(key, make()).get(key));

  /** 1 = downbeat, 2 = other beats, 3 = eighths, 4 = anything finer. Difficulty filters on it. */
  const accentOf = beat => (beat === 0 ? 1 : Number.isInteger(beat) ? 2 : Number.isInteger(beat * 2) ? 3 : 4);

  const drums = {
    kick: (bar, beat, { gain = 0.9, duck = 0.6, punch = 1 } = {}) => { mix.add(cached(`k${punch}`, () => kick({ punch })), t(bar, beat), { gain }); if (duck) mix.duckAt(t(bar, beat), duck); },
    snare: (bar, beat, { gain = 0.5, verb = 0.25 } = {}) => mix.add(cached('s', () => snare()), t(bar, beat), { gain, verb }),
    clap: (bar, beat, { gain = 0.5, verb = 0.3 } = {}) => mix.add(cached('c', () => clap()), t(bar, beat), { gain, verb }),
    hat: (bar, beat, { gain = 0.22, open = false } = {}) => mix.add(cached(`h${open}`, () => hat({ open })), t(bar, beat), { gain }),
    riser: (bar, beat, beats, { gain = 0.35 } = {}) => mix.add(riser(beats * beatSec), t(bar, beat), { gain, verb: 0.3 }),
  };

  /** Non-charted part (pads, bass, background arps). midi may be one note or a chord array. */
  function play(bar, beat, beats, midi, synth = {}, send = {}) {
    for (const m of [].concat(midi)) mix.add(voice(midiHz(m), beats * beatSec, synth), t(bar, beat), send);
  }

  /**
   * Charted melody. notes: [[bar, beat, beats, midi], ...]. role 'tap' (staccato -> straight
   * notes) or 'flow' (legato -> curves). instrument: 'bell' or a voice() options object.
   */
  function melody(role, notes, instrument = {}, send = {}) {
    let prev = null;
    for (const [bar, beat, beats, midi] of notes) {
      const dur = beats * beatSec, f = midiHz(midi);
      const glide = role === 'flow' && prev !== null && instrument !== 'bell' ? { glideFrom: midiHz(prev), glideSec: 0.08 } : {};
      const buf = instrument === 'bell' ? bell(f, dur) : voice(f, dur, { ...instrument, ...glide });
      mix.add(buf, t(bar, beat), send);
      events.push({ t: round(t(bar, beat)), dur: round(dur), midi, role, accent: accentOf(beat), bar });
      prev = midi;
    }
  }

  return { bpm, beatSec, t, totalSec, drums, play, melody, events, render: opts => mix.render(opts), SR };
}

const round = v => Math.round(v * 10000) / 10000;
