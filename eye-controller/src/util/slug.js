/** Label -> safe file-name part: lowercase letters, digits, dash and underscore only. */
export const slug = label => (label || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
