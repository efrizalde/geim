import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const ALLOWED_HOST = 'media.valorant-api.com';

/**
 * Same-origin media relay strictly restricted to `https://media.valorant-api.com/*`
 * so Three.js WebGL textures & alpha-silhouette inspection work without CORS tainting.
 */
export const GET: RequestHandler = async ({ url }) => {
	const rawTarget = url.searchParams.get('url')?.trim();
	if (!rawTarget) {
		error(400, 'Missing url parameter');
	}

	let parsed: URL;
	try {
		parsed = new URL(rawTarget);
	} catch {
		error(400, 'Invalid url parameter');
	}

	if (
		parsed.protocol !== 'https:' ||
		parsed.hostname !== ALLOWED_HOST ||
		parsed.port ||
		parsed.username ||
		parsed.password
	) {
		error(403, 'Disallowed media host');
	}

	const upstream = await fetch(parsed.toString(), {
		redirect: 'error',
		signal: AbortSignal.timeout(10_000)
	});

	if (!upstream.ok) {
		error(upstream.status, 'Upstream asset unavailable');
	}

	const contentType = upstream.headers.get('content-type') ?? 'image/png';
	if (!contentType.startsWith('image/')) {
		error(415, 'Unsupported media type');
	}

	return new Response(upstream.body, {
		status: 200,
		headers: {
			'Content-Type': contentType,
			'Cache-Control': 'public, max-age=86400, immutable'
		}
	});
};
