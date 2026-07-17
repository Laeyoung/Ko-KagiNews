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

/**
 * Currently-expanded cards, each with a probe that reports whether the card is
 * visible enough to own the button right now. Used to hand the button off on
 * release without waiting for a future IntersectionObserver callback (which
 * would not fire for an already-visible sibling when no scroll happens).
 */
type VisibilityProbe = () => boolean;
const candidates = new Map<string, VisibilityProbe>();

/** Register an expanded card as a hand-off candidate. */
export function registerFloatingCandidate(id: string, isVisible: VisibilityProbe): void {
	candidates.set(id, isVisible);
}

/** Remove a card from the hand-off candidate set (on collapse/unmount). */
export function unregisterFloatingCandidate(id: string): void {
	candidates.delete(id);
}

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

/**
 * Release active, but only if this id currently holds it. Before falling back
 * to null, hand off to another currently-visible expanded card so the button
 * does not vanish until the next scroll (e.g. closing the active card in
 * expand-all mode while a sibling is already on screen).
 */
export function releaseFloatingStory(id: string): void {
	if (state.activeId !== id) return;
	for (const [candidateId, isVisible] of candidates) {
		if (candidateId !== id && isVisible()) {
			state.activeId = candidateId;
			return;
		}
	}
	state.activeId = null;
}
