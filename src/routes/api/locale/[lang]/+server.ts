import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import locales from '$lib/locales';
import { GET as proxyGET } from '$lib/server/proxy';

const proxy = proxyGET('/locale/[lang]');
export const GET: RequestHandler = (event) =>
	event.params.lang === 'ko' ? json({ locale: 'ko', strings: locales.ko }) : proxy(event);
