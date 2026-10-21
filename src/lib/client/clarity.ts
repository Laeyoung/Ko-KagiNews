import { browser, dev } from '$app/environment';

/**
 * Microsoft Clarity (heatmaps + session recordings).
 *
 * The official snippet is an inline `<script>`; it is written out here instead
 * so the tag can be gated per environment. `app.html` would run it everywhere,
 * including local dev, the CI smoke/Lighthouse run, and preview deployments —
 * all of which are `dev === false` and would land in the production project.
 *
 * Loading therefore requires an explicit `VITE_CLARITY_ENABLED=true` at build
 * time, which should be set on the production environment only. (`VITE_*`
 * matches the prefix this repo already uses in `.env.development`; SvelteKit's
 * `$env/dynamic/public` is not readable from jsdom unit tests and
 * `$env/static/public` breaks the build when the variable is absent.)
 *
 * Replay masking depends on the masking mode configured in the Clarity
 * dashboard; this project assumes **Strict**. Balanced only masks real form
 * fields, so the surfaces below carry an explicit `data-clarity-mask="true"`
 * (masks the node and its descendants) as defense-in-depth that survives a
 * dashboard switch away from Strict:
 *
 * - the contenteditable search box + filter chips (`SearchInput.svelte`)
 * - the query echoed in the results header, plus each result title and snippet
 *   (`SearchResults.svelte`) — the whole node, because Clarity preserves a
 *   masked node's position and length, so masking only the `<mark>` run would
 *   still reveal the query as an offset+length into public story text
 * - content-filter keyword chips, both in settings (`SettingsFilters.svelte`)
 *   and in the feed's blur-warning overlay (`story/StoryCard.svelte`)
 * - pasted feed URLs, their error text, the generated snippet, custom category
 *   names, and decline reasons (`contribute/`, incl. `ContributeHistory.svelte`)
 * - validation errors quoting a pasted source URL (`ReportButton.svelte`)
 *
 * Caveat: the attribute masks a node's *contents*. Whether Clarity also redacts
 * attribute values such as `title`/`aria-label` is undocumented, so avoid
 * putting user input in tooltips on recorded surfaces.
 *
 * This is not an exhaustive audit of every user-entered surface — add the
 * attribute when introducing UI that renders user input outside a form field.
 */
export const CLARITY_PROJECT_ID = 'xugmq96v5p';

const SCRIPT_ID = 'ms-clarity';

/** Upper bound on the pre-load queue so a blocked tag cannot grow it forever. */
const MAX_QUEUED_CALLS = 100;

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

declare global {
	interface Window {
		clarity?: ClarityFn;
	}
}

/** Whether the tag may load in the current environment. */
export function isClarityEnabled(): boolean {
	return browser && !dev && import.meta.env.VITE_CLARITY_ENABLED === 'true';
}

/**
 * Injects the Clarity tag once. No-op on the server, in dev, when
 * `VITE_CLARITY_ENABLED` is not `'true'`, and when the tag is already present.
 */
export function initClarity(
	projectId: string = import.meta.env.VITE_CLARITY_PROJECT_ID || CLARITY_PROJECT_ID,
): void {
	if (!isClarityEnabled() || !projectId) return;
	if (document.getElementById(SCRIPT_ID)) return;

	// Command queue stub — load-bearing, do not remove as "unused": the tag at
	// /tag/{id} calls `window.clarity("metadata", …)` as its very first
	// statement and then `clarity.q.unshift(clarity.q.pop())`, so it needs both
	// the function and a real `q` array to already exist. Calls buffered here
	// are replayed by the tag once it loads.
	// Keep a reference so a failed load only tears down our own stub, never a
	// real `window.clarity` installed by an already-loaded tag.
	let stub: ClarityFn | undefined;
	if (!window.clarity) {
		const clarity: ClarityFn = (...args: unknown[]) => {
			clarity.q ??= [];
			if (clarity.q.length >= MAX_QUEUED_CALLS) return;
			clarity.q.push(args);
		};
		stub = clarity;
		window.clarity = clarity;
	}

	const script = document.createElement('script');
	script.id = SCRIPT_ID;
	script.async = true;
	script.src = `https://www.clarity.ms/tag/${projectId}`;
	// Blocked by an ad blocker or offline: drop the script node and the stub so
	// nothing keeps buffering calls that will never be replayed.
	script.onerror = () => {
		script.remove();
		if (stub && window.clarity === stub) {
			window.clarity = undefined;
		}
	};
	document.head.appendChild(script);
}
