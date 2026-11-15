import { describe, expect, it } from 'vitest';
import { checkExplicit, compileBlocklist } from '../src/services/archive/content-filter.js';
import { itemToDocuments } from '../src/services/archive/metadata.js';
import defaults from '../src/config/content-blocklist.json' with { type: 'json' };

const list = compileBlocklist(defaults);
const check = fields => checkExplicit(fields, list);

describe('explicit content detection', () => {
  it('flags explicit markers in titles, tags and descriptions', () => {
    expect(check({ title: 'Song (Explicit)' }).explicit).toBe(true);
    expect(check({ title: 'Clean title', tags: ['Parental Advisory'] }).explicit).toBe(true);
    expect(check({ title: 'x', description: '<p>Contains <b>explicit lyrics</b></p>' }).explicit).toBe(true);
    expect(check({ title: 'NSFW mix' }).explicit).toBe(true);
  });

  it('matches whole words and stems, case-insensitively and through accents', () => {
    expect(check({ title: 'Fucking Up' }).reason).toMatch(/word/);
    expect(check({ album: 'SHIT happens' }).explicit).toBe(true);
    expect(check({ title: 'Bítch' }).explicit).toBe(true);
  });

  it('does not flag innocent words that contain a blocked word', () => {
    for (const title of ['Sextet in D', 'Dickens Road', 'Scunthorpe Blues', 'Cocktail Hour', 'Peacock', 'Grape Juice', 'Classic Assessment', 'Therapist']) {
      expect(check({ title }).explicit, title).toBe(false);
    }
  });

  it('blocks listed artists and hand-excluded ids', () => {
    const custom = compileBlocklist({ artists: ['Bad Band'], ids: ['ia_x_1'] });
    expect(checkExplicit({ title: 'ok', artist: '  bad BAND ' }, custom).explicit).toBe(true);   // trimmed, any case
    expect(checkExplicit({ title: 'ok', artist: 'Bad Bandits' }, custom).explicit).toBe(false);  // exact name only
    expect(checkExplicit({ title: 'ok', id: 'ia_x_1' }, custom)).toEqual({ explicit: true, reason: 'excluded by id' });
  });

  it('works with an empty list', () => {
    expect(checkExplicit({ title: 'fuck' }, compileBlocklist())).toEqual({ explicit: false, reason: '' });
  });
});

describe('ingestion mapping with the content filter', () => {
  const item = (fileTitle, over = {}) => ({
    metadata: { identifier: 'alb', title: 'Album', creator: 'A', licenseurl: 'http://creativecommons.org/licenses/by/4.0/', subject: ['rock'], ...over },
    files: [
      { name: '1.mp3', source: 'original', format: 'VBR MP3', length: '200.0', size: '8000000', title: fileTitle },
      { name: '2.mp3', source: 'original', format: 'VBR MP3', length: '120', title: 'Fine Song' },
    ],
  });

  it('drops explicit tracks, reports their ids for removal, marks the rest is_explicit:false', () => {
    const { docs, excludedIds, skipped } = itemToDocuments(item('Shit Song'), { blocklist: list });
    expect(docs.map(d => d.title)).toEqual(['Fine Song']);
    expect(docs[0].is_explicit).toBe(false);
    expect(excludedIds).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/^explicit/);
  });

  it('drops the whole item when its description is explicit', () => {
    expect(itemToDocuments(item('Nice', { description: 'Parental advisory: explicit content' }), { blocklist: list }).docs).toEqual([]);
  });

  it('records the bitrate used for partial downloads', () => {
    const [first, second] = itemToDocuments(item('Nice'), { blocklist: list }).docs;
    expect(first.bitrate_kbps).toBe(320);   // 8,000,000 bytes over 200 s
    expect(second.bitrate_kbps).toBe(0);    // size unknown
  });
});
