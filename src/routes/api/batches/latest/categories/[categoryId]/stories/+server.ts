import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { fetchUpstreamJSON, GET as proxyGET } from '$lib/server/proxy';
import {
	applyTranslations,
	readSidecar,
	translationsEnabled,
	wantsKorean,
} from '$lib/server/translations';

const ENDPOINT = '/batches/latest/categories/[categoryId]/stories';
const proxy = proxyGET(ENDPOINT);

export const GET: RequestHandler = async (event) => {
	const lang = event.url.searchParams.get('lang');
	if (!translationsEnabled() || !wantsKorean(lang)) return proxy(event);
	const upstream = await fetchUpstreamJSON(
		ENDPOINT,
		{ categoryId: event.params.categoryId },
		event.url,
	);
	if (!upstream.ok) return proxy(event);
	try {
		const body = upstream.body as { batchId?: string };
		const sidecar = body.batchId ? await readSidecar(body.batchId, event.params.categoryId!) : null;
		return json(sidecar ? applyTranslations(body as any, sidecar) : body);
	} catch {
		return proxy(event);
	}
};
