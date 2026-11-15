// License rules for archive tracks. Only Creative Commons and public-domain tracks are used.
//
// - NoDerivatives (ND) is ALWAYS excluded: CC 4.0 treats music synced in timed relation with
//   moving images as Adapted Material, and a note highway synced to the track arguably is one.
// - NonCommercial (NC) is excluded unless `allowNonCommercial` is set (ALLOW_NONCOMMERCIAL=true).
// - Anything we cannot recognize is excluded.

/**
 * Parse a license URL into its terms.
 * @returns {{ ok: boolean, kind: 'cc'|'pd'|null, code: string, version: string, by: boolean,
 *            nc: boolean, nd: boolean, sa: boolean, name: string, url: string }}
 */
export function parseLicense(url) {
  const raw = String(url ?? '').trim();
  const u = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
  const none = { ok: false, kind: null, code: '', version: '', by: false, nc: false, nd: false, sa: false, name: 'Unknown license', url: raw };
  if (!u.startsWith('creativecommons.org/')) return none;

  // public domain: /publicdomain/zero/1.0/, /publicdomain/mark/1.0/, legacy /licenses/publicdomain/
  const pd = u.match(/^creativecommons\.org\/(?:publicdomain\/(zero|mark)(?:\/([\d.]+))?|licenses\/publicdomain)/);
  if (pd) {
    const code = pd[1] === 'zero' ? 'cc0' : 'pd';
    return { ...none, ok: true, kind: 'pd', code, version: pd[2] ?? '', name: code === 'cc0' ? `CC0 ${pd[2] ?? '1.0'}` : 'Public Domain' };
  }

  const cc = u.match(/^creativecommons\.org\/licenses\/([a-z-]+)(?:\/([\d.]+))?/);
  if (!cc) return none;
  const parts = cc[1].split('-');
  if (!parts.every(p => ['by', 'nc', 'nd', 'sa'].includes(p)) || !parts.includes('by')) return none;
  const has = p => parts.includes(p), version = cc[2] ?? '';
  return {
    ...none, ok: true, kind: 'cc', code: cc[1], version,
    by: true, nc: has('nc'), nd: has('nd'), sa: has('sa'),
    name: `CC ${cc[1].toUpperCase()}${version ? ` ${version}` : ''}`,
  };
}

/** Whether a track with this license may be indexed and played. */
export function isLicenseAllowed(license, { allowNonCommercial = false } = {}) {
  const l = typeof license === 'string' ? parseLicense(license) : license;
  if (!l.ok || l.nd) return false;
  return allowNonCommercial || !l.nc;
}

/** Commercial use allowed (no NC term). */
export const isCommercialOk = license => {
  const l = typeof license === 'string' ? parseLicense(license) : license;
  return l.ok && !l.nc;
};

/** Attribution line shown wherever an archive song is shown or played. */
export function attributionText({ title, artist, licenseName, sourceUrl }) {
  return `"${title}" by ${artist || 'Unknown artist'} · ${licenseName}${sourceUrl ? ` · ${sourceUrl}` : ''}`;
}

/**
 * Search clause that keeps only CC / public-domain items at the archive.org search API.
 * Coarse on purpose: the exact rules (ND, NC) are applied per item with isLicenseAllowed().
 */
export const ARCHIVE_LICENSE_QUERY = 'licenseurl:*creativecommons.org*';
