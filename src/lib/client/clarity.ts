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
 * fields, so user-entered text rendered outside `<input>`/`<textarea>` (the
 * contenteditable search box, content-filter keyword chips) is marked with
 * `data-clarity-mask="true"` in the markup instead of relying on that mode.
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

	// Command queue stub: `clarity(...)` calls made before the tag finishes
	// loading are buffered here and replayed by the tag itself. Keep a
	// reference so a failed load only tears down our own stub, never a real
	// `window.clarity` installed by an already-loaded tag.
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
