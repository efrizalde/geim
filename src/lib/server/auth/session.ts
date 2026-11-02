import { createHmac } from 'node:crypto';
import { dev } from '$app/env';
import {
	AUTH_ORIGIN,
	BETTER_AUTH_SECRET,
	ENCRYPTION_MASTER_KEY,
	GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET
} from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { passkey } from '@better-auth/passkey';
import type { Cookies, RequestEvent } from '@sveltejs/kit';
import { betterAuth } from 'better-auth/minimal';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { getSessionCookie, parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { username } from 'better-auth/plugins/username';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password';
import { consumeLoginAttempt } from './shared-rate-limit';

export const LEGACY_SESSION_COOKIE_NAME = 'geim_session';

export function clearLegacySessionCookie(cookies: Cookies): void {
	cookies.delete(LEGACY_SESSION_COOKIE_NAME, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !dev
	});
}

export function resolveConfiguredOrigin(): URL | null {
	if (!AUTH_ORIGIN) return null;
	try {
		const parsed = new URL(AUTH_ORIGIN);
		if (
			parsed.origin !== AUTH_ORIGIN ||
			(parsed.protocol !== 'https:' &&
				parsed.hostname !== 'localhost' &&
				parsed.hostname !== '127.0.0.1')
		) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function isPasskeyEnabled(): boolean {
	return Boolean(resolveConfiguredOrigin() || dev);
}

export function isGoogleEnabled(): boolean {
	return Boolean((resolveConfiguredOrigin() || dev) && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function resolveAuthSecret(): string {
	if (BETTER_AUTH_SECRET) return BETTER_AUTH_SECRET;
	if (ENCRYPTION_MASTER_KEY) {
		return createHmac('sha256', ENCRYPTION_MASTER_KEY)
			.update('geim-better-auth-secret-v1')
			.digest('hex');
	}
	if (dev) {
		return 'geim-dev-only-better-auth-secret-key-0123456789abcdef';
	}
	throw new Error('BETTER_AUTH_SECRET or ENCRYPTION_MASTER_KEY is required for Better Auth.');
}

function resolveClientAddress(): string {
	try {
		return getRequestEvent().getClientAddress();
	} catch {
		return 'global';
	}
}

export function applyResponseCookies(
	cookies: Cookies | undefined,
	headers: Headers | undefined
): void {
	if (!cookies || !headers) return;
	const setCookie = headers.get('set-cookie');
	if (!setCookie) return;
	const parsed = parseSetCookieHeader(setCookie);
	for (const [name, attributes] of parsed) {
		try {
			cookies.set(name, attributes.value, {
				...toCookieOptions(attributes),
				path: attributes.path || '/'
			});
		} catch {
			// Ignore if response headers were already committed
		}
	}
}

function createAuthInstance() {
	const db = getDb();
	const configuredOrigin = resolveConfiguredOrigin();
	const baseURL = configuredOrigin
		? dev
			? {
					allowedHosts: [
						configuredOrigin.host,
						'localhost:*',
						'127.0.0.1:*',
						'localhost',
						'127.0.0.1'
					],
					fallback: configuredOrigin.origin
				}
			: configuredOrigin.origin
		: dev
			? {
					allowedHosts: ['localhost:*', '127.0.0.1:*', 'localhost', '127.0.0.1'],
					protocol: 'http' as const,
					fallback: 'http://localhost:5173'
				}
			: undefined;

	return betterAuth({
		appName: 'geim',
		secret: resolveAuthSecret(),
		baseURL,
		basePath: '/api/auth',
		disabledPaths: ['/sign-in/email', '/sign-up/email'],
		database: drizzleAdapter(db, {
			provider: 'pg',
			schema: {
				...schema,
				user: schema.users
			}
		}),
		advanced: {
			database: {
				generateId: () => crypto.randomUUID()
			}
		},
		session: {
			expiresIn: 30 * 24 * 60 * 60,
			updateAge: 15 * 24 * 60 * 60,
			freshAge: 0
		},
		user: {
			modelName: 'users',
			additionalFields: {
				passwordHash: {
					type: 'string',
					required: false,
					defaultValue: '',
					input: true,
					returned: false,
					fieldName: 'passwordHash'
				},
				displayCurrency: {
					type: 'string',
					required: false,
					defaultValue: 'IDR',
					input: false
				},
				purchaseRegion: {
					type: 'string',
					required: false,
					defaultValue: 'ID',
					input: false
				},
				ownerPasswordReady: {
					type: 'boolean',
					required: false,
					defaultValue: false,
					input: false,
					returned: false
				}
			}
		},
		emailAndPassword: {
			enabled: true,
			minPasswordLength: MIN_PASSWORD_LENGTH,
			maxPasswordLength: 128,
			password: {
				hash: hashPassword,
				verify: ({ password, hash }) => verifyPassword(password, hash)
			}
		},
		account: {
			accountLinking: {
				enabled: true,
				allowDifferentEmails: true,
				disableImplicitLinking: true,
				updateUserInfoOnLink: false
			}
		},
		socialProviders:
			GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET
				? {
						google: {
							clientId: GOOGLE_CLIENT_ID,
							clientSecret: GOOGLE_CLIENT_SECRET,
							disableSignUp: true,
							disableImplicitSignUp: true
						}
					}
				: undefined,
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				if (ctx.path.startsWith('/passkey/')) {
					if (!isPasskeyEnabled()) {
						throw new APIError('SERVICE_UNAVAILABLE', {
							message: 'Passkey sign-in is not configured.'
						});
					}
					if (ctx.path === '/passkey/verify-authentication') {
						let allowed: boolean;
						try {
							allowed = await consumeLoginAttempt('ip', resolveClientAddress());
						} catch {
							throw new APIError('SERVICE_UNAVAILABLE', {
								message: 'Sign-in is temporarily unavailable. Try again later.'
							});
						}
						if (!allowed) {
							throw new APIError('TOO_MANY_REQUESTS', {
								message: 'Too many sign-in attempts. Try again in a minute.'
							});
						}
					}
				}

				if (
					ctx.path === '/sign-in/social' ||
					ctx.path === '/link-social' ||
					ctx.path.startsWith('/callback/')
				) {
					if (!isGoogleEnabled()) {
						throw new APIError('SERVICE_UNAVAILABLE', {
							message: 'Google sign-in is not configured.'
						});
					}
				}

				if (ctx.path === '/sign-in/username' && ctx.request) {
					const rawUsername =
						typeof ctx.body?.username === 'string' ? ctx.body.username.trim().toLowerCase() : '';
					let allowed: boolean;
					try {
						const ipAllowed = await consumeLoginAttempt('ip', resolveClientAddress());
						const userAllowed = rawUsername ? await consumeLoginAttempt('user', rawUsername) : true;
						allowed = ipAllowed && userAllowed;
					} catch {
						throw new APIError('SERVICE_UNAVAILABLE', {
							message: 'Sign-in is temporarily unavailable. Try again later.'
						});
					}
					if (!allowed) {
						throw new APIError('TOO_MANY_REQUESTS', {
							message: 'Too many sign-in attempts. Try again in a minute.'
						});
					}
				}
			})
		},
		databaseHooks: {
			account: {
				create: {
					before: async (acc) => {
						if (acc.providerId === 'google') {
							const existing = await db
								.select({ id: schema.account.id, accountId: schema.account.accountId })
								.from(schema.account)
								.where(
									and(
										eq(schema.account.userId, acc.userId),
										eq(schema.account.providerId, 'google')
									)
								)
								.limit(1);
							if (existing.length && existing[0].accountId !== acc.accountId) {
								throw new APIError('CONFLICT', {
									code: 'google_already_linked',
									message: 'A Google account is already linked to this geim account.'
								});
							}
						}
					},
					after: async (acc) => {
						if (acc.providerId === 'credential' && acc.password) {
							await db
								.update(schema.users)
								.set({ passwordHash: acc.password, updatedAt: new Date() })
								.where(eq(schema.users.id, acc.userId));
						}
					}
				},
				update: {
					after: async (acc) => {
						if (acc?.providerId === 'credential' && acc.password) {
							await db
								.update(schema.users)
								.set({ passwordHash: acc.password, updatedAt: new Date() })
								.where(eq(schema.users.id, acc.userId));
						}
					}
				}
			}
		},
		plugins: [
			username({
				minUsernameLength: 3,
				maxUsernameLength: 32,
				usernameValidator: (value) => /^[a-zA-Z0-9_]{3,32}$/.test(value),
				usernameNormalization: (value) => value.trim().toLowerCase()
			}),
			passkey({
				rpName: 'geim',
				rpID: configuredOrigin?.hostname,
				origin: configuredOrigin?.origin
			}),
			sveltekitCookies(() => {
				try {
					return getRequestEvent();
				} catch {
					return undefined as never;
				}
			})
		]
	});
}

let cachedAuth: ReturnType<typeof createAuthInstance> | undefined;

export function getAuth(): ReturnType<typeof createAuthInstance> {
	if (cachedAuth) return cachedAuth;
	cachedAuth = createAuthInstance();
	return cachedAuth;
}

export async function registerWithUsername(
	usernameValue: string,
	password: string,
	request: Request,
	cookies: Cookies
): Promise<{ id: string } | null> {
	try {
		const result = await getAuth().api.signUpEmail({
			body: {
				name: usernameValue,
				email: `${crypto.randomUUID()}@users.geim.local`,
				password,
				username: usernameValue
			},
			headers: request.headers,
			returnHeaders: true
		});
		applyResponseCookies(cookies, result.headers);
		return { id: result.response.user.id };
	} catch (err) {
		if (
			isAPIError(err) &&
			(err.statusCode === 400 || err.statusCode === 409 || err.statusCode === 422)
		) {
			return null;
		}
		throw err;
	}
}

export async function signInWithUsername(
	usernameValue: string,
	password: string,
	request: Request,
	cookies: Cookies
): Promise<{ id: string; username: string } | null> {
	try {
		const result = await getAuth().api.signInUsername({
			body: {
				username: usernameValue,
				password
			},
			headers: request.headers,
			returnHeaders: true
		});
		applyResponseCookies(cookies, result.headers);
		return {
			id: result.response.user.id,
			username: result.response.user.username ?? usernameValue
		};
	} catch (err) {
		if (isAPIError(err) && (err.statusCode === 401 || err.statusCode === 422)) {
			return null;
		}
		throw err;
	}
}

export async function resolveRequestSession(event: RequestEvent): Promise<{
	session: { id: string; expiresAt: Date };
	user: NonNullable<App.Locals['user']>;
} | null> {
	if (event.cookies.get(LEGACY_SESSION_COOKIE_NAME)) {
		clearLegacySessionCookie(event.cookies);
	}
	if (!getSessionCookie(event.request)) {
		return null;
	}
	const result = await getAuth().api.getSession({
		headers: event.request.headers,
		returnHeaders: true
	});
	applyResponseCookies(event.cookies, result.headers);
	const data = result.response;
	if (!data?.session || !data.user) {
		return null;
	}
	const userRecord = data.user as typeof data.user & {
		username?: string | null;
		displayCurrency?: string | null;
		purchaseRegion?: string | null;
	};
	return {
		session: {
			id: data.session.id,
			expiresAt: new Date(data.session.expiresAt)
		},
		user: {
			id: data.user.id,
			username: userRecord.username || data.user.name,
			displayCurrency: userRecord.displayCurrency === 'USD' ? 'USD' : 'IDR',
			purchaseRegion: userRecord.purchaseRegion || 'ID'
		}
	};
}

export async function signOutRequestSession(request: Request, cookies: Cookies): Promise<void> {
	clearLegacySessionCookie(cookies);
	if (!getSessionCookie(request)) return;
	try {
		const result = await getAuth().api.signOut({
			headers: request.headers,
			returnHeaders: true
		});
		applyResponseCookies(cookies, result.headers);
	} catch {
		// Session already expired or missing
	}
}
