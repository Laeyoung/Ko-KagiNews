import { describe, expect, it } from 'vitest';
import { formatTimelineDate } from './formatTimelineDate';

describe('formatTimelineDate ko (CJK)', () => {
	it('full date same year → "7월 12일"', () => {
		expect(formatTimelineDate('2025-07-12', 'fallback', 'ko', 2025)).toBe('7월 12일');
	});
	it('full date different year → "2024년 7월 12일"', () => {
		expect(formatTimelineDate('2024-07-12', 'fallback', 'ko', 2025)).toBe('2024년 7월 12일');
	});
	it('month precision different year → "2022년 2월"', () => {
		expect(formatTimelineDate('2022-02', 'fallback', 'ko', 2025)).toBe('2022년 2월');
	});
	it('en regression: full date same year stays day-first', () => {
		expect(formatTimelineDate('2025-07-12', 'fallback', 'en', 2025)).toBe('12 July');
	});
	it('invalid iso falls back to originalDate', () => {
		expect(formatTimelineDate('nonsense', 'ORIG', 'ko', 2025)).toBe('ORIG');
	});
});
