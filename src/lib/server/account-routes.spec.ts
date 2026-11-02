import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../../hooks.server';
import { actions as dashboardActions } from '../../routes/+page.server';
import { actions as loginActions } from '../../routes/login/+page.server';
import { actions as registerActions } from '../../routes/register/+page.server';
import { clearFailedLogins } from './auth/rate-limit';
import { registrationIsOpen } from './admin';
import { consumeLoginAttempt } from './auth/shared-rate-limit';
import {
	getAuth,
	registerWithUsername,
	resolveRequestSession,
	signInWithUsername
} from './auth/session';
import { publishSharedProfile } from './sharing';

vi.mock('$app/env', () => ({ building: false, dev: true }));
vi.mock('./auth/session', () => ({
	getAuth: vi.fn(),
	isGoogleEnabled: vi.fn().mockReturnValue(false),
	isPasskeyEnabled: vi.fn().mockReturnValue(true),
	registerWithUsername: vi.fn(),
	resolveRequestSession: vi.fn(),
	signInWithUsername: vi.fn(),
	signOutRequestSession: vi.fn()
}));
vi.mock('./sharing', () => ({
	getProfileShare: vi.fn(),
	publishSharedProfile: vi.fn()
}));
vi.mock('./admin', () => ({ registrationIsOpen: vi.fn(), isInstanceOwner: vi.fn() }));
vi.mock('./auth/shared-rate-limit', () => ({ consumeLoginAttempt: vi.fn() }));
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
	vi.mocked(registrationIsOpen).mockResolvedValue(true);
	vi.mocked(consumeLoginAttempt).mockResolvedValue(true);
	clearFailedLogins('register:route-test');
	clearFailedLogins('route-test');
});

describe('account form actions', () => {
	it('blocks direct registration when paused or unavailable', async () => {
		vi.mocked(registrationIsOpen)
			.mockResolvedValueOnce(false)
			.mockRejectedValueOnce(new Error('unavailable'));
		expect(await registerActions.default(actionEvent({}, false) as never)).toMatchObject({
			status: 403
		});
		expect(await registerActions.default(actionEvent({}, false) as never)).toMatchObject({
			status: 503
		});
		expect(registerWithUsername).not.toHaveBeenCalled();
	});

	it('fails login closed when the shared limiter rejects or is unavailable', async () => {
		vi.mocked(consumeLoginAttempt).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
		expect(
			await loginActions.default(
				actionEvent({ username: 'player_b', password: '1234' }, false) as never
			)
		).toMatchObject({ status: 429 });
		vi.mocked(consumeLoginAttempt).mockRejectedValueOnce(new Error('unavailable'));
		expect(
			await loginActions.default(
				actionEvent({ username: 'player_b', password: '1234' }, false) as never
			)
		).toMatchObject({ status: 503 });
		expect(signInWithUsername).not.toHaveBeenCalled();
	});
	it('registers normalized usernames and signs in the newly created user', async () => {
		vi.mocked(registerWithUsername).mockResolvedValue({ id: 'new-user' });
		const event = actionEvent(
			{ username: ' Player_B ', password: '1234', confirmPassword: '1234' },
			false
		);
		await expect(registerActions.default(event as never)).rejects.toMatchObject({
			status: 303,
			location: '/'
		});
		expect(registerWithUsername).toHaveBeenCalledWith(
			'player_b',
			'1234',
			event.request,
			event.cookies
		);
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
		expect(registerWithUsername).not.toHaveBeenCalled();
		vi.mocked(registerWithUsername).mockResolvedValue(null);
		const fields = { username: 'player_b', password: '1234', confirmPassword: '1234' };
		for (let i = 0; i < 4; i++) {
			expect(await registerActions.default(actionEvent(fields, false) as never)).toMatchObject({
				status: 409
			});
		}
		expect(await registerActions.default(actionEvent(fields, false) as never)).toMatchObject({
			status: 429
		});
	});

	it('logs in with the supplied username and preserves a generic invalid-credentials error', async () => {
		vi.mocked(signInWithUsername).mockResolvedValue(null);
		expect(
			await loginActions.default(
				actionEvent({ username: 'PLAYER_B', password: '1234' }, false) as never
			)
		).toMatchObject({ status: 401, data: { error: 'Invalid username or password.' } });
		expect(signInWithUsername).toHaveBeenCalledWith(
			'player_b',
			'1234',
			expect.any(Request),
			expect.any(Object)
		);
		vi.mocked(signInWithUsername).mockResolvedValue({ id: 'user-b', username: 'player_b' });
		const event = actionEvent({ username: 'PLAYER_B', password: '1234' }, false);
		await expect(loginActions.default(event as never)).rejects.toMatchObject({
			status: 303,
			location: '/'
		});
		expect(signInWithUsername).toHaveBeenCalledWith(
			'player_b',
			'1234',
			event.request,
			event.cookies
		);
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
		expect(resolveRequestSession).toHaveBeenCalledTimes(2);
	});

	it('serves shares and fixed-host media without touching app sessions, even with stale cookies', async () => {
		for (const path of ['/share/' + 'a'.repeat(32), '/api/valorant-media?url=test']) {
			expect((await handle(hookInput(path, 'GET', 'stale-cookie') as never)).status).toBe(200);
		}
		expect(resolveRequestSession).not.toHaveBeenCalled();
	});

	it('routes /api/auth/* requests through the Better Auth SvelteKit handler', async () => {
		const handler = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
		vi.mocked(getAuth).mockReturnValue({
			handler,
			options: { basePath: '/api/auth' }
		} as never);
		const input = hookInput('/api/auth/passkey/generate-authenticate-options', 'GET');
		const response = await handle(input as never);
		expect(response.status).toBe(200);
		expect(handler).toHaveBeenCalledWith(input.event.request);
		expect(resolveRequestSession).not.toHaveBeenCalled();
	});

	it('keeps the dashboard, mutation routes, and other APIs private', async () => {
		await expect(handle(hookInput('/') as never)).rejects.toMatchObject({ location: '/login' });
		await expect(handle(hookInput('/share/link', 'POST') as never)).rejects.toMatchObject({
			location: '/login'
		});
		expect((await handle(hookInput('/api/private') as never)).status).toBe(401);
	});
});
