import type { Story } from '$lib/types';

export type Segment = { path: string; text: string };

const SIMPLE_STRING_FIELDS = [
	'title',
	'short_summary',
	'did_you_know',
	'quote',
	'quote_attribution',
	'location',
	'geopolitical_context',
	'historical_background',
	'humanitarian_impact',
	'economic_implications',
	'future_outlook',
	'business_angle_text',
	'league_standings',
	'diy_tips',
	'design_principles',
	'user_experience_impact',
	'destination_highlights',
	'culinary_significance',
] as const;

const STRING_ARRAY_FIELDS = [
	'talking_points',
	'international_reactions',
	'key_players',
	'technical_details',
	'business_angle_points',
	'scientific_significance',
	'travel_advisory',
	'performance_statistics',
	'gameplay_mechanics',
	'industry_impact',
	'gaming_industry_impact',
	'technical_specifications',
] as const;

// Nested object-array fields: field name -> which sub-keys are translatable
const NESTED_ARRAY_FIELDS: Record<string, string[]> = {
	perspectives: ['text'],
	timeline: ['content'],
	suggested_qna: ['question', 'answer'],
};

const NESTED_OBJECT_FIELDS: Record<string, string[]> = {
	primary_image: ['caption'],
	secondary_image: ['caption'],
};

export function extractSegments(story: Story): Segment[] {
	const segments: Segment[] = [];
	const push = (path: string, value: unknown) => {
		if (typeof value === 'string' && value.length > 0) segments.push({ path, text: value });
	};
	const rec = story as unknown as Record<string, unknown>;

	for (const field of SIMPLE_STRING_FIELDS) push(field, rec[field]);

	for (const field of STRING_ARRAY_FIELDS) {
		const arr = rec[field];
		if (Array.isArray(arr))
			arr.forEach((v, i) => {
				push(`${field}[${i}]`, v);
			});
	}

	// Mixed array: user_action_items — string OR { text: string }
	const uai = rec.user_action_items;
	if (Array.isArray(uai)) {
		uai.forEach((item, i) => {
			if (typeof item === 'string') push(`user_action_items[${i}]`, item);
			else if (
				item &&
				typeof item === 'object' &&
				typeof (item as Record<string, unknown>).text === 'string'
			)
				push(`user_action_items[${i}].text`, (item as Record<string, unknown>).text);
			// unknown shapes: skip (left English)
		});
	}

	for (const [field, subKeys] of Object.entries(NESTED_ARRAY_FIELDS)) {
		const arr = rec[field];
		if (Array.isArray(arr)) {
			arr.forEach((item, i) => {
				if (item && typeof item === 'object') {
					for (const key of subKeys)
						push(`${field}[${i}].${key}`, (item as Record<string, unknown>)[key]);
				}
			});
		}
	}

	for (const [field, subKeys] of Object.entries(NESTED_OBJECT_FIELDS)) {
		const obj = rec[field];
		if (obj && typeof obj === 'object') {
			for (const key of subKeys) push(`${field}.${key}`, (obj as Record<string, unknown>)[key]);
		}
	}

	return segments;
}

// Anchored (^...$) so a garbage-prefixed path like "1talking_points[0]" or a
// trailing-junk path does NOT partial-match a real field. Combined with the
// whitelist guard below, a malformed or non-translatable path in the sidecar
// can never mutate an arbitrary Story property (defense in depth on the apply side —
// validatePaths already guards the write side, but applySegments is shared and
// reads sidecar files from disk).
const PATH_TOKEN = /^([a-z_]+)(?:\[(\d+)\])?(?:\.([a-z_]+))?$/i;

// setPath validates a path's FULL SHAPE against the field's declared kind, not just the
// top-level name. Each kind accepts exactly one path shape; anything else is a no-op. This
// guarantees a corrupt/tampered sidecar can never scalar-clobber a container (e.g. bare
// "talking_points" or "timeline[0]") nor overwrite a non-translatable sibling (e.g.
// "primary_image.url", "timeline[0].date_iso") — both would break `.map()`/`.length`/date
// consumers and violate the "translation layer must never cause a service failure" constraint.
const SIMPLE_STRING_FIELD_SET = new Set<string>(SIMPLE_STRING_FIELDS);
const STRING_ARRAY_FIELD_SET = new Set<string>(STRING_ARRAY_FIELDS);

export function applySegments(base: object, translated: Record<string, string>): object {
	const clone = structuredClone(base) as Record<string, unknown>;
	for (const [path, value] of Object.entries(translated)) {
		setPath(clone, path, value);
	}
	return clone;
}

