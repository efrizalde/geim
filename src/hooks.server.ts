import { building } from '$app/env';
import { json, redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { getAuth, resolveRequestSession } from '#lib/server/auth/session.js';
import { safeErrorMessage } from '#lib/server/crypto/redact.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.sessionId = null;

	const { pathname } = event.url;
	if (
		(pathname.startsWith('/share/') || pathname === '/api/valorant-media') &&
		(event.request.method === 'GET' || event.request.method === 'HEAD')
	) {
		return resolve(event);
	}

	if (pathname === '/api/auth' || pathname.startsWith('/api/auth/')) {
		return svelteKitHandler({ auth: getAuth(), event, resolve, building });
	}

	const validated = await resolveRequestSession(event);
	if (validated) {
		event.locals.user = validated.user;
		event.locals.sessionId = validated.session.id;
	}

	if (event.locals.user) {
		if (pathname === '/onboarding' || pathname === '/login' || pathname === '/register') {
			redirect(303, '/');
		}
		return resolve(event);
	}

	if (pathname.startsWith('/api/')) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	if (pathname !== '/login' && pathname !== '/register' && pathname !== '/onboarding') {
		redirect(303, '/login');
	}

	return resolve(event);
};

export const handleError: HandleServerError = ({ error }) => {
	console.error('[geim server error]', safeErrorMessage(error));
	return {
		message: 'An unexpected server error occurred.'
	};
};
