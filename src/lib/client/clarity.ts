import { browser, dev } from '$app/environment';

/**
 * Microsoft Clarity (heatmaps + session recordings).
 *
 * The official snippet is an inline `<script>`; this is the same thing written
 * out so it can live in the app bundle instead of `app.html` and stay disabled
 * during local development.
 */
export const CLARITY_PROJECT_ID = 'xugmq96v5p';

const SCRIPT_ID = 'ms-clarity';

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

declare global {
	interface Window {
		clarity?: ClarityFn;
	}
}

/**
 * Injects the Clarity tag once. No-op on the server, in dev, and on repeat
 * calls (client-side navigation re-running layout init).
 */
export function initClarity(projectId: string = CLARITY_PROJECT_ID): void {
	if (!browser || dev || !projectId) return;
	if (document.getElementById(SCRIPT_ID)) return;

	// Command queue stub: `clarity(...)` calls made before the tag finishes
	// loading are buffered here and replayed by the tag itself.
	if (!window.clarity) {
		const clarity: ClarityFn = (...args: unknown[]) => {
			clarity.q ??= [];
			clarity.q.push(args);
		};
		window.clarity = clarity;
	}

	const script = document.createElement('script');
	script.id = SCRIPT_ID;
	script.async = true;
	script.src = `https://www.clarity.ms/tag/${projectId}`;
	document.head.appendChild(script);
}
