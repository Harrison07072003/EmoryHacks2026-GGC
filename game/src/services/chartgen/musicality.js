// Is this audio a SONG we can make a level from: music with a clear, steady beat?
// Thresholds live in src/config/music-filter.json (measured on real archive audio).
import defaults from '../../config/music-filter.json' with { type: 'json' };

export const MUSIC_RULES = defaults.audio;

/**
 * @param a      analyze() result for the first 30 s
 * @returns {{ isSong: boolean, score: number, reasons: string[], metrics: object }}
 *          score = pulse contrast (0..1), stored as rhythm_score
 */
export function assessMusic(a, rules = MUSIC_RULES) {
  const onsetsPerSec = a.onsets.length / Math.max(1, a.duration);
  const activity = a.beats.filter(b => a.energyAt(b) > 0.15).length / Math.max(1, a.beats.length);
  const metrics = { pulseContrast: round(a.pulseContrast), onsetsPerSec: round(onsetsPerSec), activity: round(activity), bpm: a.bpm };
  const reasons = [];
  if (a.pulseContrast < rules.minPulseContrast) reasons.push(`no clear beat (pulse ${metrics.pulseContrast} < ${rules.minPulseContrast})`);
  if (onsetsPerSec < rules.minOnsetsPerSec) reasons.push(`too few hits (${metrics.onsetsPerSec}/s)`);
  if (activity < rules.minActivity) reasons.push(`mostly silent (${Math.round(activity * 100)}% of beats have sound)`);
  return { isSong: reasons.length === 0, score: metrics.pulseContrast, reasons, metrics };
}

const round = v => Math.round(v * 100) / 100;

/** Archive tags that mean "not music" (spoken word, field recordings...). Returns the matching tag or null. */
export function nonMusicTag(tags, excludeTags = defaults.excludeTags) {
  const norm = s => String(s ?? '').toLowerCase().replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  const terms = excludeTags.map(norm);
  for (const tag of tags.map(norm).filter(Boolean)) {
    for (const term of terms) {
      if (tag === term) return tag;
      // whole words inside a longer tag ("children's spoken word"), not substrings ("dronestep" stays)
      if (term.length > 3 && new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z])`).test(tag)) return tag;
    }
  }
  return null;
}
