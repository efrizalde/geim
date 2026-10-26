import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../../hooks.server';
import { actions as dashboardActions } from '../../routes/+page.server';
import { actions as loginActions } from '../../routes/login/+page.server';
import { actions as registerActions } from '../../routes/register/+page.server';
import { clearFailedLogins } from './auth/rate-limit';
import {
	createAppSession,
	registerUser,
	setSessionCookie,
	validateAppSessionToken,
	verifyUserCredentials
} from './auth/session';
import { publishSharedProfile } from './sharing';

vi.mock('./auth/session', () => ({
	SESSION_COOKIE_NAME: 'geim_session',
	clearSessionCookie: vi.fn(),
	createAppSession: vi.fn(),
	invalidateAppSession: vi.fn(),
	registerUser: vi.fn(),
	setSessionCookie: vi.fn(),
	validateAppSessionToken: vi.fn(),
	verifyUserCredentials: vi.fn()
}));
vi.mock('./sharing', () => ({
	getProfileShare: vi.fn(),
	publishSharedProfile: vi.fn()
}));
vi.mock('./db', () => ({ getDb: vi.fn(), schema: {} }));
vi.mock('./providers/valorant/service', () => ({
	connectValorantAccount: vi.fn(),
	disconnectValorantAccount: vi.fn(),
	loadDashboardView: vi.fn(),
	submitValorantMfaCode: vi.fn(),
	syncValorantAccountData: vi.fn()
}));

const user = { id: 'owner-a', username: 'player_a', displayCurrency: 'USD', purchaseRegion: 'ID' };

function actionEvent(fields: Record<string, string>, signedIn = true) {
	return {
		request: new Request('http://localhost/', {
			method: 'POST',
			body: new URLSearchParams(fields)
		}),
		locals: { user: signedIn ? user : null, sessionId: null },
		cookies: { set: vi.fn(), delete: vi.fn() },
		getClientAddress: () => 'route-test'
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	clearFailedLogins('register:route-test');
	clearFailedLogins('route-test');
});

describe('account form actions', () => {
	it('registers normalized usernames and signs in the newly created user', async () => {
		vi.mocked(registerUser).mockResolvedValue({ id: 'new-user' });
		const session = { token: 'new-token', sessionId: 'hashed-token', expiresAt: new Date() };
		vi.mocked(createAppSession).mockResolvedValue(session);
		const event = actionEvent(
			{ username: ' Player_B ', password: '1234', confirmPassword: '1234' },
			false
		);
		await expect(registerActions.default(event as never)).rejects.toMatchObject({
			status: 303,
			location: '/'
		});
		expect(registerUser).toHaveBeenCalledWith('player_b', '1234');
		expect(createAppSession).toHaveBeenCalledWith('new-user');
		expect(setSessionCookie).toHaveBeenCalledWith(event.cookies, session.token, session.expiresAt);
	});

	it('rejects mismatched passwords, duplicates, and excessive registration attempts', async () => {
		const mismatch = await registerActions.default(
			actionEvent(
				{
					username: 'player_b',
					password: '1234',
					confirmPassword: '5678'
				},
				false
			) as never
		);
		expect(mismatch).toMatchObject({ status: 400 });
		expect(registerUser).not.toHaveBeenCalled();
		vi.mocked(registerUser).mockResolvedValue(null);
		const fields = { username: 'player_b', password: '1234', confirmPassword: '1234' };
		for (let i = 0; i < 4; i++) {
			expect(await registerActions.default(actionEvent(fields, false) as never)).toMatchObject({
				status: 409
			});
		}
		expect(await registerActions.default(actionEvent(fields, false) as never)).toMatchObject({
			status: 429
		});
		expect(createAppSession).not.toHaveBeenCalled();
	});

	it('logs in with the supplied username and preserves a generic invalid-credentials error', async () => {
		vi.mocked(verifyUserCredentials).mockResolvedValue(null);
		expect(
			await loginActions.default(
				actionEvent({ username: 'PLAYER_B', password: '1234' }, false) as never
			)
		).toMatchObject({ status: 401, data: { error: 'Invalid username or password.' } });
		expect(verifyUserCredentials).toHaveBeenCalledWith('player_b', '1234');
		expect(createAppSession).not.toHaveBeenCalled();
		vi.mocked(verifyUserCredentials).mockResolvedValue({ id: 'user-b', username: 'player_b' });
		vi.mocked(createAppSession).mockResolvedValue({
			token: 'token',
			sessionId: 'hash',
			expiresAt: new Date()
		});
		await expect(
			loginActions.default(actionEvent({ username: 'PLAYER_B', password: '1234' }, false) as never)
		).rejects.toMatchObject({ status: 303, location: '/' });
		expect(createAppSession).toHaveBeenCalledWith('user-b');
	});
});

