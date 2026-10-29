import { OWNER_USER_ID } from '$app/env/private';
import { error } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from './db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function isInstanceOwner(user: App.Locals['user']): Promise<boolean> {
	if (
		!user ||
		!OWNER_USER_ID ||
		!UUID.test(OWNER_USER_ID) ||
		user.id !== OWNER_USER_ID.toLowerCase()
	)
		return false;
	const [row] = await getDb()
		.select({ ready: schema.users.ownerPasswordReady })
		.from(schema.users)
		.where(eq(schema.users.id, user.id))
		.limit(1);
	return row?.ready === true;
}

export async function requireOwner(user: App.Locals['user']): Promise<void> {
	if (!user) error(401, 'Sign in to continue.');
	if (!(await isInstanceOwner(user))) error(403, 'Forbidden');
}

export async function registrationIsOpen(): Promise<boolean> {
	const [row] = await getDb()
		.select({ value: schema.adminSettings.registrationOpen })
		.from(schema.adminSettings)
		.where(eq(schema.adminSettings.key, 'registration'))
		.limit(1);
	if (!row) return true;
	if (typeof row.value !== 'boolean') throw new Error('Invalid registration setting');
	return row.value;
}

export async function setRegistrationPolicy(open: boolean, actorId: string): Promise<void> {
	await getDb().execute(sql`select set_registration_policy(${open}, ${actorId}::uuid)`);
}
