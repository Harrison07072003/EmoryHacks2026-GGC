import { describe, expect, it } from 'vitest';
import { isCommercialOk, isLicenseAllowed, parseLicense } from '../src/services/archive/licenses.js';

describe('license parsing', () => {
  it('reads CC licenses with their terms and version', () => {
    expect(parseLicense('http://creativecommons.org/licenses/by-nc-sa/3.0/')).toMatchObject({ ok: true, kind: 'cc', code: 'by-nc-sa', version: '3.0', nc: true, sa: true, nd: false, name: 'CC BY-NC-SA 3.0' });
    expect(parseLicense('https://www.creativecommons.org/licenses/by/4.0/legalcode')).toMatchObject({ ok: true, code: 'by', nc: false, nd: false });
  });

  it('reads public domain forms', () => {
    expect(parseLicense('http://creativecommons.org/publicdomain/zero/1.0/')).toMatchObject({ ok: true, kind: 'pd', code: 'cc0', name: 'CC0 1.0' });
    expect(parseLicense('https://creativecommons.org/publicdomain/mark/1.0/')).toMatchObject({ ok: true, kind: 'pd', code: 'pd' });
    expect(parseLicense('http://creativecommons.org/licenses/publicdomain/')).toMatchObject({ ok: true, kind: 'pd' });
  });

  it('rejects unknown or malformed licenses', () => {
    expect(parseLicense('').ok).toBe(false);
    expect(parseLicense(undefined).ok).toBe(false);
    expect(parseLicense('https://example.com/licenses/by/4.0').ok).toBe(false);
    expect(parseLicense('http://creativecommons.org/licenses/sampling+/1.0/').ok).toBe(false);
    expect(parseLicense('http://creativecommons.org/licenses/nc/1.0/').ok).toBe(false);   // no BY term
  });
});

describe('license filtering', () => {
  const by = 'http://creativecommons.org/licenses/by/4.0/', bySa = 'http://creativecommons.org/licenses/by-sa/3.0/';
  const byNc = 'http://creativecommons.org/licenses/by-nc/4.0/', byNd = 'http://creativecommons.org/licenses/by-nd/4.0/';
  const byNcNd = 'http://creativecommons.org/licenses/by-nc-nd/4.0/', cc0 = 'http://creativecommons.org/publicdomain/zero/1.0/';

  it('always excludes NoDerivatives', () => {
    for (const allowNonCommercial of [false, true]) {
      expect(isLicenseAllowed(byNd, { allowNonCommercial })).toBe(false);
      expect(isLicenseAllowed(byNcNd, { allowNonCommercial })).toBe(false);
    }
  });

  it('excludes NonCommercial by default and allows it behind the flag', () => {
    expect(isLicenseAllowed(byNc)).toBe(false);
    expect(isLicenseAllowed(byNc, { allowNonCommercial: true })).toBe(true);
  });

  it('allows BY, BY-SA and public domain', () => {
    for (const l of [by, bySa, cc0]) expect(isLicenseAllowed(l)).toBe(true);
    expect(isLicenseAllowed('garbage')).toBe(false);
  });

  it('marks commercial use', () => {
    expect(isCommercialOk(by)).toBe(true);
    expect(isCommercialOk(cc0)).toBe(true);
    expect(isCommercialOk(byNc)).toBe(false);
    expect(isCommercialOk('')).toBe(false);
  });
});
