import { describe, it, expect } from 'vitest';
import { isDone, failureRatePct, resolveExitCode } from './translate-helpers';

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
