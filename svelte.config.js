import { readFileSync } from 'node:fs';
import adapterNode from '@sveltejs/adapter-node';
import adapterVercel from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { buildCspDirectives } from './src/lib/server/csp.js';

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
		// See src/lib/server/csp.js for the rationale behind each directive.
		csp: {
			mode: 'hash',
			directives: buildCspDirectives(
				readFileSync(new URL('./src/app.html', import.meta.url), 'utf8'),
			),
		},
	},
};

export default config;
