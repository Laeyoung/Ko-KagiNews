import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { fetchUpstreamJSON, GET as proxyGET } from '$lib/server/proxy';
import {
	applyTranslations,
	readSidecar,
	translationsEnabled,
	wantsKorean,
} from '$lib/server/translations';

const ENDPOINT = '/batches/[batchId]/categories/[categoryId]/stories';
const proxy = proxyGET(ENDPOINT);

export const GET: RequestHandler = async (event) => {
	const lang = event.url.searchParams.get('lang');
	if (!translationsEnabled() || !wantsKorean(lang)) return proxy(event);
	const batchId = event.params.batchId!;
	const categoryUuid = event.params.categoryId!;
	const upstream = await fetchUpstreamJSON(
		ENDPOINT,
		{ batchId, categoryId: categoryUuid },
		event.url,
	);
	if (!upstream.ok) return proxy(event); // non-200/parse-fail → byte passthrough
	try {
		const sidecar = await readSidecar(batchId, categoryUuid);
		const body = sidecar ? applyTranslations(upstream.body as any, sidecar) : upstream.body;
		return json(body);
	} catch {
		return proxy(event); // any overlay failure → English
	}
};
