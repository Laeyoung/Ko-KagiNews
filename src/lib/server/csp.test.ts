import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCspDirectives, CLARITY_SCRIPT_SOURCES, inlineScriptHashes } from './csp.js';

const appHtml = readFileSync('src/app.html', 'utf8');
const sha256 = (s: string) => `sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}`;

describe('inlineScriptHashes', () => {
	it('hashes the exact body of attribute-less inline scripts only', () => {
		const html = '<script>a()</script><script src="/x.js"></script><script>\n b()\n</script>';
		expect(inlineScriptHashes(html)).toEqual([sha256('a()'), sha256('\n b()\n')]);
	});

	it('finds the theme script in app.html', () => {
		// app.html ships one inline script (dark-mode flash guard). If this count
		// changes, check the new script is meant to run under the CSP.
		expect(inlineScriptHashes(appHtml)).toHaveLength(1);
	});
});

describe('buildCspDirectives', () => {
	const d = buildCspDirectives(appHtml);
	const scriptSrc = d['script-src'] as string[];

	it('allows the app.html inline script by hash', () => {
		for (const h of inlineScriptHashes(appHtml)) expect(scriptSrc).toContain(h);
	});

	it('allows Clarity to load its tag and send data', () => {
		for (const src of CLARITY_SCRIPT_SOURCES) expect(scriptSrc).toContain(src);
		expect(CLARITY_SCRIPT_SOURCES).toContain('https://*.clarity.ms');
		expect(d['connect-src']).toEqual(expect.arrayContaining(['self', 'https:']));
	});

	it('never permits inline or eval script execution', () => {
		expect(scriptSrc).not.toContain('unsafe-inline');
		expect(scriptSrc).not.toContain('unsafe-eval');
		expect(scriptSrc).not.toContain('https:');
		expect(scriptSrc).not.toContain('*');
	});

	it('locks down plugins, base URI and framing', () => {
		expect(d['object-src']).toEqual(['none']);
		expect(d['base-uri']).toEqual(['self']);
		expect(d['frame-ancestors']).toEqual(['self']);
	});
});
