// Prunes old batch sidecar dirs so the repo (and the Vercel server bundle)
// stays small. Keeps the KEEP newest batches by the max createdAt found in
// each dir's JSON files — git checkouts reset mtimes, so file times are
// useless here.
import fs from 'node:fs';
import path from 'node:path';
import { selectBatchDirsToPrune } from './prune-helpers';
import type { BatchDirInfo } from './prune-helpers';

const TRANSLATIONS_DIR = process.env.TRANSLATIONS_DIR ?? './data/translations';
const KEEP = 7;

function newestCreatedAt(batchDir: string): number | null {
	let newest: number | null = null;
	for (const name of fs.readdirSync(batchDir)) {
		if (!name.endsWith('.json') || name.includes('.tmp.')) continue;
		try {
			const raw = JSON.parse(fs.readFileSync(path.join(batchDir, name), 'utf-8')) as {
				createdAt?: string;
			};
			const ts = raw.createdAt ? Date.parse(raw.createdAt) : Number.NaN;
			if (!Number.isNaN(ts) && (newest === null || ts > newest)) newest = ts;
		} catch {
			// unparseable file — ignore; dir may still be dated by its siblings
		}
	}
	return newest;
}

function main(): void {
	if (!fs.existsSync(TRANSLATIONS_DIR)) {
		console.log(`[prune-translations] ${TRANSLATIONS_DIR} missing — nothing to prune`);
		return;
	}
	const dirs: BatchDirInfo[] = fs
		.readdirSync(TRANSLATIONS_DIR, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => ({
			name: entry.name,
			newestCreatedAt: newestCreatedAt(path.join(TRANSLATIONS_DIR, entry.name)),
		}));
	const doomed = selectBatchDirsToPrune(dirs, KEEP);
	for (const name of doomed) {
		fs.rmSync(path.join(TRANSLATIONS_DIR, name), { recursive: true, force: true });
		console.log(`[prune-translations] removed ${name}`);
	}
	console.log(`[prune-translations] kept ${dirs.length - doomed.length}, removed ${doomed.length}`);
}

main();
