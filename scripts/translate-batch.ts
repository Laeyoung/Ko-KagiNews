// Daily cron translator — see docs/korean-translation-spec.md §4.1–§4.3 for the
// authoritative spec (lock fingerprint state machine, idempotency rule, chaos
// handling, index.json reconstruction, exit codes). This file implements that
// spec; comments below point back to the relevant §-numbers at decision points.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { translateSegments, Semaphore, TranslationError } from './gemini-client';
import { extractSegments } from '../src/lib/translation/translatable';
import type { Segment } from '../src/lib/translation/translatable';
import {
	isDone,
	failureRatePct,
	resolveExitCode,
	lockVerdict as computeLockVerdict,
	mergeStoryAction,
	waitDecision,
} from './translate-helpers';
import type { FailedStory } from './translate-helpers';
import type { Story } from '../src/lib/types';

// ---------------------------------------------------------------------------
// Config / env
// ---------------------------------------------------------------------------

interface TranslateConfig {
	categories: string[];
	storyLimit: number;
	concurrency: number;
	maxRetries: number;
	failureThresholdPct: number;
}

const CONFIG_PATH = 'translation.config.json';
const KITE_API_BASE = process.env.KITE_API_BASE ?? 'https://kite.kagi.com/api';
const TRANSLATIONS_DIR = process.env.TRANSLATIONS_DIR ?? './data/translations';
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';

const LOCK_MAX_AGE_MS = 6 * 60 * 60 * 1000; // §4.3 step 0 — hang guard
const FRESHNESS_MAX_AGE_MS = 26 * 60 * 60 * 1000; // §4.3 step 1
// §4.3 wait mode: a latest batch younger than this is "today's" (already
// handled if its sidecar dir exists) — anything older means we're pre-publish.
// 12h splits the daily cycle: pre-publish ticks see yesterday's batch at
// 22-26h, while even a wildly delayed post-publish tick sees today's at < 12h.
const WAIT_FRESH_AGE_MS = 12 * 60 * 60 * 1000;
const WAIT_POLL_INTERVAL_MS = Number(process.env.WAIT_POLL_INTERVAL_MS ?? 30_000);

// Illustrative Flash-Lite-class pricing (spec §10) — reconfirm against Google's
// current price list before relying on this for real budgeting.
const PRICE_PER_1M_INPUT_USD = 0.1;
const PRICE_PER_1M_OUTPUT_USD = 0.4;

function loadConfig(): TranslateConfig | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
	} catch {
		return undefined;
	}
	const c = raw as Partial<TranslateConfig>;
	if (
		!c ||
		!Array.isArray(c.categories) ||
		typeof c.storyLimit !== 'number' ||
		typeof c.concurrency !== 'number' ||
		typeof c.maxRetries !== 'number' ||
		typeof c.failureThresholdPct !== 'number'
	) {
		return undefined;
	}
	return c as TranslateConfig;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
	batch?: string;
	category?: string;
	force: boolean;
	dryRun: boolean;
	limit?: number;
	waitMinutes: number;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = { force: false, dryRun: false, waitMinutes: 0 };
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case '--batch':
				args.batch = argv[++i];
				break;
			case '--category':
				args.category = argv[++i];
				break;
			case '--force':
				args.force = true;
				break;
			case '--dry-run':
				args.dryRun = true;
				break;
			case '--limit': {
				const n = Number(argv[++i]);
				if (Number.isFinite(n) && n > 0) args.limit = Math.floor(n);
				break;
			}
			case '--wait-minutes': {
				const n = Number(argv[++i]);
				if (Number.isFinite(n) && n > 0) args.waitMinutes = Math.floor(n);
				break;
			}
		}
	}
	return args;
}

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

function readJson<T>(filePath: string): T | undefined {
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
	} catch {
		return undefined;
	}
}

/** Atomic write: `<path>.tmp.<pid>` → rename (§4.2/§4.3). */
function atomicWriteJson(filePath: string, data: unknown): void {
	const tmpPath = `${filePath}.tmp.${process.pid}`;
	fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
	fs.renameSync(tmpPath, filePath);
}

