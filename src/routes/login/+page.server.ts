import { fail, redirect } from '@sveltejs/kit';
import { validatePassword, validateUsername } from '#lib/server/auth/password.js';
import {
	checkLoginRateLimit,
	clearFailedLogins,
	recordFailedLogin
} from '#lib/server/auth/rate-limit.js';
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

		const rate = checkLoginRateLimit(clientKey);
		if (!rate.allowed) {
			return fail(429, {
				error: `Too many failed attempts. Try again in ${rate.retryAfterSeconds}s.`
			});
		}

		const formData = await request.formData();
		const username = validateUsername(formData.get('username'));
		const password = formData.get('password');

		const check = validatePassword(password);
		if (!username.ok || !check.ok) {
			recordFailedLogin(clientKey);
			return fail(400, { error: 'Invalid username or password.' });
		}

		const user = await verifyUserCredentials(username.value, check.value);
		if (!user) {
			recordFailedLogin(clientKey);
			return fail(401, { error: 'Invalid username or password.' });
		}

		clearFailedLogins(clientKey);
		const session = await createAppSession(user.id);
		setSessionCookie(cookies, session.token, session.expiresAt);

		redirect(303, '/');
	}
};
