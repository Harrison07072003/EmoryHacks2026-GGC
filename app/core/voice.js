// voice.js - spoken menu commands via the browser's Web Speech API (SpeechRecognition).
// startVoice({ commands, onHeard, onStatus }) -> { stop() }
//   commands: [{ words: ['hub', 'home'], run: () => {...}, when?: () => bool }]
//   A command fires when ANY of its words appears in what the player said.
// Works in Chrome / Edge / Safari. Firefox has no SpeechRecognition -> returns null.

export function startVoice({ commands, onHeard = () => {}, onStatus = () => {} }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { onStatus('Voice commands not supported in this browser (use Chrome)'); return null; }

  const rec = new SR();
  rec.lang = 'en-US';
  rec.continuous = true;        // keep listening instead of stopping after one phrase
  rec.interimResults = true;    // react while the word is still being recognized = faster
  rec.maxAlternatives = 3;      // look at the recognizer's runner-up guesses too ("hub" vs "hob")

  let stopped = false, lastFire = 0;
  const handled = new Set();    // result indexes we already acted on (interim + final arrive for the same phrase)

  const norm = s => s.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  function match(transcript) {
    const said = norm(transcript);
    for (const c of commands) {
      if (c.when && !c.when()) continue;
      if (c.words.some(w => { const parts = norm(w); return parts.every(p => said.includes(p)); })) return c;
    }
    return null;
  }

  rec.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (handled.has(i)) continue;
      const res = e.results[i];
      for (let a = 0; a < res.length; a++) {
        const c = match(res[a].transcript);
        if (!c) continue;
        handled.add(i);
        if (performance.now() - lastFire < 1200) break;   // one command per ~second, no double triggers
        lastFire = performance.now();
        onHeard(res[a].transcript.trim(), c);
        c.run();
        break;
      }
      if (res.isFinal && !handled.has(i)) onHeard(res[0].transcript.trim(), null);  // heard, but not a command
    }
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { stopped = true; onStatus('Microphone blocked - voice commands off'); }
    else if (e.error === 'network') onStatus('Voice needs internet in this browser');
    // 'no-speech' and 'aborted' are normal: onend restarts us
  };
  // Chrome ends the session after silence / ~1 min; restart so voice is always on
  rec.onend = () => { handled.clear(); if (!stopped) setTimeout(() => { try { rec.start(); } catch {} }, 250); };

  try { rec.start(); onStatus('listening'); } catch (e) { console.error(e); }
  return { stop() { stopped = true; try { rec.stop(); } catch {} } };
}