function cleanupStaleTmpFiles(dir: string): void {
	if (!fs.existsSync(dir)) return;
	for (const name of fs.readdirSync(dir)) {
		if (name.includes('.tmp.')) {
			try {
				fs.unlinkSync(path.join(dir, name));
			} catch {
				// best-effort cleanup — a concurrent writer may have already removed it.
			}
		}
	}
}

async function apiGet<T>(pathAndQuery: string): Promise<T> {
	const res = await fetch(`${KITE_API_BASE}${pathAndQuery}`);
	if (!res.ok) throw new Error(`GET ${pathAndQuery} failed: ${res.status} ${res.statusText}`);
	return (await res.json()) as T;
}

function estimateTokens(charCount: number): number {
	// Rough heuristic (~2.5 chars/token blended for source news text, §4.4/§10).
	return Math.ceil(charCount / 2.5);
}

function estimateCostUsd(tokensIn: number, tokensOut: number): number {
	return (
		(tokensIn / 1_000_000) * PRICE_PER_1M_INPUT_USD + (tokensOut / 1_000_000) * PRICE_PER_1M_OUTPUT_USD
	);
}

// ---------------------------------------------------------------------------
// Step 0: concurrency lock (§4.3 step 0)
// ---------------------------------------------------------------------------

interface LockContent {
	pid: number;
	fingerprint: string;
	createdAt: number; // epoch ms
}

/**
 * Process start-time fingerprint — filters out pid reuse. Linux: field 22
 * (starttime) of /proc/<pid>/stat. Elsewhere: `ps -o lstart= -p <pid>`.
 */
function getProcessStartFingerprint(pid: number): string {
	if (process.platform === 'linux') {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf-8');
		// comm (field 2) can contain spaces/parens; split on the LAST ')' to safely
		// reach field 3 onward. starttime is field 22 overall => index 22-3=19 here.
		const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
		const fields = afterComm.trim().split(/\s+/);
		const starttime = fields[19];
		if (!starttime) throw new Error('starttime field not found in /proc stat');
		return starttime;
	}
	const out = execSync(`ps -o lstart= -p ${pid}`, { encoding: 'utf-8' });
	const trimmed = out.trim();
	if (!trimmed) throw new Error('ps returned no output for pid');
	return trimmed;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ESRCH') return false;
		// EPERM (alive, different owner) or anything else inconclusive — treat as
		// "can't confirm death" so fingerprint comparison gets the final say.
		return true;
	}
}

class ConcurrencyLock {
	private lockPath: string;
	private owns = false;

	constructor(dir: string) {
		this.lockPath = path.join(dir, '.lock');
	}

	/** Returns an exit code to use immediately (0 = already running, 1 = hung), or undefined to proceed. */
	acquire(): 0 | 1 | undefined {
		for (let attempt = 0; attempt < 2; attempt++) {
			const content: LockContent = {
				pid: process.pid,
				fingerprint: getProcessStartFingerprint(process.pid),
				createdAt: Date.now(),
			};
			try {
				fs.writeFileSync(this.lockPath, JSON.stringify(content), { flag: 'wx' });
				this.owns = true;
				return undefined;
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
			}

			const verdict = this.inspectExisting();
			if (verdict === 'stale') {
				try {
					fs.unlinkSync(this.lockPath);
				} catch {
					// another process may have already cleaned it up — retry the create.
				}
				continue;
			}
			return verdict;
		}
		console.error('[translate-batch] failed to acquire lock after retry (race) — exit 1');
		return 1;
	}

	private inspectExisting(): 'stale' | 0 | 1 {
		let existing: LockContent | undefined;
		try {
			existing = JSON.parse(fs.readFileSync(this.lockPath, 'utf-8')) as LockContent;
		} catch {
			return 'stale'; // unreadable/unparseable
		}
		if (!existing || typeof existing.pid !== 'number' || !existing.fingerprint) return 'stale';

		// Gather the I/O-derived facts, then hand the pure decision to lockVerdict()
		// (§4.3 step 0 state machine — see scripts/translate-helpers.ts).
		const pidAlive = isProcessAlive(existing.pid);
		let fingerprintKnown = false;
		let fingerprintMatch = false;
		if (pidAlive) {
			try {
				fingerprintKnown = true;
				fingerprintMatch = getProcessStartFingerprint(existing.pid) === existing.fingerprint;
			} catch {
				fingerprintKnown = false; // identity can't be confirmed
			}
		}
		const ageMs = Date.now() - existing.createdAt;

		const verdict = computeLockVerdict({
			pidAlive,
			fingerprintMatch,
			fingerprintKnown,
			ageMs,
			maxAgeMs: LOCK_MAX_AGE_MS,
		});

		if (verdict === 'stale') return 'stale';
		if (verdict === 'already_running') {
			console.log('[translate-batch] already running (lock age within normal range) — exit 0');
			return 0;
		}
		console.warn(
			`[translate-batch] lock held by pid=${existing.pid} for ${(ageMs / 3_600_000).toFixed(1)}h (> 6h) — possible hang, exit 1`,
		);
		return 1;
	}

