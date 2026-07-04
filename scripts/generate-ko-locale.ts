// Incremental ko.json generator — see docs/korean-translation-spec.md §6.1 for
// the authoritative design (chunking, response schema, validation rules,
// re-queue-once behavior). This is a standalone CLI script (bun), separate
// from the daily news translator (scripts/translate-batch.ts / gemini-client.ts).
//
// It reuses gemini-client.ts's GoogleGenAI setup PATTERN (client init, safety
// settings, thinkingConfig, temperature 0.2, retry/backoff, Semaphore,
// TranslationError) but needs a different responseSchema (`{key, ko}[]`, same
// shape actually — see below) and a locale-specific system prompt, so the
// Gemini call is self-contained here rather than reusing translateSegments
// (which is hardwired to the news TRANSLATION_PROMPT and {path, ko} segments).
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory, Type } from '@google/genai';
import { Semaphore, TranslationError } from './gemini-client';
import { validateHtmlTags } from '../src/lib/translation/translatable';
import type { ValidationResult } from '../src/lib/translation/translatable';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LOCALES_DIR = 'src/lib/locales';
const EN_PATH = path.join(LOCALES_DIR, 'en.json');
const KO_PATH = path.join(LOCALES_DIR, 'ko.json');

const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite';
const CHUNK_SIZE = 40; // spec §6.1: ~40 keys/call (~1069 keys / 40 ≈ 27 calls)
const CONCURRENCY = 3; // mirrors translation.config.json's default concurrency
const MAX_RETRIES = 3; // network/parse-level retries per call (backoff, not validation re-queue)

type LocaleEntry = { text: string; translationContext: string };
type LocaleFile = Record<string, LocaleEntry>;

interface LocaleItem {
	key: string;
	text: string;
	translationContext: string;
}

// LOCALE_PROMPT v1 — see docs/korean-translation-spec.md §6.1.
const LOCALE_PROMPT = `You are translating UI strings (buttons, labels, tooltips, settings) for the Korean localization of a news reader app called "Kagi News". Translate each item's "text" into natural, concise Korean UI copy appropriate for its "translationContext" and return an array of {key, ko}.
Rules:
1. Use natural, concise Korean UI phrasing appropriate for buttons/labels/tooltips/settings — not literal word-for-word translation.
2. Copy placeholder tokens like {token} and {{token}} EXACTLY verbatim, character-for-character — never translate, remove, reorder, or alter the braces of a placeholder.
3. Keep brand/product names (e.g. "Kagi") unchanged — do not translate or transliterate them.
4. If the source text contains HTML tags (e.g. <a href="...">, <strong>), preserve them exactly as-is; never introduce new HTML tags into text that has none.
5. Do NOT add or omit information; keep the same tone as the source.
6. Output ONLY the specified JSON schema — no other text.`;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const RESPONSE_SCHEMA = {
	type: Type.ARRAY,
	items: {
		type: Type.OBJECT,
		properties: { key: { type: Type.STRING }, ko: { type: Type.STRING } },
		required: ['key', 'ko'],
	},
} as const;

const SAFETY_SETTINGS = [
	HarmCategory.HARM_CATEGORY_HARASSMENT,
	HarmCategory.HARM_CATEGORY_HATE_SPEECH,
	HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
	HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_NONE }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BACKOFF_MS = [2000, 8000, 30000];

// ---------------------------------------------------------------------------
// Validation (spec §6.1)
// ---------------------------------------------------------------------------

// Matches both {{mustache}} (double-brace, 75 keys) and single-brace {token}
// (5 keys: meta.categoryDescription, sources.showArticlesFrom,
// story.flashcards.selectedCount, story.simplify.autoSimplifying/tooltipActive).
const PLACEHOLDER_REGEX = /\{\{?\s*[\w.]+\s*\}?\}/g;
// Matches literal "Kagi" as a brand term (word-boundaried so it doesn't match substrings).
const BRAND_TERM_REGEX = /\bKagi\b/g;

function extractPlaceholders(text: string): string[] {
	return text.match(PLACEHOLDER_REGEX) ?? [];
}

function multisetEqual(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const count = new Map<string, number>();
	for (const x of a) count.set(x, (count.get(x) ?? 0) + 1);
	for (const y of b) {
		const c = count.get(y);
		if (!c) return false;
		count.set(y, c - 1);
	}
	return true;
}

function validatePlaceholders(sourceText: string, translatedText: string): ValidationResult {
	return multisetEqual(extractPlaceholders(sourceText), extractPlaceholders(translatedText))
		? { ok: true }
		: { ok: false, reason: 'placeholder_mismatch' };
}

