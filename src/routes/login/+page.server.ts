import { fail, redirect } from '@sveltejs/kit';
import { validatePassword, validateUsername } from '#lib/server/auth/password.js';
import { consumeLoginAttempt } from '#lib/server/auth/shared-rate-limit.js';
import { isGoogleEnabled, isPasskeyEnabled, signInWithUsername } from '#lib/server/auth/session.js';
import type { Actions, PageServerLoad } from './$types';

function mapOAuthError(errorCode: string | null): string | null {
	if (!errorCode) return null;
	if (
		errorCode === 'signup_disabled' ||
		errorCode === 'account_not_linked' ||
		errorCode === 'unable_to_create_user'
	) {
		return 'This Google account is not linked to a geim account. Sign in with your password and link it in account settings first.';
	}
	return 'Google sign-in was cancelled or could not be completed. Try again.';
}

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		redirect(303, '/');
	}
	return {
		passkeyEnabled: isPasskeyEnabled(),
		googleEnabled: isGoogleEnabled(),
		oauthError: mapOAuthError(url.searchParams.get('error'))
	};
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

		const user = await signInWithUsername(username.value, check.value, request, cookies);
		if (!user) {
			return fail(401, { error: 'Invalid username or password.' });
		}

		redirect(303, '/');
	}
};
