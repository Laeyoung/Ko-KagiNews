import { describe, it, expect } from 'vitest';
import { isDone, failureRatePct, resolveExitCode, lockVerdict, mergeStoryAction } from './translate-helpers';

describe('isDone', () => {
	it('true when translated or terminally blocked', () => {
		expect(isDone('a', new Set(['a']), [])).toBe(true);
		expect(isDone('b', new Set(), [{ id: 'b', reason: 'blocked' }])).toBe(true);
	});
	it('false for truncated/retry_exhausted (catch-up retries them)', () => {
		expect(isDone('c', new Set(), [{ id: 'c', reason: 'truncated' }])).toBe(false);
	});
});

describe('failureRatePct', () => {
	it('0 attempted → 0', () => expect(failureRatePct(0, 0)).toBe(0));
	it('<10 attempted → null (guard)', () => expect(failureRatePct(1, 1)).toBeNull());
	it('>=10 attempted → pct', () => expect(failureRatePct(20, 5)).toBe(25));
});

describe('resolveExitCode', () => {
	it('exit 3 when over threshold', () => expect(resolveExitCode({ ratePct: 25, thresholdPct: 20, hasUnresolvedSlug: false })).toBe(3));
	it('exit 4 for unresolved slug when rate ok', () => expect(resolveExitCode({ ratePct: 0, thresholdPct: 20, hasUnresolvedSlug: true })).toBe(4));
	it('exit 3 wins when both apply', () => expect(resolveExitCode({ ratePct: 25, thresholdPct: 20, hasUnresolvedSlug: true })).toBe(3));
	it('guard (null rate) never trips exit 3', () => expect(resolveExitCode({ ratePct: null, thresholdPct: 20, hasUnresolvedSlug: false })).toBe(0));
});

describe('lockVerdict', () => {
	const base = { pidAlive: true, fingerprintMatch: true, fingerprintKnown: true, ageMs: 0, maxAgeMs: 21_600_000 };

	it('dead pid → stale', () => {
		expect(lockVerdict({ ...base, pidAlive: false })).toBe('stale');
	});
	it('alive + fingerprint mismatch → stale', () => {
		expect(lockVerdict({ ...base, fingerprintMatch: false })).toBe('stale');
	});
	it('alive + fingerprint unknown/unreadable → stale', () => {
		expect(lockVerdict({ ...base, fingerprintKnown: false, fingerprintMatch: false })).toBe('stale');
	});
	it('alive + match + young → already_running', () => {
		expect(lockVerdict({ ...base, ageMs: 1_000 })).toBe('already_running');
	});
	it('alive + match + old (>6h) → hang', () => {
		expect(lockVerdict({ ...base, ageMs: 21_600_001 })).toBe('hang');
	});
	it('alive + match + exactly at max age → already_running (boundary)', () => {
		expect(lockVerdict({ ...base, ageMs: 21_600_000 })).toBe('already_running');
	});
});

describe('mergeStoryAction', () => {
	it('hasNew → write_new (regardless of failure/prior)', () => {
		expect(mergeStoryAction({ hasNew: true, hasFailure: false, hadPrior: false })).toBe('write_new');
		expect(mergeStoryAction({ hasNew: true, hasFailure: true, hadPrior: true })).toBe('write_new');
	});
	it('failure + hadPrior → record_failure_keep_prior (regression guard)', () => {
		expect(mergeStoryAction({ hasNew: false, hasFailure: true, hadPrior: true })).toBe('record_failure_keep_prior');
	});
	it('failure + no prior → record_failure_drop', () => {
		expect(mergeStoryAction({ hasNew: false, hasFailure: true, hadPrior: false })).toBe('record_failure_drop');
	});
	it('no new, no failure → noop', () => {
		expect(mergeStoryAction({ hasNew: false, hasFailure: false, hadPrior: false })).toBe('noop');
	});
});
