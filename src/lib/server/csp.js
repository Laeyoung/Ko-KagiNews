// @ts-check
import { createHash } from 'node:crypto';

/**
 * Content-Security-Policy for every SSR page, fed to `kit.csp` in
 * `svelte.config.js`. Plain JS (not TS) because the config is loaded by Node
 * directly.
 *
 * Why it exists: the Clarity loader (`src/lib/client/clarity.ts`) pulls further
 * Microsoft scripts at runtime, so SRI is impossible. `script-src` is the
 * directive that actually bounds it — only same-origin bundles, the hashed
 * inline scripts, and Clarity's hosts may execute.
 *
 * `mode: 'hash'` (not nonce/auto): pages get `s-maxage` from
 * `hooks.server.ts`, and a nonce baked into a CDN-cached response is replayed
 * to every visitor, which defeats it. SvelteKit hashes its own hydration
 * script; the inline theme script in `app.html` is hashed here.
 *
 * Deliberately broad, with reasons:
 * - `connect-src https:` — `imagePreloader` fetches story images from
 *   arbitrary publisher hosts, plus wikipedia/wikidata/github/cloudflare.
 * - `img-src https:` — same arbitrary story images, crypto icons, Clarity's
 *   `c.bing.com` pixel.
 * - `style-src 'unsafe-inline'` — Svelte transitions inject `<style>` and
 *   components use `style=` attributes.
 * - `blob:` in `script-src` — the TTS AudioWorklet is loaded from a Blob URL
 *   (`speech-utils.ts`); minting one already requires script execution.
 *
 * Clarity hosts per https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-csp
 * (`*.clarity.ms` + `c.bing.com`).
 */

export const CLARITY_SCRIPT_SOURCES = ['https://www.clarity.ms', 'https://*.clarity.ms'];

/**
 * `'sha256-…'` sources for every attribute-less inline `<script>` in an HTML
 * template. Computed from the file at build time so editing the script cannot
 * silently desync the hash.
 * @param {string} html
 * @returns {string[]}
 */
export function inlineScriptHashes(html) {
	return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
		([, body]) => `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`,
	);
}

/**
 * @param {string} appHtml contents of `src/app.html`
 * @returns {NonNullable<NonNullable<import('@sveltejs/kit').KitConfig['csp']>['directives']>}
 */
export function buildCspDirectives(appHtml) {
	return {
		'default-src': ['self'],
		'script-src': [
			'self',
			'blob:',
			...CLARITY_SCRIPT_SOURCES,
			.../** @type {any[]} */ (inlineScriptHashes(appHtml)),
		],
		'style-src': ['self', 'unsafe-inline'],
		'img-src': ['self', 'data:', 'blob:', 'https:'],
		'font-src': ['self', 'data:'],
		'connect-src': ['self', 'https:'],
		'media-src': ['self', 'blob:'],
		'frame-src': ['self'],
		'worker-src': ['self', 'blob:'],
		'object-src': ['none'],
		'base-uri': ['self'],
		'form-action': ['self'],
		'frame-ancestors': ['self'],
	};
}
