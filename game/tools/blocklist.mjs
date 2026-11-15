// Read/write src/config/content-blocklist.json for the Node tools.
import { readFile, writeFile } from 'node:fs/promises';
import { compileBlocklist } from '../src/services/archive/content-filter.js';

export const BLOCKLIST_FILE = new URL('../src/config/content-blocklist.json', import.meta.url);

export const readBlocklist = async () => JSON.parse(await readFile(BLOCKLIST_FILE, 'utf8'));
export const loadBlocklist = async () => compileBlocklist(await readBlocklist());
export const writeBlocklist = data => writeFile(BLOCKLIST_FILE, `${JSON.stringify(data, null, 2)}\n`);
