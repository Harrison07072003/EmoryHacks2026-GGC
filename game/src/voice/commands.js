// Voice command parser: one spoken phrase -> one command. Pure (tested in test/voice-commands.test.js).
//
//   "search lofi beats" / "find X" / "look for X"  -> { type: 'search', q }
//   "genre rock" / "rock" / "rock music"           -> { type: 'genre', genre }   (known genre)
//   "genre <unknown>"                              -> { type: 'search', q }      (text search still covers genres)
//   "play 3" / "choose three" / "pick the second"  -> { type: 'choose', n }      (the screen asks to confirm)
//   "play" / "choose" / "this one"                 -> { type: 'choose', n: null } (the highlighted song)
//   "yes" / "confirm" | "no" / "cancel"            -> { type: 'confirm' } | { type: 'cancel' }
//   "back" | "clear" | "keyboard" | "stop listening"
//   anything else                                  -> { type: 'search', q } (when plain speech is a search)

const NUMBERS = {
  one: 1, won: 1, first: 1, '1st': 1,
  two: 2, to: 2, too: 2, second: 2, '2nd': 2,
  three: 3, tree: 3, third: 3, '3rd': 3,
  four: 4, for: 4, fore: 4, fourth: 4, '4th': 4,
  five: 5, fifth: 5, '5th': 5,
  six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, ate: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10,
};

/** lowercase, "&" -> "and", punctuation removed, single spaces */
export const normalize = s => String(s ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();

const toNumber = w => (/^\d+$/.test(w) ? Number(w) : NUMBERS[w] ?? null);

const STOP = /^(stop listening|stop voice|mic off|microphone off|turn off (the )?(mic|microphone)|stop)$/;
const BACK = /^(go )?back$|^go back$|^return$/;
const CLEAR = /^(clear|clear (it|search|the search|that)|start over|reset|delete( it| all)?)$/;
const KEYBOARD = /^(open )?(the )?keyboard$|^type$|^typing$/;
const CONFIRM = /^(yes|yeah|yep|confirm|ok|okay|sure|do it|play it|go)$/;
const CANCEL = /^(no|nope|cancel|never mind|nevermind|not that one)$/;
const CHOOSE_HERE = /^(play|choose|pick|select)( (it|this|this one|that one))?$|^this one$/;
const CHOOSE_N = /^(?:play|choose|pick|select|song|number|track)(?: (?:song|number|track|the))*(?: number)? (\S+)$|^(?:the )?(\S+) (?:one|song)$/;
const SEARCH = /^(?:search(?: for)?|find(?: me)?|look(?:ing)? for|show(?: me)?|i want(?: to hear)?)\s+(.+)$/;
const GENRE = /^(?:genre|genres|style|category|play some|some)\s+(.+?)(?:\s+music)?$/;

/**
 * @param transcript  a final recognition result
 * @param o  { genres: string[] known genre values, plainIsSearch: plain speech runs a search }
 * @returns  a command object, or null when nothing should happen
 */
export function parseCommand(transcript, { genres = [], plainIsSearch = true } = {}) {
  const t = normalize(transcript);
  if (!t) return null;
  if (STOP.test(t)) return { type: 'stop' };
  if (BACK.test(t)) return { type: 'back' };
  if (CLEAR.test(t)) return { type: 'clear' };
  if (KEYBOARD.test(t)) return { type: 'keyboard' };
  if (CONFIRM.test(t)) return { type: 'confirm' };
  if (CANCEL.test(t)) return { type: 'cancel' };
  if (CHOOSE_HERE.test(t)) return { type: 'choose', n: null };

  const choose = t.match(CHOOSE_N);
  const n = choose && toNumber(choose[1] ?? choose[2]);
  if (n) return { type: 'choose', n };

  const genreOf = findGenre(genres);
  const g = t.match(GENRE);
  if (g) return genreOf(g[1]) ? { type: 'genre', genre: genreOf(g[1]) } : { type: 'search', q: g[1] };
  const s = t.match(SEARCH);
  if (s) return { type: 'search', q: s[1] };
  const bare = genreOf(t) ?? genreOf(t.replace(/\s+music$/, ''));
  if (bare) return { type: 'genre', genre: bare };
  return plainIsSearch ? { type: 'search', q: t } : null;
}

/** Match spoken words to a known genre value ("drum and bass" -> "drum & bass"; "hiphop" -> "hip-hop"). */
function findGenre(genres) {
  const squash = s => normalize(s).replace(/[\s'-]+/g, '');
  const index = new Map(genres.map(g => [squash(g), g]));
  return spoken => index.get(squash(spoken)) ?? null;
}
