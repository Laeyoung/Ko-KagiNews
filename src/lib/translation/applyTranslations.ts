import type { Sidecar } from '../server/translations';
import type { BatchStoriesResponse, Story } from '../types';
import { applySegments } from './translatable';

export function applyTranslations(
	body: BatchStoriesResponse,
	sidecar: Sidecar,
): BatchStoriesResponse {
	if (!body?.stories) return body;
	const stories = body.stories.map((story) => {
		if (story.sourceLanguage === 'ko') return story; // native-Korean guard
		const entry = story.id ? sidecar.stories[story.id] : undefined;
		if (!entry) return story;
		const merged = applySegments(story, entry) as Story;
		merged.selectedLanguage = 'ko';
		merged.translationAvailable = true;
		merged.translationInfo = { model: sidecar.model, translatedAt: sidecar.createdAt };
		return merged;
	});
	return { ...body, stories };
}
