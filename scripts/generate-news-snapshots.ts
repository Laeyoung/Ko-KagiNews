// Run in the translation workflow, never at request time or during a Vercel build.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { applyTranslations } from '../src/lib/translation/applyTranslations';
import type { Sidecar } from '../src/lib/server/translations';

const root = process.env.TRANSLATIONS_DIR ?? 'data/translations';
const out = 'data/news-snapshots';
const api = process.env.KITE_API_BASE ?? 'https://kite.kagi.com/api';
const uuid = /^[a-f0-9-]{36}$/i;
await fs.mkdir(out, { recursive: true });
const retained = new Set<string>();
let failures = 0;
for (const batch of await fs.readdir(root)) {
	if (!uuid.test(batch)) continue;
	for (const file of await fs.readdir(path.join(root, batch))) {
		if (!uuid.test(file.replace(/\.json$/, ''))) continue;
		const raw = await fs.readFile(path.join(root, batch, file), 'utf8');
		const sidecar: Sidecar = JSON.parse(raw);
		if (sidecar.batchId !== batch || `${sidecar.categoryUuid}.json` !== file) continue;
		const name = `${batch}_${sidecar.categoryUuid}.json`;
		retained.add(name);
		const target = path.join(out, name);
		const sourceHash = createHash('sha256').update(raw).digest('hex');
		try {
			const existing = JSON.parse(await fs.readFile(target, 'utf8'));
			if (existing.sourceHash === sourceHash) continue;
		} catch { /* First snapshot. */ }
		try {
			const response = await fetch(`${api}/batches/${batch}/categories/${sidecar.categoryUuid}/stories?limit=12&lang=en`, {
				signal: AbortSignal.timeout(30_000),
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const body = await response.json();
			if (body.batchId !== batch || !Array.isArray(body.stories) || !body.stories.length) {
				throw new Error('Invalid batch stories response');
			}
			const snapshot = { sourceHash, body: applyTranslations(body, sidecar) };
			await fs.writeFile(`${target}.tmp`, JSON.stringify(snapshot));
			await fs.rename(`${target}.tmp`, target);
			console.log(`[snapshots] generated ${name}`);
		} catch (error) {
			// Do not publish a snapshot based on a superseded sidecar.
			await fs.rm(target, { force: true });
			failures++;
			console.error(`[snapshots] ${name}:`, error);
		}
	}
}
for (const name of await fs.readdir(out)) {
	if (name.endsWith('.json') && !retained.has(name)) await fs.rm(path.join(out, name));
}
if (failures) process.exitCode = 1;
