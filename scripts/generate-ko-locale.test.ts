import { describe, it, expect, vi } from 'vitest';

// generate-ko-locale.ts (and the gemini-client.ts it imports) construct a
// `new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })` at module top
// level. Under vitest's jsdom environment, @google/genai's browser client path
// throws synchronously when no API key is set ("API key must be set when
// running in a browser"). We only need the pure validators/merge helper here,
// so stub the SDK to a no-op shape — this never touches real network/config.
vi.mock('@google/genai', () => ({
	GoogleGenAI: class {
		constructor(_opts: unknown) {}
	},
	HarmBlockThreshold: { BLOCK_NONE: 'BLOCK_NONE' },
	HarmCategory: {
		HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
		HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
		HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
		HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
	},
	Type: { ARRAY: 'ARRAY', OBJECT: 'OBJECT', STRING: 'STRING' },
}));

import {
	validatePlaceholders,
	validateBrandTerms,
	validateLocaleString,
	mergeRequeueOutcomes,
	type ChunkOutcome,
} from './generate-ko-locale';

describe('validatePlaceholders', () => {
	it('ok when the {{mustache}} multiset matches exactly', () => {
		expect(validatePlaceholders('Hello {{name}}, you have {{count}} items', '안녕 {{name}}, {{count}}개').ok).toBe(
			true,
		);
	});

	it('ok when the single-brace {token} multiset matches exactly', () => {
		expect(validatePlaceholders('Showing articles from {source}', '{source}에서 기사 표시 중').ok).toBe(true);
	});

	it('fails when a {count} placeholder is dropped from the translation', () => {
		const result = validatePlaceholders('{count} selected', '선택됨');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('placeholder_mismatch');
	});

	it('fails when a placeholder is translated instead of copied verbatim', () => {
		// Model translates the token text itself (e.g. {count} -> {개수}) instead of
		// copying it byte-for-byte — this must be caught, not silently accepted.
		const result = validatePlaceholders('{count} selected', '{개수} 선택됨');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('placeholder_mismatch');
	});

	it('fails on a double-brace vs single-brace mismatch for the same token name', () => {
		const result = validatePlaceholders('{{name}}', '{name}');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('placeholder_mismatch');
	});

	it('fails when placeholder count differs (duplicated or dropped)', () => {
		const result = validatePlaceholders('{{a}} and {{a}}', '{{a}}');
		expect(result.ok).toBe(false);
	});

	it('ok when there are no placeholders on either side', () => {
		expect(validatePlaceholders('Settings', '설정').ok).toBe(true);
	});
});

describe('validateBrandTerms', () => {
	it('ok when "Kagi" is preserved unchanged', () => {
		expect(validateBrandTerms('Welcome to Kagi News', 'Kagi 뉴스에 오신 것을 환영합니다').ok).toBe(true);
	});

	it('fails when "Kagi" is missing from the translation', () => {
		const result = validateBrandTerms('Welcome to Kagi News', '뉴스에 오신 것을 환영합니다');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('brand_term_dropped');
	});

	it('fails when "Kagi" is transliterated/translated away', () => {
		const result = validateBrandTerms('Kagi News', '카기 뉴스');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('brand_term_dropped');
	});

	it('ok when the source has no brand term at all', () => {
		expect(validateBrandTerms('Settings', '설정').ok).toBe(true);
	});

	it('does not match a substring that merely contains "Kagi"-like text without word boundaries', () => {
		// "Kagillion" is not the brand term "Kagi" — sourceCount should be 0 so this
		// passes regardless of what the translation contains.
		expect(validateBrandTerms('Kagillion things', '완전 다른 텍스트').ok).toBe(true);
	});
});

describe('validateLocaleString', () => {
	it('passes clean Korean with matching placeholders and no HTML', () => {
		expect(validateLocaleString('Showing {count} articles from Kagi', '{count}개 기사 표시 중 (Kagi)').ok).toBe(
			true,
		);
	});

	it('rejects HTML injected where the source had none', () => {
		const result = validateLocaleString('Click to continue', '<img src=x onerror=alert(1)>계속하려면 클릭');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('html_injected');
	});

	it('rejects a placeholder mismatch even when HTML and brand terms are fine', () => {
		const result = validateLocaleString('{count} of Kagi items', 'Kagi 항목');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('placeholder_mismatch');
	});

	it('rejects a dropped brand term even when placeholders and HTML are fine', () => {
		const result = validateLocaleString('{count} items from Kagi', '{count}개 항목');
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('brand_term_dropped');
	});

	it('preserves existing HTML tags unchanged as ok', () => {
		expect(validateLocaleString('Read <strong>more</strong>', '<strong>더</strong> 읽기').ok).toBe(true);
	});
});

describe('mergeRequeueOutcomes', () => {
	it('a key failing pass 1 but passing pass 2 ends up in translated, not failures', () => {
		const first: ChunkOutcome = {
			translated: { keyA: '가' },
			failures: [{ key: 'keyB', reason: 'placeholder_mismatch' }],
		};
		const second: ChunkOutcome = {
			translated: { keyB: '나' },
			failures: [],
		};
		const merged = mergeRequeueOutcomes(first, second);
		expect(merged.translated).toEqual({ keyA: '가', keyB: '나' });
		expect(merged.failures).toEqual([]);
	});

	it('a key failing both passes ends up reported as a failure, never in translated', () => {
		const first: ChunkOutcome = {
			translated: {},
			failures: [{ key: 'keyC', reason: 'brand_term_dropped' }],
		};
		const second: ChunkOutcome = {
			translated: {},
			failures: [{ key: 'keyC', reason: 'brand_term_dropped' }],
		};
		const merged = mergeRequeueOutcomes(first, second);
		expect(merged.translated).toEqual({});
		expect(merged.failures).toEqual([{ key: 'keyC', reason: 'brand_term_dropped' }]);
	});

	it('reports only second-pass failures, not stale first-pass ones for keys not retried', () => {
		// Regression guard: the merge must use second.failures as the source of
		// truth (keys that failed twice), not first.failures U second.failures —
		// otherwise a key that failed pass 1 but succeeded on retry could still
		// show up in the final failure report alongside being in `translated`.
		const first: ChunkOutcome = {
			translated: {},
			failures: [{ key: 'keyD', reason: 'placeholder_mismatch' }],
		};
		const second: ChunkOutcome = {
			translated: { keyD: '다' },
			failures: [],
		};
		const merged = mergeRequeueOutcomes(first, second);
		expect(merged.failures).toEqual([]);
		expect(merged.translated).toEqual({ keyD: '다' });
	});
});