function validateBrandTerms(sourceText: string, translatedText: string): ValidationResult {
	const sourceCount = (sourceText.match(BRAND_TERM_REGEX) ?? []).length;
	if (sourceCount === 0) return { ok: true };
	const translatedCount = (translatedText.match(BRAND_TERM_REGEX) ?? []).length;
	return translatedCount >= sourceCount ? { ok: true } : { ok: false, reason: 'brand_term_dropped' };
}

/** Runs all §6.1 per-key checks (placeholders, HTML tags, brand terms). */
function validateLocaleString(sourceText: string, translatedText: string): ValidationResult {
	const placeholderCheck = validatePlaceholders(sourceText, translatedText);
	if (!placeholderCheck.ok) return placeholderCheck;
	// validateHtmlTags (reused from translatable.ts) both enforces tag-multiset
	// equality AND rejects <, > introduced into text that had none — locale
	// strings render via {@html} in IntroScreen.svelte/KeyboardShortcutsHelp.svelte,
	// so unsolicited markup from the model is a stored-XSS vector, not just noise.
	const htmlCheck = validateHtmlTags(sourceText, translatedText);
	if (!htmlCheck.ok) return htmlCheck;
	return validateBrandTerms(sourceText, translatedText);
}

// ---------------------------------------------------------------------------
// Gemini call (network-level retry/backoff — separate from the validation
// re-queue-once handled by translateChunkWithRequeue below)
// ---------------------------------------------------------------------------

async function callOnce(items: LocaleItem[], model: string, maxOutputTokens: number) {
	return ai.models.generateContent({
		model,
		contents: JSON.stringify(items.map(({ key, text, translationContext }) => ({ key, text, translationContext }))),
		config: {
			systemInstruction: LOCALE_PROMPT,
			temperature: 0.2,
			maxOutputTokens,
			thinkingConfig: { thinkingBudget: 0 },
			safetySettings: SAFETY_SETTINGS,
			responseMimeType: 'application/json',
			responseSchema: RESPONSE_SCHEMA,
		},
	});
}

/** Single Gemini round trip with network/parse-level retry + backoff. Throws TranslationError when exhausted or terminally blocked. */
async function requestTranslation(
	items: LocaleItem[],
	model: string,
	maxRetries: number,
): Promise<Record<string, string>> {
	let lastErr = '';
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			let res = await callOnce(items, model, 8192);
			const finish = res.candidates?.[0]?.finishReason;
			const block = res.promptFeedback?.blockReason;
			if (block || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'RECITATION')
				throw new TranslationError('blocked', `blocked: ${block ?? finish}`);
			if (finish === 'MAX_TOKENS') {
				res = await callOnce(items, model, 16384);
				const finish2 = res.candidates?.[0]?.finishReason;
				if (
					res.promptFeedback?.blockReason ||
					finish2 === 'SAFETY' ||
					finish2 === 'PROHIBITED_CONTENT' ||
					finish2 === 'RECITATION'
				)
					throw new TranslationError(
						'blocked',
						`blocked on retry: ${res.promptFeedback?.blockReason ?? finish2}`,
					);
				if (finish2 === 'MAX_TOKENS') throw new TranslationError('truncated', 'MAX_TOKENS after doubling');
			}
			const text = res.text;
			if (!text) throw new Error('empty response');
			const arr = JSON.parse(text) as { key: string; ko: string }[];
			const out: Record<string, string> = {};
			for (const { key, ko } of arr) out[key] = ko;
			return out;
		} catch (err) {
			if (err instanceof TranslationError) throw err; // terminal — no backoff retry
			lastErr = err instanceof Error ? err.message : String(err);
			if (attempt < maxRetries)
				await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] + Math.random() * 500);
		}
	}
	throw new TranslationError('retry_exhausted', lastErr);
}

interface ChunkOutcome {
	translated: Record<string, string>;
	failures: { key: string; reason: string }[];
}

/** One Gemini call over `items` + per-key §6.1 validation. No re-queue here — see translateChunkWithRequeue. */
async function translateChunkOnce(items: LocaleItem[], model: string, maxRetries: number): Promise<ChunkOutcome> {
	const translated: Record<string, string> = {};
	const failures: { key: string; reason: string }[] = [];

	let raw: Record<string, string>;
	try {
		raw = await requestTranslation(items, model, maxRetries);
	} catch (err) {
		const reason = err instanceof TranslationError ? err.reason : 'unknown_error';
		for (const item of items) failures.push({ key: item.key, reason: `request_failed:${reason}` });
		return { translated, failures };
	}

	for (const item of items) {
		const ko = raw[item.key];
		if (!ko) {
			failures.push({ key: item.key, reason: 'missing_in_response' });
			continue;
		}
		const check = validateLocaleString(item.text, ko);
		if (!check.ok) {
			failures.push({ key: item.key, reason: check.reason ?? 'validation_failed' });
			continue;
		}
		translated[item.key] = ko;
	}
	return { translated, failures };
}

