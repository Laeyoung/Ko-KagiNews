import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// Vercel sets VERCEL=1 at build time; everywhere else (local, CI smoke
		// test via `node build`) keep the node adapter.
		adapter: process.env.VERCEL ? adapterVercel() : adapterNode(),
		csrf: {
			trustedOrigins: ['*'],
		},
	},
};

export default config;
