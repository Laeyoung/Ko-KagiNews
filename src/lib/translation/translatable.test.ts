import { describe, expect, it } from 'vitest';
import type { Story } from '$lib/types';
import { applySegments, extractCitations, extractSegments } from './translatable';

function baseStory(overrides: Partial<Story> = {}): Story {
	return {
		cluster_number: 1,
		category: 'world',
		title: 'Original title [example.com#1]',
		short_summary: 'Summary',
		articles: [],
		...overrides,
	} as Story;
}

describe('extractSegments', () => {
	it('extracts simple, array, and nested whitelist fields with correct paths', () => {
		const story = baseStory({
			talking_points: ['a', 'b'],
			timeline: [{ content: 'c0', date: '2026-01-01', date_iso: '2026-01-01' } as any],
			suggested_qna: [{ question: 'q', answer: 'ans' } as any],
			primary_image: { url: 'http://x/y.png', caption: 'cap' },
		});
		const paths = extractSegments(story).map((s) => s.path);
		expect(paths).toEqual(
			expect.arrayContaining([
				'title',
				'short_summary',
				'talking_points[0]',
				'talking_points[1]',
				'timeline[0].content',
				'suggested_qna[0].question',
				'suggested_qna[0].answer',
				'primary_image.caption',
			]),
		);
	});

	it('never extracts excluded fields', () => {
		const story = baseStory({ emoji: '🌍', quote_author: 'Jane' });
		const paths = extractSegments(story).map((s) => s.path);
		expect(paths).not.toContain('emoji');
		expect(paths).not.toContain('quote_author');
		expect(paths).not.toContain('category');
	});

	it('handles user_action_items mixed string/object items', () => {
		const story = baseStory({
			user_action_items: ['do X', { text: 'do Y' } as any],
		});
		const paths = extractSegments(story).map((s) => s.path);
		expect(paths).toContain('user_action_items[0]');
		expect(paths).toContain('user_action_items[1].text');
	});

	it('skips unknown array-item shapes instead of failing', () => {
		const story = baseStory({ user_action_items: [{ weird: 1 } as any] });
		const paths = extractSegments(story).map((s) => s.path);
		expect(paths).not.toContain('user_action_items[0]');
		expect(paths).not.toContain('user_action_items[0].text');
	});
});

describe('applySegments', () => {
	it('round-trips: apply(base, {path: ko}) sets exactly those paths, preserving shape', () => {
		const story = baseStory({
			talking_points: ['a', 'b'],
			user_action_items: ['do X', { text: 'do Y' } as any],
			timeline: [{ content: 'c0', date: '2026-01-01', date_iso: '2026-01-01' } as any],
		});
		const translated = {
			title: '번역 제목 [example.com#1]',
			'talking_points[1]': '나',
			'user_action_items[0]': '엑스',
			'user_action_items[1].text': '와이',
			'timeline[0].content': '내용',
		};
		const out = applySegments(story, translated) as Story;
		expect(out.title).toBe('번역 제목 [example.com#1]');
		expect(out.talking_points).toEqual(['a', '나']);
		expect(out.user_action_items?.[0]).toBe('엑스');
		expect(out.user_action_items?.[1]).toEqual({ text: '와이' });
		expect((out.timeline?.[0] as any).content).toBe('내용');
		expect((out.timeline?.[0] as any).date).toBe('2026-01-01'); // sibling preserved
		expect(story.title).toBe('Original title [example.com#1]'); // base not mutated
	});

	it('ignores unknown paths', () => {
		const story = baseStory();
		const out = applySegments(story, { 'does.not.exist[3]': 'x' }) as Story;
		expect(out.title).toBe(story.title);
	});

	it('never writes a real-but-non-whitelisted field or a garbage-prefixed path', () => {
		const story = baseStory({ emoji: '🌍', articles: [{ link: 'http://x/y' } as any] });
		const out = applySegments(story, {
			emoji: '지구', // excluded field must not be overwritten
			'articles[0].link': 'http://evil', // excluded nested field
			'1title': '접두사쓰레기', // anchored regex rejects garbage prefix
		}) as Story;
		expect(out.emoji).toBe('🌍');
		expect((out.articles?.[0] as any).link).toBe('http://x/y');
		expect(out.title).toBe(story.title);
	});

	it('never scalar-clobbers an array/object container via a bare (indexless) path', () => {
		const story = baseStory({
			talking_points: ['a', 'b'],
			primary_image: { url: 'http://x/y.png', caption: 'cap' },
		});
		const out = applySegments(story, {
			talking_points: 'x', // bare path for an array field must be ignored (would break .map/.length)
			primary_image: 'y', // bare path for an object field must be ignored
		}) as Story;
		expect(out.talking_points).toEqual(['a', 'b']);
		expect(out.primary_image).toEqual({ url: 'http://x/y.png', caption: 'cap' });
	});

	it('never clobbers a nested-array item or writes a non-allowed sub-key', () => {
		const story = baseStory({
			timeline: [{ content: 'c0', date: '2026-01-01', date_iso: '2026-01-01' } as any],
			suggested_qna: [{ question: 'q', answer: 'ans' } as any],
			primary_image: { url: 'http://x/y.png', caption: 'cap' },
		});
		const out = applySegments(story, {
			'timeline[0]': 'x', // bare-index into an object-array must not replace the item
			'timeline[0].date_iso': '침범', // non-translatable sibling must not be written
			'suggested_qna[0]': 'y', // bare-index into an object-array must not replace the item
			'primary_image.url': 'http://evil', // non-allowed sub-key must not be written
		}) as Story;
		expect(out.timeline?.[0]).toEqual({
			content: 'c0',
			date: '2026-01-01',
			date_iso: '2026-01-01',
		});
		expect(out.suggested_qna?.[0]).toEqual({ question: 'q', answer: 'ans' });
		expect((out.primary_image as any).url).toBe('http://x/y.png');
	});
});

describe('extractCitations', () => {
	it('returns all bracket markers including duplicates', () => {
		expect(extractCitations('a [x#1] b [common] c [x#1]')).toEqual(['[x#1]', '[common]', '[x#1]']);
	});
	it('returns [] when none', () => {
		expect(extractCitations('no markers')).toEqual([]);
	});
});
