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
 * §4.3 wait mode ("발행 대기") — decides at run start whether to poll for a new
 * batch instead of proceeding with the resolved `latest`.
 *
 * GitHub Actions cron delivery is 60–90+ min late in practice, so wait-mode
 * ticks are scheduled well BEFORE the 12:00 UTC publish and then poll until the
 * new batch appears. The three proceed cases:
 * - wait mode off (waitMinutes <= 0): plain run (catch-up ticks).
 * - no local sidecar dir for latest: an untranslated batch is available NOW.
 * - local dir exists but the batch is fresh (< freshAgeMs): today's batch was
 *   already handled — don't sit waiting for tomorrow's; run the idempotent
 *   verify pass and exit.
 * Otherwise (dir exists + batch old = pre-publish morning): wait.
 */
export type WaitVerdict = 'proceed' | 'wait';

export function waitDecision(o: {
	waitMinutes: number;
	hasLocalDir: boolean;
	ageMs: number;
	freshAgeMs: number;
}): WaitVerdict {
	if (o.waitMinutes <= 0) return 'proceed';
	if (!o.hasLocalDir) return 'proceed';
	if (o.ageMs < o.freshAgeMs) return 'proceed';
	return 'wait';
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
