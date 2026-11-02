import { fail, redirect } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { hashPassword, verifyPassword } from '#lib/server/auth/password.js';
import { consumeLoginAttempt } from '#lib/server/auth/shared-rate-limit.js';
import { getDb, schema } from '#lib/server/db/index.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/login');
	return { username: locals.user.username };
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
		if (typeof next !== 'string' || next.length < 16 || next.length > 128)
			return fail(400, { error: 'New password must be 16–128 characters.' });
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
			const nextHash = await hashPassword(next);
			const result = await db.execute(sql`
				WITH changed AS (
					UPDATE users SET password_hash = ${nextHash}, updated_at = now()
					WHERE id = ${locals.user.id}::uuid AND password_hash = ${user.passwordHash}
					AND EXISTS (SELECT 1 FROM app_sessions WHERE id = ${locals.sessionId} AND user_id = ${locals.user.id}::uuid AND expires_at > now())
					RETURNING id
				), revoked AS (
					DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM changed) AND id <> ${locals.sessionId} RETURNING id
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