	release(): void {
		if (!this.owns) return;
		try {
			fs.unlinkSync(this.lockPath);
		} catch {
			// already gone — fine.
		}
		this.owns = false;
	}
}

// ---------------------------------------------------------------------------
// Upstream response shapes (only the fields we use; whitelist-style, not the
// full FE `types.ts` shapes which don't declare per-category `sourceLanguage`).
// ---------------------------------------------------------------------------

interface LatestBatchResponse {
	id: string;
	createdAt: string;
}

interface RawCategory {
	id: string; // UUID
	categoryId: string; // slug
	categoryName: string;
	sourceLanguage?: string;
}

interface CategoriesResponse {
	batchId: string;
	createdAt: string;
	categories: RawCategory[];
}

interface StoriesResponse {
	stories: Story[];
}

interface ChaosResponse {
	chaosIndex?: number;
	chaosDescription?: string;
	chaosLastUpdated?: string;
}

// ---------------------------------------------------------------------------
// Sidecar schemas (§4.2)
// ---------------------------------------------------------------------------

interface CategorySidecar {
	version: 1;
	batchId: string;
	categoryUuid: string;
	categorySlug: string;
	model: string;
	createdAt: string;
	stories: Record<string, Record<string, string>>;
	stats: {
		storyCount: number;
		translated: number;
		failedStoryIds: FailedStory[];
		tokens: { in: number; out: number };
	};
}

interface ChaosSidecar {
	version: 1;
	batchId: string;
	model: string;
	createdAt: string;
	chaosLastUpdated: string;
	chaosDescription: string;
}

// index.json is bookkeeping-only (never the idempotency source, §4.2) — its
// exact shape isn't pinned by the spec, only its purpose and atomic-write rule.
interface IndexCategoryEntry {
	slug: string;
	status: 'ok' | 'skipped' | 'excluded_ko' | 'unresolved';
	storyCount: number;
	translated: number;
	failed: number;
	tokens: { in: number; out: number };
}

interface IndexFile {
	version: 1;
	batchId: string;
	updatedAt: string;
	categories: Record<string, IndexCategoryEntry>;
	chaos: { status: 'ok' | 'skipped' | 'failed' | 'unavailable' };
	run: {
		attempted: number;
		failed: number;
		failureRatePct: number | null;
		unresolvedSlugs: string[];
	};
}

function reconstructIndex(batchDir: string, batchId: string): IndexFile {
	const categories: Record<string, IndexCategoryEntry> = {};
	if (fs.existsSync(batchDir)) {
		for (const name of fs.readdirSync(batchDir)) {
			if (!name.endsWith('.json') || name === 'index.json' || name === 'chaos.json' || name.includes('.tmp.'))
				continue;
			const uuid = name.slice(0, -'.json'.length);
			const sidecar = readJson<CategorySidecar>(path.join(batchDir, name));
			if (!sidecar?.stats) continue;
			categories[uuid] = {
				slug: sidecar.categorySlug,
				status: 'ok',
				storyCount: sidecar.stats.storyCount,
				translated: sidecar.stats.translated,
				failed: sidecar.stats.failedStoryIds?.length ?? 0,
				tokens: sidecar.stats.tokens ?? { in: 0, out: 0 },
			};
		}
	}
	return {
		version: 1,
		batchId,
		updatedAt: new Date().toISOString(),
		categories,
		chaos: { status: fs.existsSync(path.join(batchDir, 'chaos.json')) ? 'ok' : 'unavailable' },
		run: { attempted: 0, failed: 0, failureRatePct: null, unresolvedSlugs: [] },
	};
}