describe('share confirmation action', () => {
	it('does not publish without an authenticated owner and explicit confirmation', async () => {
		expect(
			await dashboardActions.shareProfile(actionEvent({ accountId: 'account' }, false) as never)
		).toMatchObject({ status: 401 });
		expect(
			await dashboardActions.shareProfile(actionEvent({ accountId: 'account' }) as never)
		).toMatchObject({ status: 400 });
		expect(publishSharedProfile).not.toHaveBeenCalled();
	});

	it('publishes with server-side user identity, not submitted ownership', async () => {
		vi.mocked(publishSharedProfile).mockResolvedValue('/share/random-link');
		const result = await dashboardActions.shareProfile(
			actionEvent({
				accountId: 'account',
				confirmed: 'yes',
				userId: 'attacker-supplied'
			}) as never
		);
		expect(result).toEqual({ sharedPath: '/share/random-link' });
		expect(publishSharedProfile).toHaveBeenCalledWith(user.id, 'account', 'USD');
	});

	it('returns an actionable failure for foreign, missing, or unsynced accounts', async () => {
		vi.mocked(publishSharedProfile).mockResolvedValue(null);
		expect(
			await dashboardActions.shareProfile(
				actionEvent({
					accountId: 'foreign-account',
					confirmed: 'yes'
				}) as never
			)
		).toMatchObject({ status: 400, data: { shareError: expect.stringContaining('sync') } });
	});
});

describe('public and private route boundaries', () => {
	function hookInput(path: string, method = 'GET', cookie?: string) {
		const resolve = vi.fn().mockResolvedValue(new Response('ok'));
		return {
			event: {
				url: new URL(path, 'http://localhost'),
				request: new Request(new URL(path, 'http://localhost'), { method }),
				locals: {},
				cookies: { get: vi.fn().mockReturnValue(cookie), delete: vi.fn(), set: vi.fn() }
			},
			resolve
		};
	}

	it('allows anonymous registration and login without an owner-initialization query', async () => {
		for (const path of ['/register', '/login']) {
			const input = hookInput(path);
			expect((await handle(input as never)).status).toBe(200);
			expect(input.resolve).toHaveBeenCalled();
		}
		expect(validateAppSessionToken).not.toHaveBeenCalled();
	});

	it('serves shares and fixed-host media without touching app sessions, even with stale cookies', async () => {
		for (const path of ['/share/' + 'a'.repeat(32), '/api/valorant-media?url=test']) {
			expect((await handle(hookInput(path, 'GET', 'stale-cookie') as never)).status).toBe(200);
		}
		expect(validateAppSessionToken).not.toHaveBeenCalled();
	});

	it('keeps the dashboard, mutation routes, and other APIs private', async () => {
		await expect(handle(hookInput('/') as never)).rejects.toMatchObject({ location: '/login' });
		await expect(handle(hookInput('/share/link', 'POST') as never)).rejects.toMatchObject({
			location: '/login'
		});
		expect((await handle(hookInput('/api/private') as never)).status).toBe(401);
	});
});
