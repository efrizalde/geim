import { json, redirect } from '@sveltejs/kit';
import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import {
	SESSION_COOKIE_NAME,
	clearSessionCookie,
	setSessionCookie,
	validateAppSessionToken
} from '#lib/server/auth/session.js';
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

	const token = event.cookies.get(SESSION_COOKIE_NAME);
	if (token) {
		const validated = await validateAppSessionToken(token);
		if (validated) {
			event.locals.user = validated.user;
			event.locals.sessionId = validated.session.id;
			setSessionCookie(event.cookies, token, validated.session.expiresAt);
		} else {
			clearSessionCookie(event.cookies);
		}
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
