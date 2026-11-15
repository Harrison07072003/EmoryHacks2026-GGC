// The Typesense `songs` collection: one document per archive track.
// Fields set by chart generation (bpm, difficulty, chart_*) are optional, so ingestion can
// emplace documents without touching them.

export const CHART_STATUS = ['none', 'generating', 'ready', 'failed'];

export function songsSchema(name = 'songs') {
  return {
    name,
    default_sorting_field: 'popularity',
    token_separators: ['-', '_'],
    fields: [
      { name: 'title', type: 'string' },
      { name: 'artist', type: 'string' },
      { name: 'album', type: 'string', optional: true },
      { name: 'genre', type: 'string[]', facet: true, optional: true },
      { name: 'source', type: 'string', facet: true },
      { name: 'source_id', type: 'string', index: false, optional: true },
      // the archive item (album) a track belongs to: searches group by it so results are different releases
      { name: 'item_id', type: 'string', facet: true, optional: true },
      { name: 'license_url', type: 'string', facet: true },
      { name: 'license_name', type: 'string', index: false, optional: true },
      { name: 'is_commercial_ok', type: 'bool', facet: true },
      // always false in the index (explicit tracks are not ingested); every search filters on it as a
      // backup. Optional so older documents can be migrated: a missing value never matches the filter.
      { name: 'is_explicit', type: 'bool', facet: true, optional: true },
      { name: 'bitrate_kbps', type: 'int32', index: false, optional: true },
      // set by ingestion's audio check: music with a clear beat (true) -> searchable; rhythm_score = pulse contrast 0..1
      { name: 'is_song', type: 'bool', facet: true, optional: true },
      { name: 'rhythm_score', type: 'float', sort: true, optional: true },
      { name: 'attribution', type: 'string', index: false, optional: true },
      { name: 'item_url', type: 'string', index: false, optional: true },
      { name: 'duration', type: 'int32', sort: true },
      { name: 'popularity', type: 'int32', sort: true },
      { name: 'audio_url', type: 'string', index: false, optional: true },
      { name: 'bpm', type: 'float', sort: true, optional: true },
      { name: 'difficulty', type: 'int32', facet: true, optional: true },
      { name: 'chart_status', type: 'string', facet: true, optional: true },
      { name: 'chart_url', type: 'string', index: false, optional: true },
      { name: 'chart_version', type: 'int32', optional: true },
    ],
  };
}
