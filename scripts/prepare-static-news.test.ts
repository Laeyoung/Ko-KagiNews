import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('publishes matching snapshots, rejects stale ones, and honors the kill switch', async () => {
	const cwd = await mkdtemp(join(tmpdir(), 'news-assets-'));
	const batch = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
	const category = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
	const script = resolve('scripts/prepare-static-news.mjs');
	try {
		await mkdir(join(cwd, `data/translations/${batch}`), { recursive: true });
		await mkdir(join(cwd, 'data/news-snapshots'), { recursive: true });
		const raw = '{"stories":{}}';
		await writeFile(join(cwd, `data/translations/${batch}/${category}.json`), raw);
		await writeFile(join(cwd, `data/news-snapshots/${batch}_${category}.json`), JSON.stringify({
			sourceHash: createHash('sha256').update(raw).digest('hex'), body: { batchId: batch, stories: [] },
		}));
		const build = (enabled = 'true') => execFileSync(process.execPath, [script], {
			cwd, env: { ...process.env, TRANSLATIONS_ENABLED: enabled },
		});
		const manifest = async () => JSON.parse(await readFile(join(cwd, 'static/news/manifest.json'), 'utf8'));
		build();
		const first = await manifest();
		expect(Object.keys(first)).toEqual([`${batch}/${category}`]);
		expect(JSON.parse(await readFile(join(cwd, `static${first[`${batch}/${category}`]}`), 'utf8')).batchId).toBe(batch);
		build('false');
		expect(await manifest()).toEqual({});
		await writeFile(join(cwd, `data/translations/${batch}/${category}.json`), '{}');
		build();
		expect(await manifest()).toEqual({});
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
