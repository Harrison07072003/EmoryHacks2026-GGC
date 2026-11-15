import { describe, expect, it } from 'vitest';
import { cleanGenres, fileKey, itemToDocuments, parseLength, pickAudioFiles } from '../src/services/archive/metadata.js';
import { songsSchema } from '../src/services/search/schema.js';

// shaped like a real https://archive.org/metadata/{id} response
const item = (over = {}) => ({
  metadata: {
    identifier: 'my-album', title: 'My Album [label 001]', creator: 'Some Artist', date: '2020-01-01',
    licenseurl: 'http://creativecommons.org/licenses/by-sa/4.0/',
    subject: ['Some Artist', 'Electronic', 'ambient; techno', 'netlabels', 'mylabel'],
    collection: ['mylabel', 'netlabels'], downloads: 321, ...over.metadata,
  },
  files: over.files ?? [
    { name: '01_Intro.flac', source: 'original', format: 'Flac', length: '95.5', title: '01 Intro', creator: 'Some Artist', album: 'My Album', track: '1' },
    { name: '01_Intro.mp3', source: 'derivative', format: 'VBR MP3', length: '1:35', title: '01 Intro', creator: 'Some Artist', album: 'My Album', track: '1', original: '01_Intro.flac' },
    { name: '01_Intro.ogg', source: 'derivative', format: 'Ogg Vorbis', length: '95.4', original: '01_Intro.flac' },
    { name: '02 Big Track.mp3', source: 'original', format: '128Kbps MP3', length: '240', title: 'Big Track', genre: 'Drum & Bass', track: '2' },
    { name: '03_long_mix.mp3', source: 'original', format: 'VBR MP3', length: '45:00', track: '3' },
    { name: '04_nolength.mp3', source: 'original', format: 'VBR MP3', track: '4' },
    { name: 'cover.jpg', source: 'original', format: 'JPEG' },
    { name: '01_Intro_spectrogram.png', source: 'derivative', format: 'Spectrogram', original: '01_Intro.flac' },
  ],
});

describe('archive metadata helpers', () => {
  it('parses both length formats', () => {
    expect(parseLength('913.24')).toBe(913);
    expect(parseLength('15:13')).toBe(913);
    expect(parseLength('1:02:03')).toBe(3723);
    expect(parseLength(['200'])).toBe(200);
    expect(parseLength('')).toBe(0);
    expect(parseLength('abc')).toBe(0);
  });

  it('picks one playable file per track, preferring MP3 over OGG', () => {
    const picked = pickAudioFiles(item().files).map(f => f.name);
    expect(picked).toEqual(['01_Intro.mp3', '02 Big Track.mp3', '03_long_mix.mp3', '04_nolength.mp3']);
  });

  it('falls back to OGG when there is no MP3', () => {
    const files = [{ name: 'a.flac', source: 'original', format: 'Flac' }, { name: 'a.ogg', source: 'derivative', format: 'Ogg Vorbis', original: 'a.flac' }];
    expect(pickAudioFiles(files).map(f => f.name)).toEqual(['a.ogg']);
  });

  it('cleans genres: no artist, label, or noise tags; split lists; capped', () => {
    expect(cleanGenres({ fileGenre: 'Drum & Bass', subjects: item().metadata.subject, artist: 'Some Artist', collections: ['mylabel', 'netlabels'] }))
      .toEqual(['drum & bass', 'electronic', 'ambient', 'techno']);
  });

  it('gives stable file keys', () => {
    expect(fileKey('01_Intro.mp3')).toBe(fileKey('01_Intro.mp3'));
    expect(fileKey('01_Intro.mp3')).not.toBe(fileKey('02_Intro.mp3'));
  });
});

describe('itemToDocuments', () => {
  it('maps each playable track to a Typesense document', () => {
    const { docs, skipped } = itemToDocuments(item());
    expect(docs).toHaveLength(2);
    const [intro, big] = docs;
    expect(intro).toMatchObject({
      id: `ia_my-album_${fileKey('01_Intro.mp3')}`, title: 'Intro', artist: 'Some Artist', album: 'My Album',
      source: 'internet_archive', source_id: 'my-album/01_Intro.mp3', duration: 95, popularity: 321,
      license_url: 'http://creativecommons.org/licenses/by-sa/4.0/', license_name: 'CC BY-SA 4.0', is_commercial_ok: true,
      audio_url: 'https://archive.org/download/my-album/01_Intro.mp3', item_url: 'https://archive.org/details/my-album',
    });
    expect(intro.attribution).toBe('"Intro" by Some Artist · CC BY-SA 4.0 · https://archive.org/details/my-album');
    expect(big).toMatchObject({ title: 'Big Track', album: 'My Album [label 001]', duration: 240, audio_url: 'https://archive.org/download/my-album/02%20Big%20Track.mp3' });
    expect(big.genre[0]).toBe('drum & bass');
    expect(skipped.map(s => s.reason)).toEqual(['duration 2700s', 'unknown duration']);
  });

  it('produces only fields the collection schema knows, with the right types', () => {
    const fields = Object.fromEntries(songsSchema().fields.map(f => [f.name, f.type]));
    for (const doc of itemToDocuments(item()).docs) {
      for (const [k, v] of Object.entries(doc)) {
        if (k === 'id') { expect(typeof v).toBe('string'); continue; }
        expect(fields[k], k).toBeDefined();
        const t = fields[k];
        if (t === 'string') expect(typeof v, k).toBe('string');
        if (t === 'string[]') expect(Array.isArray(v), k).toBe(true);
        if (t === 'int32') expect(Number.isInteger(v), k).toBe(true);
        if (t === 'bool') expect(typeof v, k).toBe('boolean');
      }
      expect(doc.chart_status).toBeUndefined();   // never overwritten by ingestion
    }
  });

  it('skips the whole item when the license is not allowed', () => {
    expect(itemToDocuments(item({ metadata: { licenseurl: 'http://creativecommons.org/licenses/by-nd/4.0/' } })).docs).toEqual([]);
    expect(itemToDocuments(item({ metadata: { licenseurl: 'http://creativecommons.org/licenses/by-nc/4.0/' } })).docs).toEqual([]);
    const nc = itemToDocuments(item({ metadata: { licenseurl: 'http://creativecommons.org/licenses/by-nc/4.0/' } }), { allowNonCommercial: true }).docs;
    expect(nc).toHaveLength(2);
    expect(nc[0].is_commercial_ok).toBe(false);
  });

  it('tags FMA mirrors and links attribution to FMA', () => {
    const { docs } = itemToDocuments(item({ metadata: { source: 'http://freemusicarchive.org/music/X/Y/' } }), { source: 'fma' });
    expect(docs[0].id.startsWith('fma_my-album_')).toBe(true);
    expect(docs[0].source).toBe('fma');
    expect(docs[0].attribution.endsWith('http://freemusicarchive.org/music/X/Y/')).toBe(true);
  });

  it('reports items with no playable audio and broken input', () => {
    expect(itemToDocuments(item({ files: [{ name: 'x.zip', format: 'ZIP' }] })).skipped[0].reason).toBe('no mp3/ogg files');
    expect(itemToDocuments(null).docs).toEqual([]);
    expect(itemToDocuments({ metadata: { identifier: 'x', licenseurl: 'http://creativecommons.org/licenses/by/4.0/' } }).docs).toEqual([]);
  });

  it('makes ids safe for Typesense', () => {
    const { docs } = itemToDocuments(item({ metadata: { identifier: 'weird id/with:chars' } }));
    expect(docs[0].id).toMatch(/^[\w.-]+$/);
  });
});
