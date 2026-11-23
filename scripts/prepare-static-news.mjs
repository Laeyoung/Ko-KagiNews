// Offline build step: publish only snapshots matching the committed translation.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const out = 'static/news';
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
const manifest = {};
if (process.env.TRANSLATIONS_ENABLED !== 'false') {
	for (const name of await fs.readdir('data/news-snapshots').catch(() => [])) {
		if (!/^[a-f0-9-]{36}_[a-f0-9-]{36}\.json$/i.test(name)) continue;
		const [batch, category] = name.replace(/\.json$/, '').split('_');
		const snapshot = JSON.parse(await fs.readFile(`data/news-snapshots/${name}`, 'utf8'));
		const sidecar = await fs.readFile(`data/translations/${batch}/${category}.json`, 'utf8').catch(() => null);
		if (!sidecar || hash(sidecar) !== snapshot.sourceHash) continue;
		const body = JSON.stringify(snapshot.body);
		const asset = `${hash(body)}.json`;
		await fs.writeFile(`${out}/${asset}`, body);
		manifest[`${batch}/${category}`] = `/news/${asset}`;
	}
}
await fs.writeFile(`${out}/manifest.json`, JSON.stringify(manifest));
console.log(`[static-news] published ${Object.keys(manifest).length} snapshots`);