/** Applies the spec §6.1 "failing keys re-queued ONCE, then reported" rule. */
async function translateChunkWithRequeue(
	items: LocaleItem[],
	model: string,
	maxRetries: number,
): Promise<ChunkOutcome> {
	const first = await translateChunkOnce(items, model, maxRetries);
	if (first.failures.length === 0) return first;

	const failedKeys = new Set(first.failures.map((f) => f.key));
	const retryItems = items.filter((i) => failedKeys.has(i.key));
	const second = await translateChunkOnce(retryItems, model, maxRetries);

	return {
		translated: { ...first.translated, ...second.translated },
		failures: second.failures, // final report — only keys that failed twice
	};
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

interface CliArgs {
	keys?: string[]; // --keys k1,k2 — force re-translation even if already present in ko.json
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--keys') {
			const raw = argv[++i] ?? '';
			args.keys = raw
				.split(',')
				.map((k) => k.trim())
				.filter(Boolean);
		}
	}
	return args;
}

// ---------------------------------------------------------------------------
// fs helpers
// ---------------------------------------------------------------------------

function readLocaleFile(filePath: string): LocaleFile {
	if (!fs.existsSync(filePath)) return {};
	try {
		return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as LocaleFile;
	} catch (err) {
		throw new Error(`failed to parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

function chunk<T>(arr: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
	return chunks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	const en = readLocaleFile(EN_PATH);
	const ko = readLocaleFile(KO_PATH);

	const forceKeys = new Set(args.keys ?? []);
	for (const k of forceKeys) {
		if (!(k in en)) console.warn(`[generate-ko-locale] --keys: '${k}' not found in en.json — ignoring`);
	}

	// --keys is a TARGETED mode: it re-translates exactly the listed keys (even
	// if already present in ko.json) and nothing else. It does not additionally
	// pull in the rest of the incremental missing-key set — that's the default
	// (no --keys) behavior below. This lets a single-key smoke run (or a fix for
	// one changed en.json label per spec §6.1's "변경 키" note) touch only the
	// keys the caller asked for, regardless of how large the missing-key backlog is.
	const keysToTranslate =
		forceKeys.size > 0
			? Object.keys(en).filter((key) => forceKeys.has(key))
			: Object.keys(en).filter((key) => !(key in ko));

	if (keysToTranslate.length === 0) {
		console.log('[generate-ko-locale] ko.json is already up to date — nothing to translate');
		return;
	}

	console.log(
		`[generate-ko-locale] ${keysToTranslate.length}/${Object.keys(en).length} key(s) to translate` +
			(forceKeys.size ? ` (${forceKeys.size} forced via --keys)` : ''),
	);

	const items: LocaleItem[] = keysToTranslate.map((key) => ({
		key,
		text: en[key].text,
		translationContext: en[key].translationContext,
	}));
	const chunks = chunk(items, CHUNK_SIZE);

	const semaphore = new Semaphore(CONCURRENCY);
	const merged: Record<string, string> = {};
	const allFailures: { key: string; reason: string }[] = [];

	await Promise.all(
		chunks.map((c, i) =>
			semaphore.run(async () => {
				const { translated, failures } = await translateChunkWithRequeue(c, GEMINI_MODEL, MAX_RETRIES);
				Object.assign(merged, translated);
				allFailures.push(...failures);
				console.log(
					`[generate-ko-locale] chunk ${i + 1}/${chunks.length}: ${Object.keys(translated).length}/${c.length} ok` +
						(failures.length ? `, ${failures.length} failed` : ''),
				);
			}),
		),
	);

	const nextKo: LocaleFile = { ...ko };
	for (const [key, koText] of Object.entries(merged)) {
		nextKo[key] = { text: koText, translationContext: en[key].translationContext };
	}
	fs.writeFileSync(KO_PATH, `${JSON.stringify(nextKo, null, 2)}\n`, 'utf-8');

	console.log(
		`[generate-ko-locale] wrote ${Object.keys(merged).length} key(s) to ${KO_PATH} (${Object.keys(nextKo).length} total)`,
	);

	if (allFailures.length > 0) {
		console.warn(`[generate-ko-locale] ${allFailures.length} key(s) failed validation after re-queue and were left untranslated (will retry next run):`);
		for (const f of allFailures) console.warn(`  - ${f.key}: ${f.reason}`);
		process.exitCode = 1;
	}
}

main().catch((err) => {
	console.error('[generate-ko-locale] unexpected error:', err instanceof Error ? (err.stack ?? err.message) : err);
	process.exit(1);
});
