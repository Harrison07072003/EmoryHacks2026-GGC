// One AudioContext for the whole game with three gain stages: master -> (music, sfx).
// Volumes come from settings and can change at any time.
//
// Browsers keep audio suspended until the first click or key press. Eyes-only players
// should start Chrome with --autoplay-policy=no-user-gesture-required (see README).

export function createAudioEngine(volumes) {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const ctx = new Ctx({ latencyHint: 'interactive' });
  const master = ctx.createGain(), music = ctx.createGain(), sfx = ctx.createGain();
  music.connect(master); sfx.connect(master); master.connect(ctx.destination);

  const engine = {
    ctx, buses: { master, music, sfx },
    setVolumes({ master: m, music: mu, sfx: s }) {
      const t = ctx.currentTime;
      if (m !== undefined) master.gain.setTargetAtTime(m, t, 0.02);
      if (mu !== undefined) music.gain.setTargetAtTime(mu, t, 0.02);
      if (s !== undefined) sfx.gain.setTargetAtTime(s, t, 0.02);
    },
    get running() { return ctx.state === 'running'; },
    /** Seconds between scheduling a sound and hearing it (used to line the song clock up with what is heard). */
    get outputLatency() { return (ctx.outputLatency || 0) + (ctx.baseLatency || 0); },
    async unlock() { if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* still blocked */ } } return ctx.state === 'running'; },
  };
  engine.setVolumes(volumes);
  // first gesture anywhere unlocks audio
  const unlock = () => engine.unlock().then(ok => { if (ok) { removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock); } });
  addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
  engine.unlock();
  return engine;
}
