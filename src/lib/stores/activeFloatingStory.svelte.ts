// Single source of truth for which expanded StoryCard currently owns the
// mobile floating close button. At most one card is "active" at a time, so
// only one fixed-position button is ever rendered.

let seq = 0;

/** Unique id per StoryCard instance (SSR-safe monotonic counter). */
export function nextFloatingStoryId(): string {
	seq += 1;
	return `floating-story-${seq}`;
}

const state = $state<{ activeId: string | null }>({ activeId: null });

/** Reactive read for templates/$derived. */
export function activeFloatingStoryId(): string | null {
	return state.activeId;
}

/** Claim active only if currently free (null). First-expand short-content fallback. */
export function claimFloatingStoryIfFree(id: string): void {
	if (state.activeId === null) state.activeId = id;
}

/** Unconditionally become the active card (IntersectionObserver hit). */
export function setActiveFloatingStory(id: string): void {
	state.activeId = id;
}

/** Release active back to null, but only if this id currently holds it. */
export function releaseFloatingStory(id: string): void {
	if (state.activeId === id) state.activeId = null;
}
