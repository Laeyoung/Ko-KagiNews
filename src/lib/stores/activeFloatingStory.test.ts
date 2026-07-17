import { beforeEach, describe, expect, it } from 'vitest';
import {
	activeFloatingStoryId,
	claimFloatingStoryIfFree,
	nextFloatingStoryId,
	releaseFloatingStory,
	setActiveFloatingStory,
} from './activeFloatingStory.svelte.js';

beforeEach(() => {
	const cur = activeFloatingStoryId();
	if (cur) releaseFloatingStory(cur);
});

describe('activeFloatingStory store', () => {
	it('nextFloatingStoryId returns unique ids', () => {
		const a = nextFloatingStoryId();
		const b = nextFloatingStoryId();
		expect(a).not.toBe(b);
	});

	it('claimFloatingStoryIfFree only claims when free', () => {
		expect(activeFloatingStoryId()).toBeNull();
		claimFloatingStoryIfFree('a');
		expect(activeFloatingStoryId()).toBe('a');
		claimFloatingStoryIfFree('b'); // occupied → no-op
		expect(activeFloatingStoryId()).toBe('a');
	});

	it('setActiveFloatingStory overrides unconditionally', () => {
		claimFloatingStoryIfFree('a');
		setActiveFloatingStory('b');
		expect(activeFloatingStoryId()).toBe('b');
	});

	it('releaseFloatingStory clears only when id matches', () => {
		setActiveFloatingStory('a');
		releaseFloatingStory('b'); // not active → no-op
		expect(activeFloatingStoryId()).toBe('a');
		releaseFloatingStory('a'); // active → cleared
		expect(activeFloatingStoryId()).toBeNull();
	});
});
