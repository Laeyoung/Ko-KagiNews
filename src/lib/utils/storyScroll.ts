/**
 * Compute the target window scrollTop that positions a story's `.category-label`
 * just below the sticky header. Returns null if the label is not found.
 * Shared by StoryCard's open auto-scroll and the mobile floating-close scroll.
 */
export function computeCategoryScrollTop(storyElement: HTMLElement): number | null {
	const headerEl = document.querySelector('header') || document.querySelector('nav');
	const headerHeight = headerEl ? (headerEl as HTMLElement).offsetHeight : 60;
	const isMobile = window.innerWidth <= 768;
	const extraOffset = isMobile ? 8 : 12;

	const categoryElement = storyElement.querySelector('.category-label');
	if (!categoryElement) return null;

	const rect = categoryElement.getBoundingClientRect();
	const elementTop = window.pageYOffset + rect.top - 28;
	return Math.max(0, elementTop - headerHeight - extraOffset);
}
