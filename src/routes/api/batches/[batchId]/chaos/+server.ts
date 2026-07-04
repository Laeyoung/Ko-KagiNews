import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { fetchUpstreamJSON, GET as proxyGET } from '$lib/server/proxy';
import {
	applyChaosTranslation,
	readChaosSidecar,
	translationsEnabled,
	wantsKorean,
} from '$lib/server/translations';

const ENDPOINT = '/batches/[batchId]/chaos';
const proxy = proxyGET(ENDPOINT);

export const GET: RequestHandler = async (event) => {
	const lang = event.url.searchParams.get('lang');
	if (!translationsEnabled() || !wantsKorean(lang)) return proxy(event);
	const batchId = event.params.batchId!;
	const upstream = await fetchUpstreamJSON(ENDPOINT, { batchId }, event.url);
	if (!upstream.ok) return proxy(event);
	try {
		const body = upstream.body as { chaosLastUpdated?: string };
		const sidecar = await readChaosSidecar(batchId);
		if (sidecar && sidecar.chaosLastUpdated === body.chaosLastUpdated)
			return json(applyChaosTranslation(body as any, sidecar));
		return json(body);
	} catch {
		return proxy(event);
	}
};
