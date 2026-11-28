/**
 * Clarity cookies don't affect public batch data. Drop only those known analytics
 * cookies before forwarding or deciding CDN eligibility; keep all auth/unknown
 * cookies, including Vercel's preview authentication cookie.
 */
export function publicRequestHeaders(request: Request, pathname: string): Headers {
	const headers = new Headers(request.headers);
	if (
		request.method !== 'GET' ||
		!(pathname === '/api/batches' || pathname.startsWith('/api/batches/'))
	)
		return headers;
	const cookie = headers.get('cookie');
	if (!cookie) return headers;
	const remaining = cookie
		.split(';')
		.map((part) => part.trim())
		.filter((part) => {
			const name = part.split('=', 1)[0];
			return name !== '_clck' && name !== '_clsk';
		})
		.join('; ');
	if (remaining) headers.set('cookie', remaining);
	else headers.delete('cookie');
	return headers;
}