function writeIndex(
	batchDir: string,
	batchId: string,
	categories: Record<string, IndexCategoryEntry>,
	chaosStatus: IndexFile['chaos']['status'],
	run: IndexFile['run'],
): void {
	const indexPath = path.join(batchDir, 'index.json');
	let base = readJson<IndexFile>(indexPath);
	if (!base) {
		// Covers both "missing" and "unparseable" — index.json is bookkeeping only,
		// never the idempotency source, so reconstructing it is always safe (§4.2).
		console.warn(
			'[translate-batch] index.json missing or unparseable — reconstructing from sidecars (bookkeeping only)',
		);
		base = reconstructIndex(batchDir, batchId);
	}
	const merged: IndexFile = {
		version: 1,
		batchId,
		updatedAt: new Date().toISOString(),
		categories: { ...base.categories, ...categories },
		chaos: { status: chaosStatus },
		run,
	};
	atomicWriteJson(indexPath, merged);
}

// ---------------------------------------------------------------------------
// Step 3: per-category processing
// ---------------------------------------------------------------------------

interface ProcessCategoryParams {
	batchId: string;
	batchDir: string;
	slug: string;
	uuid: string;
	storyLimit: number;
	config: TranslateConfig;
	modelId: string;
	force: boolean;
	dryRun: boolean;
}

interface ProcessCategoryResult {
	indexEntry: IndexCategoryEntry;
	attempted: number;
	failed: number;
	tokens: { in: number; out: number };
	summaryLine: string;
}

