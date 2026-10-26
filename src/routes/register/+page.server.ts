import { fail, redirect } from '@sveltejs/kit';
import { validatePassword, validateUsername } from '#lib/server/auth/password.js';
import { checkLoginRateLimit, recordFailedLogin } from '#lib/server/auth/rate-limit.js';
import { createAppSession, registerUser, setSessionCookie } from '#lib/server/auth/session.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) {
		redirect(303, '/');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		let clientKey = 'register:global';
		try {
			clientKey = `register:${getClientAddress()}`;
		} catch {
			// Use the shared bucket when a proxy does not provide a client address.
		}
		const rate = checkLoginRateLimit(clientKey);
		if (!rate.allowed) {
			return fail(429, { error: `Too many attempts. Try again in ${rate.retryAfterSeconds}s.` });
		}
		recordFailedLogin(clientKey);

		const formData = await request.formData();
		const username = validateUsername(formData.get('username'));
		const password = formData.get('password');
		const confirmPassword = formData.get('confirmPassword');

		if (!username.ok) return fail(400, { error: username.error });
		const check = validatePassword(password);
		if (!check.ok) {
			return fail(400, { error: check.error });
		}

		if (typeof confirmPassword !== 'string' || confirmPassword !== check.value) {
			return fail(400, { error: 'Passwords do not match.' });
		}

		const user = await registerUser(username.value, check.value);
		if (!user) return fail(409, { error: 'That username is already taken.' });
		const session = await createAppSession(user.id);
		setSessionCookie(cookies, session.token, session.expiresAt);

		redirect(303, '/');
	}
};
