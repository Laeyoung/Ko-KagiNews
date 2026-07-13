import type { RequestHandler } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';
import { fetchUpstreamJSON, GET as proxyGET } from '$lib/server/proxy';
import {
	applyChaosTranslation,
	readChaosSidecar,
	translationsEnabled,
	wantsKorean,
} from '$lib/server/translations';

const ENDPOINT = '/batches/latest/chaos';
const proxy = proxyGET(ENDPOINT);

let latestMemo: { id: string; at: number } | null = null;
async function resolveLatestBatchId(url: URL): Promise<string | null> {
	if (latestMemo && Date.now() - latestMemo.at < 60_000) return latestMemo.id;
	const res = await fetchUpstreamJSON('/batches/latest', {}, new URL(url.origin));
	if (!res.ok) return null;
	const id = (res.body as { id?: string }).id;
	if (id) latestMemo = { id, at: Date.now() };
	return id ?? null;
}

export const GET: RequestHandler = async (event) => {
	const lang = event.url.searchParams.get('lang');
	if (!translationsEnabled() || !wantsKorean(lang)) return proxy(event);
	const upstream = await fetchUpstreamJSON(ENDPOINT, {}, event.url);
	if (!upstream.ok) return proxy(event);
	try {
		const body = upstream.body as { chaosLastUpdated?: string };
		const batchId = await resolveLatestBatchId(event.url);
		const sidecar = batchId ? await readChaosSidecar(batchId) : null;
		if (sidecar && sidecar.chaosLastUpdated === body.chaosLastUpdated)
			return json(applyChaosTranslation(body as any, sidecar));
		return json(body);
	} catch {
		return proxy(event);
	}
};