async function processCategory(p: ProcessCategoryParams): Promise<ProcessCategoryResult> {
	const storiesResp = await apiGet<StoriesResponse>(
		`/batches/${p.batchId}/categories/${p.uuid}/stories?limit=${p.storyLimit}&lang=en`,
	);
	const stories = storiesResp.stories.filter((s): s is Story & { id: string } => typeof s.id === 'string');
	const storiesById = new Map(stories.map((s) => [s.id, s]));
	const fetchedIds = stories.map((s) => s.id);

	const sidecarPath = path.join(p.batchDir, `${p.uuid}.json`);
	const existing = readJson<CategorySidecar>(sidecarPath);
	const translatedIds = new Set(existing ? Object.keys(existing.stories ?? {}) : []);
	const failedPrev: FailedStory[] = existing?.stats?.failedStoryIds ?? [];

	// Idempotency single source of truth = category sidecar (§4.3 step 3).
	const idsToTranslate = p.force
		? fetchedIds
		: fetchedIds.filter((id) => !isDone(id, translatedIds, failedPrev));

	if (p.dryRun) {
		let totalChars = 0;
		let segCount = 0;
		for (const id of idsToTranslate) {
			const story = storiesById.get(id);
			if (!story) continue;
			const segments = extractSegments(story);
			segCount += segments.length;
			for (const seg of segments) totalChars += seg.text.length;
		}
		const tokensIn = estimateTokens(totalChars);
		const tokensOut = Math.ceil(tokensIn * 1.3); // Korean output expansion heuristic, §4.4/§10.
		console.log(
			`[translate-batch] [dry-run] ${p.slug}: ${idsToTranslate.length}/${fetchedIds.length} stories to translate, ${segCount} segments, ~${tokensIn} in / ~${tokensOut} out tokens (~$${estimateCostUsd(tokensIn, tokensOut).toFixed(4)})`,
		);
		return {
			indexEntry: {
				slug: p.slug,
				status: idsToTranslate.length === 0 ? 'skipped' : 'ok',
				storyCount: fetchedIds.length,
				translated: translatedIds.size,
				failed: failedPrev.length,
				tokens: { in: 0, out: 0 },
			},
			attempted: 0,
			failed: 0,
			tokens: { in: tokensIn, out: tokensOut },
			summaryLine: `${p.slug}: [dry-run] ${idsToTranslate.length} would translate`,
		};
	}

	if (idsToTranslate.length === 0) {
		console.log(`[translate-batch] ${p.slug}: all ${fetchedIds.length} stories already done — skip (no rewrite)`);
		return {
			indexEntry: {
				slug: p.slug,
				status: 'skipped',
				storyCount: fetchedIds.length,
				translated: translatedIds.size,
				failed: failedPrev.length,
				tokens: existing?.stats?.tokens ?? { in: 0, out: 0 },
			},
			attempted: 0,
			failed: 0,
			tokens: { in: 0, out: 0 },
			summaryLine: `${p.slug}: skipped (idempotent, ${fetchedIds.length} stories)`,
		};
	}

	const semaphore = new Semaphore(p.config.concurrency);
	let runTokensIn = 0;
	let runTokensOut = 0;
	const newStories: Record<string, Record<string, string>> = {};
	const newFailed = new Map<string, FailedStory>();

	// Synchronously-dispatched per-category batch — required for the Semaphore's
	// invariant to hold (a dynamic worker pool would not preserve it).
	await Promise.all(
		idsToTranslate.map((id) =>
			semaphore.run(async () => {
				const story = storiesById.get(id);
				if (!story) return;
				const segments: Segment[] = extractSegments(story);
				if (segments.length === 0) {
					// Nothing translatable (defensive edge case) — trivially "done".
					newStories[id] = {};
					return;
				}
				try {
					// translateSegments (Task 6) already runs the §4.7 validators + the
					// single retry loop internally — we just await and record the outcome.
					const { translated, tokens } = await translateSegments(segments, {
						model: p.modelId,
						maxRetries: p.config.maxRetries,
					});
					newStories[id] = translated;
					runTokensIn += tokens.in;
					runTokensOut += tokens.out;
				} catch (err) {
					if (err instanceof TranslationError) {
						newFailed.set(id, { id, reason: err.reason });
						console.warn(`[translate-batch] ${p.slug}/${id}: ${err.reason} — ${err.message}`);
						return;
					}
					throw err;
				}
			}),
		),
	);

	// Merge into existing sidecar (§4.2/§4.3): only ids in idsToTranslate are
	// touched; everything else carries over untouched.
	const mergedStories: Record<string, Record<string, string>> = { ...(existing?.stories ?? {}) };
	const mergedFailedMap = new Map<string, FailedStory>(
		(existing?.stats?.failedStoryIds ?? []).map((f) => [f.id, f]),
	);
	for (const id of idsToTranslate) {
		const hasNew = id in newStories;
		const hasFailure = newFailed.has(id);
		const hadPrior = !!(existing?.stories && id in existing.stories);
		const action = mergeStoryAction({ hasNew, hasFailure, hadPrior });

		switch (action) {
			case 'write_new':
				mergedStories[id] = newStories[id];
				mergedFailedMap.delete(id);
				break;
			case 'record_failure_keep_prior': {
				// A prior successful translation exists. Under --force a story already
				// translated in the existing sidecar is re-attempted; if that attempt
				// fails (block/retry-exhaustion/transient), keep the previously good
				// Korean rather than regressing the served content to English.
				const failure = newFailed.get(id);
				if (failure) mergedFailedMap.set(id, failure);
				break;
			}
			case 'record_failure_drop': {
				const failure = newFailed.get(id);
				if (failure) mergedFailedMap.set(id, failure);
				delete mergedStories[id];
				break;
			}
			case 'noop':
				break;
		}
	}
	const mergedFailed = [...mergedFailedMap.values()];
	const prevTokens = existing?.stats?.tokens ?? { in: 0, out: 0 };

	const sidecar: CategorySidecar = {
		version: 1,
		batchId: p.batchId,
		categoryUuid: p.uuid,
		categorySlug: p.slug,
		// Last-writer-wins on a merge-rewrite (§4.2) — not preserved from first creation.
		model: p.modelId,
		createdAt: new Date().toISOString(),
		stories: mergedStories,
		stats: {
			storyCount: fetchedIds.length,
			translated: Object.keys(mergedStories).length,
			failedStoryIds: mergedFailed,
			tokens: { in: prevTokens.in + runTokensIn, out: prevTokens.out + runTokensOut },
		},
	};
	atomicWriteJson(sidecarPath, sidecar);

	const failedCountThisRun = idsToTranslate.filter((id) => newFailed.has(id)).length;
	console.log(
		`[translate-batch] ${p.slug}: translated ${idsToTranslate.length - failedCountThisRun}/${idsToTranslate.length} (failed ${failedCountThisRun}), tokens in=${runTokensIn} out=${runTokensOut}`,
	);

	return {
		indexEntry: {
			slug: p.slug,
			status: 'ok',
			storyCount: fetchedIds.length,
			translated: sidecar.stats.translated,
			failed: mergedFailed.length,
			tokens: sidecar.stats.tokens,
		},
		attempted: idsToTranslate.length,
		failed: failedCountThisRun,
		tokens: { in: runTokensIn, out: runTokensOut },
		summaryLine: `${p.slug}: ${idsToTranslate.length - failedCountThisRun}/${idsToTranslate.length} translated, ${failedCountThisRun} failed`,
	};
}

