/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function isNonnegativeNumber(value) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validate the fields needed to safely reuse/publish/render a public snapshot.
 * Optional story enrichments remain extensible; they are not a second API schema.
 * This module must stay framework-free: the offline Node build imports it too.
 * @param {unknown} value
 * @param {string} batchId
 * @param {string} categoryId
 * @returns {value is import('../types').BatchStoriesResponse}
 */
export function isNewsSnapshotBody(value, batchId, categoryId) {
	return (
		isRecord(value) &&
		value.batchId === batchId &&
		value.categoryId === categoryId &&
		typeof value.categoryName === 'string' &&
		isNonnegativeNumber(value.timestamp) &&
		isNonnegativeNumber(value.readCount) &&
		isNonnegativeNumber(value.totalStories) &&
		Array.isArray(value.domains) &&
		Array.isArray(value.stories) &&
		value.stories.length > 0 &&
		value.stories.every(
			(story) =>
				isRecord(story) &&
				typeof story.id === 'string' &&
				story.id.trim().length > 0 &&
				typeof story.title === 'string' &&
				typeof story.short_summary === 'string' &&
				Array.isArray(story.articles),
		)
	);
}
