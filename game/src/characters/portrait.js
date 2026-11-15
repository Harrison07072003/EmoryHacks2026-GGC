// Builds an original chibi-style bust portrait as inline SVG from a character definition.
// Placeholder artwork: replace by setting `image` on the character (see characters.js).
// The eyes are their own group (.eyes, .iris, .eye-glow) so Frenzy can make them glow,
// and the root gets .frenzy / .blink classes from the game.

const HAIR_BACK = {
  spiky: c => `<path d="M38 104 C30 60 52 26 100 24 C148 26 170 60 162 104 L150 92 L50 92 Z" fill="${c.hairShade}"/>`,
  fluffy: c => `<path d="M30 132 C14 70 46 18 100 18 C154 18 186 70 170 132 C176 160 160 176 150 168 L150 100 L50 100 L50 168 C40 176 24 160 30 132 Z" fill="${c.hairShade}"/>`,
  long: c => `<path d="M36 100 C30 50 60 22 100 22 C140 22 170 50 164 100 L172 214 C150 222 140 214 142 200 L58 200 C60 214 50 222 28 214 Z" fill="${c.hairShade}"/>`,
};

const HAIR_FRONT = {
  spiky: c => `
    <path d="M36 96 L28 70 L48 76 L40 46 L64 60 L66 28 L86 50 L100 18 L114 50 L134 28 L136 60 L160 46 L152 76 L172 70 L164 96
             C150 74 132 64 118 70 L110 56 L100 72 L88 58 L80 72 C64 66 48 76 36 96 Z" fill="${c.hair}"/>
    <path d="M62 62 L70 40 M100 30 L100 52 M134 40 L128 62" stroke="${c.hairShade}" stroke-width="3" stroke-linecap="round" opacity=".6"/>`,
  fluffy: c => `
    <path d="M32 112 C26 64 56 26 100 26 C144 26 174 64 168 112 C160 96 150 86 140 84 C142 96 136 104 130 106 C128 92 120 82 110 80
             C112 92 104 100 96 100 C96 88 88 80 78 82 C80 94 72 102 64 104 C62 94 56 88 50 88 C42 92 36 102 32 112 Z" fill="${c.hair}"/>
    <path d="M100 26 C104 14 116 8 124 12 C114 14 108 20 106 30 Z" fill="${c.hair}"/>
    <circle cx="146" cy="70" r="7" fill="#ffe36b"/><path d="M146 60 L148 67 L155 68 L149 72 L151 79 L146 75 L141 79 L143 72 L137 68 L144 67 Z" fill="#fff6b8"/>`,
  long: c => `
    <path d="M38 108 C34 60 62 28 100 28 C138 28 166 60 162 108 C152 90 140 78 124 74 L120 92 L110 74 L100 96 L90 74 L80 92 L76 74 C60 78 48 90 38 108 Z" fill="${c.hair}"/>
    <path d="M100 30 L100 70" stroke="${c.hairShade}" stroke-width="2" opacity=".7"/>
    <path d="M40 104 C36 140 40 170 46 196 L56 196 C52 160 52 130 54 108 Z M160 104 C164 140 160 170 154 196 L144 196 C148 160 148 130 146 108 Z" fill="${c.hair}"/>`,
};

const MOUTH = {
  smirk: '<path d="M88 146 C96 152 108 152 116 142" stroke="#3a1f1a" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
  grin: '<path d="M86 142 C92 156 110 156 116 142 Z" fill="#7a2335"/><path d="M90 143 L112 143" stroke="#fff" stroke-width="3"/>',
  smile: '<path d="M90 145 C96 151 106 151 112 145" stroke="#5a3030" stroke-width="3" fill="none" stroke-linecap="round"/>',
};

