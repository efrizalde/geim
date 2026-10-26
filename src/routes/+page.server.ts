import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { clearSessionCookie, invalidateAppSession } from '#lib/server/auth/session.js';
import { getDb, schema } from '#lib/server/db/index.js';
import { getProfileShare, publishSharedProfile } from '#lib/server/sharing.js';
import { RIOT_AUTH_AUTHORIZE_URL } from '#lib/server/providers/valorant/constants.js';
import {
	connectValorantAccount,
	disconnectValorantAccount,
	loadDashboardView,
	submitValorantMfaCode,
	syncValorantAccountData
} from '#lib/server/providers/valorant/service.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(303, '/login');
	}

	const selectedAccountId = url.searchParams.get('account') ?? undefined;
	const dashboard = await loadDashboardView(
		locals.user.id,
		locals.user.displayCurrency,
		selectedAccountId
	);

	return {
		user: locals.user,
		riotAuthorizeUrl: RIOT_AUTH_AUTHORIZE_URL,
		dashboard,
		profileShare: dashboard.activeAccount
			? await getProfileShare(locals.user.id, dashboard.activeAccount.id)
			: null
	};
};

export const actions: Actions = {
	shareProfile: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { shareError: 'Unauthorized' });
		const formData = await request.formData();
		if (formData.get('confirmed') !== 'yes') {
			return fail(400, { shareError: 'Confirm before publishing your profile.' });
		}
		const path = await publishSharedProfile(
			locals.user.id,
			String(formData.get('accountId') ?? ''),
			locals.user.displayCurrency
		);
		if (!path) {
			return fail(400, { shareError: 'Select one of your accounts and sync it before sharing.' });
		}
		return { sharedPath: path };
	},

	connectAccount: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { connectError: 'Unauthorized' });

		const formData = await request.formData();
		const mode = formData.get('mode');

		let result;
		if (mode === 'redirect') {
			const redirectUrl = String(formData.get('redirectUrl') ?? '');
			const ssidCookie = String(formData.get('ssidCookie') ?? '');
			if (!redirectUrl.trim()) {
				return fail(400, { connectError: 'Paste the full playvalorant.com redirect URL.' });
			}
			result = await connectValorantAccount(locals.user.id, {
				mode: 'redirect',
				redirectUrl,
				ssidCookie
			});
		} else if (mode === 'ssid') {
			const ssidCookie = String(formData.get('ssidCookie') ?? '');
			result = await connectValorantAccount(locals.user.id, {
				mode: 'ssid',
				ssidCookie
			});
		} else if (mode === 'credentials') {
			const username = String(formData.get('username') ?? '');
			const password = String(formData.get('password') ?? '');
			if (!username.trim() || !password) {
				return fail(400, { connectError: 'Enter both Riot username and password.' });
			}
			result = await connectValorantAccount(locals.user.id, {
				mode: 'credentials',
				username,
				password
			});
		} else {
			return fail(400, { connectError: 'Unsupported connection mode.' });
		}

		if (result.status === 'mfa_required') {
			return {
				mfaRequired: true,
				pendingCookiesSealed: result.pendingCookiesSealed,
				emailHint: result.emailHint
			};
		}

		if (result.status === 'error') {
			return fail(400, { connectError: result.message });
		}

		redirect(303, `/?account=${result.accountId}`);
	},

	submitMfa: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { connectError: 'Unauthorized' });

		const formData = await request.formData();
		const code = String(formData.get('code') ?? '');
		const pendingCookiesSealed = String(formData.get('pendingCookiesSealed') ?? '');
		if (!code.trim() || !pendingCookiesSealed) {
			return fail(400, {
				connectError: 'Enter the 6-digit MFA code.',
				mfaRequired: true,
				pendingCookiesSealed
			});
		}

		const result = await submitValorantMfaCode(locals.user.id, code, pendingCookiesSealed);
		if (result.status !== 'connected') {
			return fail(400, {
				connectError: result.status === 'error' ? result.message : 'MFA failed.',
				mfaRequired: true,
				pendingCookiesSealed
			});
		}

		redirect(303, `/?account=${result.accountId}`);
	},

	refreshAccount: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { syncError: 'Unauthorized' });

		const formData = await request.formData();
		const accountId = String(formData.get('accountId') ?? '');
		if (!accountId) return fail(400, { syncError: 'Missing account ID.' });

		const res = await syncValorantAccountData(locals.user.id, accountId);
		if (!res.ok) {
			return fail(400, { syncError: res.error ?? 'Refresh failed.' });
		}
		return { synced: true };
	},

	disconnectAccount: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { syncError: 'Unauthorized' });

		const formData = await request.formData();
		const accountId = String(formData.get('accountId') ?? '');
		if (accountId) {
			await disconnectValorantAccount(locals.user.id, accountId);
		}
		redirect(303, '/');
	},

	setCurrency: async ({ request, locals }) => {
		if (!locals.user) return fail(401, { syncError: 'Unauthorized' });

		const formData = await request.formData();
		const currency = formData.get('currency');
		if (currency !== 'IDR' && currency !== 'USD') {
			return fail(400, { syncError: 'Unsupported currency.' });
		}

		const db = getDb();
		await db
			.update(schema.users)
			.set({ displayCurrency: currency, updatedAt: new Date() })
			.where(eq(schema.users.id, locals.user.id));

		return { currency };
	},

	logout: async ({ locals, cookies }) => {
		if (locals.sessionId) {
			await invalidateAppSession(locals.sessionId);
		}
		clearSessionCookie(cookies);
		redirect(303, '/login');
	}
};
