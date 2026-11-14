import { describe, expect, it } from 'vitest';
import { safeName } from '../scripts/save-recordings-plugin.mjs';

describe('recording file names', () => {
  it('keeps labels readable and can never escape the recordings folder', () => {
    expect(safeName('Jon dim glasses')).toBe('jon-dim-glasses');
    expect(safeName('../../etc/passwd')).toBe('etc-passwd');
    expect(safeName('')).toBe('session');
    expect(safeName('///')).toBe('session');
    expect(safeName('a'.repeat(200))).toHaveLength(60);
  });
});