function eye(cx, c, side) {
  const lash = c.lashes
    ? `<path d="M${cx - 18} ${108} C${cx - 8} 96 ${cx + 8} 96 ${cx + 18} 106" stroke="#1a0f1a" stroke-width="4.5" fill="none" stroke-linecap="round"/>
       <path d="M${cx + side * 17} 104 l${side * 7} -6 M${cx + side * 13} 101 l${side * 5} -8" stroke="#1a0f1a" stroke-width="3" stroke-linecap="round"/>`
    : `<path d="M${cx - 17} ${106} C${cx - 8} 98 ${cx + 8} 98 ${cx + 17} 105" stroke="#1a1416" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  return `
    <ellipse cx="${cx}" cy="120" rx="15" ry="17" fill="#fff"/>
    <ellipse class="iris" cx="${cx}" cy="122" rx="11.5" ry="14" fill="${c.iris}"/>
    <ellipse cx="${cx}" cy="125" rx="6" ry="8" fill="#0b0b14"/>
    <circle cx="${cx - 5}" cy="115" r="4.2" fill="#fff"/><circle cx="${cx + 4}" cy="129" r="2" fill="#fff" opacity=".8"/>
    ${lash}`;
}

/** @returns an <svg> element string for the character */
export function portraitSvg(c) {
  if (c.image) {
    return `<div class="char-portrait char-${c.id}" style="--eye-glow:${c.eyeGlow}"><img src="${c.image}" alt="${c.name}" style="width:100%">${c.eyesImage ? `<img class="eyes" src="${c.eyesImage}" alt="" style="position:absolute;inset:0;width:100%">` : ''}</div>`;
  }
  const brow = c.hairStyle === 'spiky'
    ? `<path d="M64 98 L90 102 M110 102 L136 98" stroke="${c.hairShade}" stroke-width="5" stroke-linecap="round"/>` : '';
  const blush = c.blush ? '<ellipse cx="62" cy="140" rx="11" ry="6" fill="#ff6f9f" opacity=".45"/><ellipse cx="138" cy="140" rx="11" ry="6" fill="#ff6f9f" opacity=".45"/>' : '';
  const earrings = c.earrings ? `<circle cx="40" cy="138" r="4" fill="${c.trim}"/><circle cx="160" cy="138" r="4" fill="${c.trim}"/><circle cx="40" cy="148" r="3" fill="#ddd"/>` : '';
  return `
  <svg class="char-portrait char-${c.id}" viewBox="0 0 200 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${c.name}" style="--eye-glow:${c.eyeGlow}">
    <defs>
      <radialGradient id="glow-${c.id}"><stop offset="0" stop-color="${c.eyeGlow}" stop-opacity=".95"/><stop offset="1" stop-color="${c.eyeGlow}" stop-opacity="0"/></radialGradient>
      <linearGradient id="suit-${c.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c.outfit}"/><stop offset="1" stop-color="#05060a"/></linearGradient>
    </defs>
    ${HAIR_BACK[c.hairStyle](c)}
    <path d="M40 240 C40 200 62 186 100 186 C138 186 160 200 160 240 Z" fill="url(#suit-${c.id})" stroke="${c.trim}" stroke-width="2"/>
    <path d="M70 196 L100 230 L130 196" stroke="${c.trim}" stroke-width="3" fill="none" opacity=".9"/>
    <rect x="88" y="166" width="24" height="26" rx="8" fill="${c.skinShade}"/>
    <path d="M100 196 L100 240" stroke="${c.trim}" stroke-width="2" opacity=".5"/>
    <ellipse cx="38" cy="126" rx="9" ry="13" fill="${c.skinShade}"/><ellipse cx="162" cy="126" rx="9" ry="13" fill="${c.skinShade}"/>
    <path d="M42 108 C42 66 66 44 100 44 C134 44 158 66 158 108 C158 146 134 176 100 176 C66 176 42 146 42 108 Z" fill="${c.skin}"/>
    ${earrings}
    ${blush}
    <g class="eye-glow"><ellipse cx="74" cy="122" rx="30" ry="26" fill="url(#glow-${c.id})"/><ellipse cx="126" cy="122" rx="30" ry="26" fill="url(#glow-${c.id})"/></g>
    <g class="eyes">${eye(74, c, -1)}${eye(126, c, 1)}</g>
    <g class="lids"><ellipse cx="74" cy="120" rx="17" ry="19" fill="${c.skin}"/><ellipse cx="126" cy="120" rx="17" ry="19" fill="${c.skin}"/></g>
    ${brow}
    <path d="M100 128 L97 138 L102 139" stroke="${c.skinShade}" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    ${MOUTH[c.mouth]}
    ${HAIR_FRONT[c.hairStyle](c)}
    <path d="M44 120 C40 132 30 128 28 118 C28 108 36 100 44 104" fill="none" stroke="${c.trim}" stroke-width="3" opacity=".85"/>
  </svg>`;
}

/** Mount a portrait into `parent` and return its root element. */
export function mountPortrait(parent, character) {
  parent.insertAdjacentHTML('beforeend', portraitSvg(character));
  return parent.lastElementChild;
}

/** Random blinks every few seconds; returns a stop function. */
export function startBlinking(el) {
  let timer;
  const loop = () => {
    timer = setTimeout(() => { el.classList.add('blink'); setTimeout(() => el.classList.remove('blink'), 130); loop(); }, 2200 + Math.random() * 3200);
  };
  loop();
  return () => clearTimeout(timer);
}
