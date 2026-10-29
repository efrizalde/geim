import { fail, redirect } from '@sveltejs/kit';
import { validatePassword, validateUsername } from '#lib/server/auth/password.js';
import { consumeLoginAttempt } from '#lib/server/auth/shared-rate-limit.js';
import {
	createAppSession,
	setSessionCookie,
	verifyUserCredentials
} from '#lib/server/auth/session.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) {
		redirect(303, '/');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		let clientKey = 'global';
		try {
			clientKey = getClientAddress();
		} catch {
			// Fallback if client address isn't available in test/proxy context
		}

		const formData = await request.formData();
		const username = validateUsername(formData.get('username'));
		const password = formData.get('password');
		try {
			const ipAllowed = await consumeLoginAttempt('ip', clientKey);
			const userAllowed = username.ok ? await consumeLoginAttempt('user', username.value) : true;
			if (!ipAllowed || !userAllowed)
				return fail(429, { error: 'Too many sign-in attempts. Try again in a minute.' });
		} catch {
			return fail(503, { error: 'Sign-in is temporarily unavailable. Try again later.' });
		}

		const check = validatePassword(password);
		if (!username.ok || !check.ok) {
			return fail(400, { error: 'Invalid username or password.' });
		}

		const user = await verifyUserCredentials(username.value, check.value);
		if (!user) {
			return fail(401, { error: 'Invalid username or password.' });
		}

		const session = await createAppSession(user.id);
		setSessionCookie(cookies, session.token, session.expiresAt);

		redirect(303, '/');
	}
};
