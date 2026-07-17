import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	activeFloatingStoryId,
	claimFloatingStoryIfFree,
	nextFloatingStoryId,
	registerFloatingCandidate,
	releaseFloatingStory,
	setActiveFloatingStory,
	unregisterFloatingCandidate,
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
		releaseFloatingStory('a'); // active → cleared (no candidates registered)
		expect(activeFloatingStoryId()).toBeNull();
	});
});

describe('activeFloatingStory hand-off on release', () => {
	afterEach(() => {
		unregisterFloatingCandidate('a');
		unregisterFloatingCandidate('b');
		unregisterFloatingCandidate('c');
		const cur = activeFloatingStoryId();
		if (cur) {
			// Ensure a clean null after unregistering, regardless of probes.
			setActiveFloatingStory(cur);
			releaseFloatingStory(cur);
		}
	});

	it('hands the button off to a visible sibling instead of clearing', () => {
		setActiveFloatingStory('a');
		registerFloatingCandidate('a', () => true);
		registerFloatingCandidate('b', () => true); // visible sibling
		releaseFloatingStory('a');
		expect(activeFloatingStoryId()).toBe('b');
	});

	it('falls back to null when no other candidate is visible', () => {
		setActiveFloatingStory('a');
		registerFloatingCandidate('a', () => true);
		registerFloatingCandidate('b', () => false); // present but off-screen
		releaseFloatingStory('a');
		expect(activeFloatingStoryId()).toBeNull();
	});

	it('never hands off to itself', () => {
		setActiveFloatingStory('a');
		registerFloatingCandidate('a', () => true); // only candidate is the releasing card
		releaseFloatingStory('a');
		expect(activeFloatingStoryId()).toBeNull();
	});
});
