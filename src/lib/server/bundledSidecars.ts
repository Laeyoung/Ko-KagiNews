// Serverless (Vercel) deploys don't ship data/translations on the function
// filesystem — only statically referenced files survive nft tracing. This glob
// forces the committed sidecars into the server bundle as lazy chunks. Kept in
// its own module so tests can vi.mock the map.
export const bundledSidecars = import.meta.glob('/data/translations/*/*.json', {
	import: 'default',
}) as Record<string, () => Promise<unknown>>;
