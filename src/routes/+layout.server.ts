import locales from '$lib/locales';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	// Load default Korean locale
	return {
		locale: 'ko',
		strings: locales.ko,
	};
};
