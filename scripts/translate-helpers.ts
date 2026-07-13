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

/** §4.3 step 0 lock state machine: given an existing lock, decide what to do with it. */
export type LockVerdict = 'stale' | 'already_running' | 'hang';

export function lockVerdict(o: {
	pidAlive: boolean;
	fingerprintMatch: boolean;
	fingerprintKnown: boolean;
	ageMs: number;
	maxAgeMs: number;
}): LockVerdict {
	// Dead pid, unreadable/unknown fingerprint, or a fingerprint mismatch (pid
	// reuse) all mean we can't confirm this is the same still-running process.
	if (!o.pidAlive || !o.fingerprintKnown || !o.fingerprintMatch) return 'stale';
	// Confirmed same process — branch strictly on lock age. Never collapse this
	// to "same process -> already_running"; the hang guard must stay reachable.
	return o.ageMs <= o.maxAgeMs ? 'already_running' : 'hang';
}

/**
 * Per-id merge decision for the sidecar rewrite (§4.2/§4.3). A just-applied fix
 * ensures that under `--force`, a re-translation failure on a story that already
 * had a good prior translation KEEPS that prior translation instead of deleting
 * it (no English regression) — 'record_failure_keep_prior' is that guard.
 */
export type MergeAction =
	| 'write_new'
	| 'record_failure_keep_prior'
	| 'record_failure_drop'
	| 'noop';

export function mergeStoryAction(o: { hasNew: boolean; hasFailure: boolean; hadPrior: boolean }): MergeAction {
	if (o.hasNew) return 'write_new';
	if (o.hasFailure) return o.hadPrior ? 'record_failure_keep_prior' : 'record_failure_drop';
	return 'noop';
}
