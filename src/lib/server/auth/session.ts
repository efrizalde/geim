import { createHash, randomBytes } from 'node:crypto';
import { dev } from '$app/env';
import type { Cookies } from '@sveltejs/kit';
import { eq, lt } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { hashPassword, verifyPassword } from './password';

export const SESSION_COOKIE_NAME = 'geim_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

function hashSessionToken(token: string): string {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

export function setSessionCookie(cookies: Cookies, token: string, expiresAt: Date): void {
	cookies.set(SESSION_COOKIE_NAME, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev,
		expires: expiresAt
	});
}

export function clearSessionCookie(cookies: Cookies): void {
	cookies.delete(SESSION_COOKIE_NAME, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev
	});
}

export async function registerUser(
	username: string,
	password: string
): Promise<{ id: string } | null> {
	const db = getDb();
	const passwordHash = await hashPassword(password);
	const inserted = await db
		.insert(schema.users)
		.values({
			username,
			passwordHash,
			displayCurrency: 'IDR',
			purchaseRegion: 'ID'
		})
		.onConflictDoNothing({ target: schema.users.username })
		.returning({ id: schema.users.id });

	return inserted[0] ?? null;
}

export async function verifyUserCredentials(
	username: string,
	password: string
): Promise<{ id: string; username: string } | null> {
	const db = getDb();
	const rows = await db
		.select({
			id: schema.users.id,
			username: schema.users.username,
			passwordHash: schema.users.passwordHash
		})
		.from(schema.users)
		.where(eq(schema.users.username, username))
		.limit(1);

	const user = rows[0];
	// Keep unknown usernames on the same scrypt path as incorrect passwords.
	const valid = await verifyPassword(
		password,
		user?.passwordHash ?? `scryptv1$${'0'.repeat(32)}$${'0'.repeat(128)}`
	);
	if (!user || !valid) return null;

	return { id: user.id, username: user.username };
}

export async function createAppSession(userId: string): Promise<{
	token: string;
	sessionId: string;
	expiresAt: Date;
}> {
	const db = getDb();
	const token = generateSessionToken();
	const sessionId = hashSessionToken(token);
	const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

	// Opportunistic bounded cleanup: expired rows are only deleted otherwise on reuse.
	await db.delete(schema.appSessions).where(lt(schema.appSessions.expiresAt, new Date()));

	await db.insert(schema.appSessions).values({
		id: sessionId,
		userId,
		expiresAt
	});

	return { token, sessionId, expiresAt };
}

export async function validateAppSessionToken(token: string): Promise<{
	session: { id: string; expiresAt: Date };
	user: NonNullable<App.Locals['user']>;
} | null> {
	const db = getDb();
	const sessionId = hashSessionToken(token);

	const rows = await db
		.select({
			sessionId: schema.appSessions.id,
			expiresAt: schema.appSessions.expiresAt,
			userId: schema.users.id,
			username: schema.users.username,
			displayCurrency: schema.users.displayCurrency,
			purchaseRegion: schema.users.purchaseRegion
		})
		.from(schema.appSessions)
		.innerJoin(schema.users, eq(schema.appSessions.userId, schema.users.id))
		.where(eq(schema.appSessions.id, sessionId))
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	const now = Date.now();
	if (row.expiresAt.getTime() <= now) {
		await db.delete(schema.appSessions).where(eq(schema.appSessions.id, sessionId));
		return null;
	}

	let expiresAt = row.expiresAt;
	if (expiresAt.getTime() - now < SESSION_RENEW_THRESHOLD_MS) {
		expiresAt = new Date(now + SESSION_TTL_MS);
		await db
			.update(schema.appSessions)
			.set({ expiresAt })
			.where(eq(schema.appSessions.id, sessionId));
	}

	const displayCurrency = row.displayCurrency === 'USD' ? 'USD' : 'IDR';

	return {
		session: { id: row.sessionId, expiresAt },
		user: {
			id: row.userId,
			username: row.username,
			displayCurrency,
			purchaseRegion: row.purchaseRegion
		}
	};
}

export async function invalidateAppSession(sessionId: string): Promise<void> {
	const db = getDb();
	await db.delete(schema.appSessions).where(eq(schema.appSessions.id, sessionId));
}
