export type FailedStory = { id: string; reason: 'blocked' | 'truncated' | 'retry_exhausted' };

/** §4.3 idempotency: a story is "done" if translated OR terminally blocked. */
export function isDone(id: string, translatedIds: Set<string>, failed: FailedStory[]): boolean {
	return translatedIds.has(id) || failed.some((f) => f.id === id && f.reason === 'blocked');
}

/**
 * §4.1 story-level failure rate. Returns null when the small-sample guard applies
 * (attempted < 10) — caller must NOT trip exit 3 in that case.
 */
export function failureRatePct(attempted: number, failed: number): number | null {
	if (attempted === 0) return 0;
	if (attempted < 10) return null; // small-denominator guard
	return (failed / attempted) * 100;
}

/** §4.3 step 5 exit-code resolution (exit 3 wins over exit 4 when both apply). */
export function resolveExitCode(opts: {
	ratePct: number | null;
	thresholdPct: number;
	hasUnresolvedSlug: boolean;
}): 0 | 3 | 4 {
	if (opts.ratePct !== null && opts.ratePct > opts.thresholdPct) return 3;
	if (opts.hasUnresolvedSlug) return 4;
	return 0;
}