// ---------------------------------------------------------------------------
// Step 4: chaos
// ---------------------------------------------------------------------------

interface ProcessChaosParams {
	batchId: string;
	batchDir: string;
	modelId: string;
	maxRetries: number;
	force: boolean;
	dryRun: boolean;
}

interface ProcessChaosResult {
	status: IndexFile['chaos']['status'];
	tokens: { in: number; out: number };
}

async function processChaos(p: ProcessChaosParams): Promise<ProcessChaosResult> {
	const chaos = await apiGet<ChaosResponse>(`/batches/${p.batchId}/chaos?lang=en`);
	if (!chaos.chaosDescription || !chaos.chaosLastUpdated) {
		console.log('[translate-batch] chaos: no chaosDescription available upstream — skip');
		return { status: 'unavailable', tokens: { in: 0, out: 0 } };
	}

	const chaosPath = path.join(p.batchDir, 'chaos.json');
	const existing = readJson<ChaosSidecar>(chaosPath);
	// Idempotent on chaosLastUpdated match (§4.3 step 4) — chaos has no `stats`,
	// so the category sidecar's done() rule doesn't apply here.
	if (!p.force && existing?.chaosLastUpdated === chaos.chaosLastUpdated) {
		console.log('[translate-batch] chaos: up to date — skip');
		return { status: 'skipped', tokens: { in: 0, out: 0 } };
	}

	if (p.dryRun) {
		const tokensIn = estimateTokens(chaos.chaosDescription.length);
		const tokensOut = Math.ceil(tokensIn * 1.3);
		console.log(
			`[translate-batch] [dry-run] chaos: ${chaos.chaosDescription.length} chars, ~${tokensIn} in / ~${tokensOut} out tokens (~$${estimateCostUsd(tokensIn, tokensOut).toFixed(4)})`,
		);
		return { status: 'ok', tokens: { in: tokensIn, out: tokensOut } };
	}

	const segments: Segment[] = [{ path: 'chaosDescription', text: chaos.chaosDescription }];
	try {
		// §4.2: chaos: no citation/HTML checks — plain text, no {@html} sink.
		// Only completeness (finishReason STOP, enforced above translateSegments'
		// validation block) + non-empty + length-ratio apply to chaosDescription.
		// Without this, ordinary editorial brackets (e.g. "[sic]", "[Reuters]")
		// in chaosDescription would fail validateCitations and needlessly burn
		// the retry budget down to an English fallback.
		const { translated, tokens } = await translateSegments(segments, {
			model: p.modelId,
			maxRetries: p.maxRetries,
			skipCitationCheck: true,
			skipHtmlCheck: true,
		});
		const sidecar: ChaosSidecar = {
			version: 1,
			batchId: p.batchId,
			model: p.modelId,
			createdAt: new Date().toISOString(),
			chaosLastUpdated: chaos.chaosLastUpdated,
			chaosDescription: translated.chaosDescription ?? '',
		};
		atomicWriteJson(chaosPath, sidecar);
		console.log('[translate-batch] chaos: translated and written');
		return { status: 'ok', tokens };
	} catch (err) {
		if (err instanceof TranslationError) {
			console.warn(`[translate-batch] chaos: ${err.reason} — ${err.message} — English fallback`);
			return { status: 'failed', tokens: { in: 0, out: 0 } };
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Step 1a: wait mode (§4.3) — poll `latest` until a new batch appears
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pre-publish ticks call this to idle until the ~12:00 UTC batch shows up.
 * Returns the batch to process; on timeout returns the current latest so the
 * normal run (freshness gate + idempotent skip) decides what to do with it.
 */
async function waitForNewBatch(
	initial: LatestBatchResponse,
	waitMinutes: number,
): Promise<LatestBatchResponse> {
	const deadline = Date.now() + waitMinutes * 60_000;
	let latest = initial;
	let waiting = false;
	while (true) {
		const verdict = waitDecision({
			waitMinutes,
			hasLocalDir: fs.existsSync(path.join(TRANSLATIONS_DIR, latest.id)),
			ageMs: Date.now() - new Date(latest.createdAt).getTime(),
			freshAgeMs: WAIT_FRESH_AGE_MS,
		});
		if (verdict === 'proceed') {
			if (waiting) {
				const latencyS = (Date.now() - new Date(latest.createdAt).getTime()) / 1000;
				console.log(
					`[translate-batch] new batch detected: ${latest.id} — publish→translate-start latency ${latencyS.toFixed(0)}s`,
				);
			}
			return latest;
		}
		if (Date.now() >= deadline) {
			console.warn(
				`[translate-batch] wait mode: no new batch within ${waitMinutes}min — proceeding with current latest (idempotent run)`,
			);
			return latest;
		}
		if (!waiting) {
			waiting = true;
			console.log(
				`[translate-batch] wait mode: latest ${latest.id} already handled and > 12h old (pre-publish) — polling every ${Math.round(WAIT_POLL_INTERVAL_MS / 1000)}s for the new batch (max ${waitMinutes}min)`,
			);
		}
		await sleep(WAIT_POLL_INTERVAL_MS);
		try {
			latest = await apiGet<LatestBatchResponse>('/batches/latest');
		} catch (err) {
			// Transient upstream/network failure — keep polling until the deadline.
			console.warn(
				`[translate-batch] wait mode: poll failed (${err instanceof Error ? err.message : err}) — will retry`,
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Steps 1-5 orchestration
// ---------------------------------------------------------------------------

async function run(args: CliArgs, config: TranslateConfig): Promise<number> {
	// ---- Step 1 ----
	let batchId: string;
	let createdAt: string;
	// --batch is for explicit backfill/time-travel (§4.3 CLI table) — the 26h
	// freshness gate exists to detect "today's batch hasn't published yet" when
	// resolving `latest`, and does not apply to an operator-specified historical batch.
	let enforceFreshness = true;
	if (args.batch) {
		const batch = await apiGet<{ id: string; createdAt: string }>(`/batches/${args.batch}`);
		batchId = batch.id;
		createdAt = batch.createdAt;
		enforceFreshness = false;
	} else {
		let latest = await apiGet<LatestBatchResponse>('/batches/latest');
		if (args.waitMinutes > 0) {
			latest = await waitForNewBatch(latest, args.waitMinutes);
		}
		batchId = latest.id;
		createdAt = latest.createdAt;
	}
	// Deploy-order/timezone verification greps this exact line (§4.3) — must be
	// emitted before any category work.
	console.log(`[translate-batch] batchId=${batchId} createdAt=${createdAt}`);

	if (enforceFreshness) {
		const ageMs = Date.now() - new Date(createdAt).getTime();
		if (ageMs > FRESHNESS_MAX_AGE_MS) {
			console.error(
				`[translate-batch] latest batch is ${(ageMs / 3_600_000).toFixed(1)}h old (> 26h) — no fresh batch, exit 2`,
			);
			return 2;
		}
	}

	const batchDir = path.join(TRANSLATIONS_DIR, batchId);
	fs.mkdirSync(batchDir, { recursive: true });
	cleanupStaleTmpFiles(batchDir);

	// ---- Step 2 ----
	const categoriesResp = await apiGet<CategoriesResponse>(`/batches/${batchId}/categories?lang=en`);
	const bySlug = new Map(categoriesResp.categories.map((c) => [c.categoryId, c]));

	const targetSlugs = args.category ? [args.category] : config.categories;
	const unresolvedSlugs: string[] = [];
	const resolved: { slug: string; uuid: string }[] = [];
	const indexCategories: Record<string, IndexCategoryEntry> = {};

	for (const slug of targetSlugs) {
		const cat = bySlug.get(slug);
		if (!cat) {
			unresolvedSlugs.push(slug);
			console.warn(`[translate-batch] unresolved category slug: ${slug}`);
			continue;
		}
		if (cat.sourceLanguage === 'ko') {
			console.log(`[translate-batch] excluding native-Korean source category: ${slug}`);
			indexCategories[cat.id] = {
				slug,
				status: 'excluded_ko',
				storyCount: 0,
				translated: 0,
				failed: 0,
				tokens: { in: 0, out: 0 },
			};
			continue;
		}
		resolved.push({ slug, uuid: cat.id });
	}

	const storyLimit = args.limit ?? config.storyLimit;
	const modelId = GEMINI_MODEL;

	let attempted = 0;
	let failedThisRun = 0;
	let totalTokensIn = 0;
	let totalTokensOut = 0;
	const summaryLines: string[] = [];

	// ---- Step 3 (categories sequential; stories parallel inside processCategory) ----
	for (const { slug, uuid } of resolved) {
		const result = await processCategory({
			batchId,
			batchDir,
			slug,
			uuid,
			storyLimit,
			config,
			modelId,
			force: args.force,
			dryRun: args.dryRun,
		});
		indexCategories[uuid] = result.indexEntry;
		attempted += result.attempted;
		failedThisRun += result.failed;
		totalTokensIn += result.tokens.in;
		totalTokensOut += result.tokens.out;
		summaryLines.push(result.summaryLine);
	}

	// ---- Step 4 ----
	const chaosResult = await processChaos({
		batchId,
		batchDir,
		modelId,
		maxRetries: config.maxRetries,
		force: args.force,
		dryRun: args.dryRun,
	});
	totalTokensIn += chaosResult.tokens.in;
	totalTokensOut += chaosResult.tokens.out;

	// ---- Step 5 ----
	const ratePct = failureRatePct(attempted, failedThisRun);
	const hasUnresolvedSlug = unresolvedSlugs.length > 0;
	const exitCode = resolveExitCode({
		ratePct,
		thresholdPct: config.failureThresholdPct,
		hasUnresolvedSlug,
	});

	if (!args.dryRun) {
		writeIndex(batchDir, batchId, indexCategories, chaosResult.status, {
			attempted,
			failed: failedThisRun,
			failureRatePct: ratePct,
			unresolvedSlugs,
		});
	}

	console.log('\n[translate-batch] summary:');
	for (const line of summaryLines) console.log(`  ${line}`);
	console.log(`  chaos: ${chaosResult.status}`);
	console.log(
		`  attempted=${attempted} failed=${failedThisRun} rate=${ratePct === null ? 'n/a(<10 attempted)' : `${ratePct.toFixed(1)}%`} threshold=${config.failureThresholdPct}%`,
	);
	console.log(
		`  tokens: in=${totalTokensIn} out=${totalTokensOut} est.cost=$${estimateCostUsd(totalTokensIn, totalTokensOut).toFixed(4)}`,
	);
	if (unresolvedSlugs.length) console.log(`  unresolved slugs: ${unresolvedSlugs.join(', ')}`);
	console.log(`  exit code: ${exitCode}`);

	return exitCode;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	fs.mkdirSync(TRANSLATIONS_DIR, { recursive: true });

	const lock = new ConcurrencyLock(TRANSLATIONS_DIR);
	const lockVerdict = lock.acquire();
	if (lockVerdict !== undefined) {
		process.exit(lockVerdict);
	}

	const releaseAndExit = (code: number) => {
		lock.release();
		process.exit(code);
	};
	process.on('SIGINT', () => releaseAndExit(130));
	process.on('SIGTERM', () => releaseAndExit(143));

	let exitCode = 0;
	try {
		const config = loadConfig();
		if (!config) {
			console.error(`[translate-batch] failed to read/parse ${CONFIG_PATH} — exit 1`);
			exitCode = 1;
		} else {
			exitCode = await run(args, config);
		}
	} catch (err) {
		console.error(
			'[translate-batch] unexpected error:',
			err instanceof Error ? (err.stack ?? err.message) : err,
		);
		exitCode = 1;
	} finally {
		lock.release();
	}
	process.exit(exitCode);
}

main();