function setPath(root: Record<string, unknown>, path: string, value: string): void {
	const m = PATH_TOKEN.exec(path);
	if (!m) return;
	const [, field, indexStr, subKey] = m;
	const hasIndex = indexStr !== undefined;

	// Simple string field: bare `field` only.
	if (SIMPLE_STRING_FIELD_SET.has(field)) {
		if (hasIndex || subKey) return;
		root[field] = value;
		return;
	}

	// String array field: `field[i]`, no subKey.
	if (STRING_ARRAY_FIELD_SET.has(field)) {
		if (!hasIndex || subKey) return;
		const arr = root[field];
		if (!Array.isArray(arr)) return;
		const idx = Number(indexStr);
		if (idx < 0 || idx >= arr.length) return;
		arr[idx] = value;
		return;
	}

	// Mixed array: `user_action_items[i]` (string item) or `user_action_items[i].text` (object item).
	if (field === 'user_action_items') {
		if (!hasIndex || (subKey && subKey !== 'text')) return;
		const arr = root[field];
		if (!Array.isArray(arr)) return;
		const idx = Number(indexStr);
		if (idx < 0 || idx >= arr.length) return;
		const item = arr[idx];
		if (item && typeof item === 'object') {
			(item as Record<string, unknown>).text = value; // preserve {text} object shape (with or without .text in path)
		} else if (!subKey) {
			arr[idx] = value; // string item — reject a `.text` path against a string item
		}
		return;
	}

	// Nested object-array field: `field[i].<subKey>` where subKey is an allowed sub-key.
	const nestedArrKeys = Object.hasOwn(NESTED_ARRAY_FIELDS, field)
		? NESTED_ARRAY_FIELDS[field]
		: undefined;
	if (nestedArrKeys) {
		if (!hasIndex || !subKey || !nestedArrKeys.includes(subKey)) return;
		const arr = root[field];
		if (!Array.isArray(arr)) return;
		const idx = Number(indexStr);
		if (idx < 0 || idx >= arr.length) return;
		const item = arr[idx];
		if (item && typeof item === 'object') (item as Record<string, unknown>)[subKey] = value;
		return;
	}

	// Nested object field: `field.<subKey>` (no index) where subKey is an allowed sub-key.
	const nestedObjKeys = Object.hasOwn(NESTED_OBJECT_FIELDS, field)
		? NESTED_OBJECT_FIELDS[field]
		: undefined;
	if (nestedObjKeys) {
		if (hasIndex || !subKey || !nestedObjKeys.includes(subKey)) return;
		const obj = root[field];
		if (obj && typeof obj === 'object' && !Array.isArray(obj))
			(obj as Record<string, unknown>)[subKey] = value;
		return;
	}

	// Unknown/non-whitelisted field — ignore.
}

export function extractCitations(text: string): string[] {
	return text.match(/\[[^\]]+\]/g) ?? [];
}

export type ValidationResult = { ok: boolean; reason?: string };

export function extractHtmlTags(text: string): string[] {
	return text.match(/<[^>]*>/g) ?? [];
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

export function validatePaths(requested: string[], returned: string[]): ValidationResult {
	const req = new Set(requested);
	const ret = new Set(returned);
	if (req.size !== ret.size) return { ok: false, reason: 'path_set_mismatch' };
	for (const p of req) if (!ret.has(p)) return { ok: false, reason: 'path_set_mismatch' };
	return { ok: true };
}

export function validateCitations(sourceText: string, translatedText: string): ValidationResult {
	return multisetEqual(extractCitations(sourceText), extractCitations(translatedText))
		? { ok: true }
		: { ok: false, reason: 'citation_mismatch' };
}

export function validateHtmlTags(sourceText: string, translatedText: string): ValidationResult {
	const srcTags = extractHtmlTags(sourceText);
	const outTags = extractHtmlTags(translatedText);
	// If the source had no angle brackets at all, the translation must not introduce any.
	if (!sourceText.includes('<') && (translatedText.includes('<') || translatedText.includes('>')))
		return { ok: false, reason: 'html_injected' };
	return multisetEqual(srcTags, outTags)
		? { ok: true }
		: { ok: false, reason: 'html_tag_mismatch' };
}

export function validateLengthRatio(sourceText: string, translatedText: string): ValidationResult {
	if (sourceText.length === 0) return { ok: true };
	const ratio = translatedText.length / sourceText.length;
	return ratio >= 0.25 && ratio <= 3.0 ? { ok: true } : { ok: false, reason: 'length_ratio' };
}
