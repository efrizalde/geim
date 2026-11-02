import { getAuthenticatorName } from '@better-auth/passkey';
import { fail, redirect } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import { hashPassword, validatePassword, verifyPassword } from '#lib/server/auth/password.js';
import { isGoogleEnabled, isPasskeyEnabled } from '#lib/server/auth/session.js';
import { consumeLoginAttempt } from '#lib/server/auth/shared-rate-limit.js';
import { getDb, schema } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, '/login');
	let passkeys: { id: string; label: string; createdAt: string | null }[] = [];
	let googleAccountId: string | null = null;
	try {
		const db = getDb();
		const [storedPasskeys, storedGoogle] = await Promise.all([
			db
				.select({
					id: schema.passkey.id,
					name: schema.passkey.name,
					aaguid: schema.passkey.aaguid,
					createdAt: schema.passkey.createdAt
				})
				.from(schema.passkey)
				.where(eq(schema.passkey.userId, locals.user.id)),
			db
				.select({ id: schema.account.id })
				.from(schema.account)
				.where(
					and(eq(schema.account.userId, locals.user.id), eq(schema.account.providerId, 'google'))
				)
				.limit(1)
		]);
		passkeys = storedPasskeys.map((item) => ({
			id: item.id,
			label: item.name || getAuthenticatorName(item.aaguid) || 'Passkey',
			createdAt: item.createdAt ? item.createdAt.toISOString() : null
		}));
		googleAccountId = storedGoogle[0]?.id ?? null;
	} catch {
		// Keep password form usable if auxiliary lookup fails
	}
	const errorCode = url.searchParams.get('error');
	const oauthError =
		errorCode === 'account_already_linked_to_different_user' ||
		errorCode === 'google_already_linked'
			? 'This Google account or geim account is already linked.'
			: errorCode
				? 'Could not link Google account. Try again.'
				: null;
	return {
		username: locals.user.username,
		googleLinked: url.searchParams.get('google') === 'linked' || Boolean(googleAccountId),
		googleAccountId,
		passkeys,
		oauthError,
		passkeyEnabled: isPasskeyEnabled(),
		googleEnabled: isGoogleEnabled()
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		if (!locals.user || !locals.sessionId) return fail(401, { error: 'Please sign in again.' });
		const fields = await request.formData();
		const current = fields.get('currentPassword');
		const next = fields.get('newPassword');
		const confirmation = fields.get('confirmPassword');
		if (typeof current !== 'string' || !current || current.length > 128)
			return fail(400, { error: 'Enter your current password.' });
		const nextCheck = validatePassword(next);
		if (!nextCheck.ok) return fail(400, { error: nextCheck.error });
		if (next !== confirmation) return fail(400, { error: 'New passwords do not match.' });
		if (next === current) return fail(400, { error: 'Choose a different password.' });
		try {
			if (!(await consumeLoginAttempt('user', locals.user.username)))
				return fail(429, { error: 'Too many attempts. Try again in a minute.' });
			const db = getDb();
			const [user] = await db
				.select({ passwordHash: schema.users.passwordHash })
				.from(schema.users)
				.where(eq(schema.users.id, locals.user.id))
				.limit(1);
			if (!user || !(await verifyPassword(current, user.passwordHash)))
				return fail(400, { error: 'Current password is incorrect.' });
			const nextHash = await hashPassword(nextCheck.value);
			const result = await db.execute(sql`
				WITH changed AS (
					UPDATE users SET password_hash = ${nextHash}, updated_at = now()
					WHERE id = ${locals.user.id}::uuid AND password_hash = ${user.passwordHash}
					AND EXISTS (SELECT 1 FROM session WHERE id = ${locals.sessionId} AND user_id = ${locals.user.id}::uuid AND expires_at > now())
					RETURNING id
				), updated_account AS (
					INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at)
					SELECT gen_random_uuid()::text, id::text, 'credential', id, ${nextHash}, now(), now() FROM changed
					ON CONFLICT (provider_id, account_id) DO UPDATE SET password = ${nextHash}, updated_at = now()
				), revoked_legacy AS (
					DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM changed)
				), revoked AS (
					DELETE FROM session WHERE user_id IN (SELECT id FROM changed) AND id <> ${locals.sessionId} RETURNING id
				)
				SELECT id, (SELECT count(*) FROM revoked) AS revoked FROM changed
			`);
			if (!result.rows.length)
				return fail(409, { error: 'Your password changed elsewhere. Sign in again and retry.' });
			return { success: true };
		} catch {
			return fail(503, { error: 'Could not change your password. Please try again.' });
		}
	}
};
