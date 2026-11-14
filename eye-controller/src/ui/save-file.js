// Saving JSON files from the browser: into the project folder when the dev server is
// running, otherwise as an ordinary browser download.

export function downloadJson(data, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: `${name}.json` }).click();
  URL.revokeObjectURL(url);
}

/**
 * @param kind  'recordings' | 'baselines' (the project folder it lands in)
 * @returns where it went, e.g. 'recordings/jon-dim_2026-11-14-17-02-11.json' or 'Downloads'
 */
export async function saveJson(kind, data, name = 'session') {
  try {
    const res = await fetch(`/__save/${kind}?name=${encodeURIComponent(name)}`, { method: 'POST', body: JSON.stringify(data) });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('json')) return (await res.json()).file;
  } catch { /* no dev server: fall through to a download */ }
  downloadJson(data, name);
  return 'Downloads';
}
