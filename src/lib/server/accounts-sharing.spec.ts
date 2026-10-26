import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { hashPassword, verifyPassword } from './auth/password';
import { registerUser, verifyUserCredentials } from './auth/session';
import { schema } from './db';
import { loadDashboardView } from './providers/valorant/service';
import type { HydratedMatchItem } from './providers/valorant/tracker';
import {
	createSharedProfileSnapshot,
	getProfileShare,
	loadSharedProfile,
	publishSharedProfile,
	summarizeSharedStats
} from './sharing';

const db = vi.hoisted(() => ({ select: vi.fn(), insert: vi.fn() }));
vi.mock('$app/env', () => ({ dev: true }));
vi.mock('./db', async () => ({
	getDb: () => db,
	schema: await import('./db/schema')
}));
vi.mock('./providers/valorant/service', () => ({ loadDashboardView: vi.fn() }));

const ACCOUNT_ID = 'b0ecf484-8d26-4b1d-9a95-edc326b88891';
const SYNCED_AT = '2026-10-26T10:00:00.000Z';
const TOKEN = 'a'.repeat(32);
type Dashboard = Awaited<ReturnType<typeof loadDashboardView>>;

function dashboard() {
	return {
		accounts: [{ id: 'private-other-account' }],
		activeAccount: {
			id: ACCOUNT_ID,
			puuid: 'public-riot-identifier',
			gameName: 'TestPlayer',
			tagLine: 'TEST',
			region: 'ap',
			shard: 'ap',
			authMode: 'cookie_jar',
			connectionStatus: 'connected',
			lastSyncedAt: SYNCED_AT
		},
		currencyIcons: { vp: 'vp.png', radianite: 'rp.png', kingdomCredits: 'kc.png' },
		profile: null,
		inventory: null,
		tracker: null,
		store: { wallet: { vp: 12345 } }
	} as unknown as Dashboard;
}

function match(overrides: Partial<HydratedMatchItem> = {}): HydratedMatchItem {
	return {
		matchId: 'private-match-id',
		startedAt: SYNCED_AT,
		outcome: 'win',
		kills: 20,
		deaths: 10,
		assists: 5,
		roundsPlayed: 20,
		score: 4000,
		damageDealt: 3000,
		headshots: 10,
		bodyshots: 20,
		legshots: 10,
		kastRounds: 12,
		scoreboard: [{ gameName: 'PrivateOpponent' }],
		...overrides
	} as HydratedMatchItem;
}

function selection(rows: unknown[]) {
	const query = {
		from: vi.fn().mockReturnThis(),
		innerJoin: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue(rows)
	};
	db.select.mockReturnValueOnce(query);
	return query;
}

function insertion(rows: unknown[]) {
	const query = {
		values: vi.fn().mockReturnThis(),
		onConflictDoNothing: vi.fn().mockReturnThis(),
		onConflictDoUpdate: vi.fn().mockReturnThis(),
		returning: vi.fn().mockResolvedValue(rows)
	};
	db.insert.mockReturnValueOnce(query);
	return query;
}

beforeEach(() => vi.resetAllMocks());

describe('username-based accounts', () => {
	it('registers another user without an owner-exists gate and stores only a password hash', async () => {
		const query = insertion([{ id: 'second-user' }]);
		expect(await registerUser('second_player', 'test-password')).toEqual({ id: 'second-user' });
		const values = query.values.mock.calls[0][0];
		expect(values.username).toBe('second_player');
		expect(values.passwordHash).not.toBe('test-password');
		expect(await verifyPassword('test-password', values.passwordHash)).toBe(true);
		expect(query.onConflictDoNothing).toHaveBeenCalledWith({ target: schema.users.username });
		expect(db.select).not.toHaveBeenCalled();
	});

	it('reports a duplicate username without replacing the existing user', async () => {
		insertion([]);
		expect(await registerUser('owner', 'test-password')).toBeNull();
	});

	it('looks up the supplied username rather than authenticating the first user', async () => {
		const query = selection([
			{
				id: 'second-user',
				username: 'second_player',
				passwordHash: await hashPassword('test-password')
			}
		]);
		expect(await verifyUserCredentials('second_player', 'test-password')).toEqual({
			id: 'second-user',
			username: 'second_player'
		});
		const sql = new PgDialect().sqlToQuery(query.where.mock.calls[0][0]);
		expect(sql.sql).toContain('"users"."username"');
		expect(sql.params).toEqual(['second_player']);
	});

	it('rejects both an unknown user and a wrong password', async () => {
		selection([]);
		expect(await verifyUserCredentials('missing', 'test-password')).toBeNull();
		selection([
			{ id: 'owner', username: 'owner', passwordHash: await hashPassword('other-password') }
		]);
		expect(await verifyUserCredentials('owner', 'test-password')).toBeNull();
	});
});

describe('persistent, owner-published profile snapshots', () => {
	it('excludes wallet, provider state, and sibling accounts from the published payload', () => {
		const snapshot = createSharedProfileSnapshot(dashboard());
		expect(snapshot?.account).toEqual({
			gameName: 'TestPlayer',
			tagLine: 'TEST',
			shard: 'ap',
			lastSyncedAt: SYNCED_AT
		});
		const json = JSON.stringify(snapshot);
		for (const privateValue of [
			'wallet',
			'12345',
			'private-other-account',
			'cookie_jar',
			'public-riot-identifier',
			ACCOUNT_ID
		]) {
			expect(json).not.toContain(privateValue);
		}
	});

	it('publishes weighted aggregate stats without individual matches or scoreboards', () => {
		const matches = [
			match(),
			match({
				outcome: 'loss',
				kills: 10,
				deaths: 5,
				assists: 3,
				roundsPlayed: 10,
				score: 1000,
				damageDealt: 1000,
				headshots: 2,
				bodyshots: 2,
				legshots: 4,
				kastRounds: 8
			})
		];
		const stats = summarizeSharedStats(matches);
		expect(stats.sampleCount).toBe(2);
		expect(stats.winPercent).toBe(50);
		expect(stats.killDeathRatio).toBe(2);
		expect(stats.averageCombatScore).toBeCloseTo(5000 / 30);
		expect(stats.averageDamagePerRound).toBeCloseTo(4000 / 30);
		expect(stats.headshotPercent).toBe(25);
		expect(stats.kastPercent).toBeCloseTo(2000 / 30);
		const view = dashboard();
		view.tracker = { matches } as NonNullable<Dashboard['tracker']>;
		const json = JSON.stringify(createSharedProfileSnapshot(view));
		for (const privateValue of [
			'matchId',
			'private-match-id',
			'scoreboard',
			'PrivateOpponent',
			'startedAt'
		]) {
			expect(json).not.toContain(privateValue);
		}
	});

	it('keeps empty samples and deathless or draw-only samples finite', () => {
		const empty = summarizeSharedStats([]);
		expect(empty.sampleCount).toBe(0);
		expect(Object.values(empty).every(Number.isFinite)).toBe(true);
		const draw = summarizeSharedStats([match({ outcome: 'draw', deaths: 0 })]);
		expect(draw.winPercent).toBe(0);
		expect(draw.draws).toBe(1);
		expect(draw.killDeathRatio).toBe(20);
	});

	it('refuses an unsynced account', async () => {
		const view = dashboard();
		view.activeAccount!.lastSyncedAt = null;
		selection([{ id: ACCOUNT_ID }]);
		vi.mocked(loadDashboardView).mockResolvedValue(view);
		expect(await publishSharedProfile('owner-a', ACCOUNT_ID, 'IDR')).toBeNull();
		expect(db.insert).not.toHaveBeenCalled();
	});

	it('checks both owner and account before hydration or publication', async () => {
		const query = selection([]);
		expect(await publishSharedProfile('owner-b', ACCOUNT_ID, 'IDR')).toBeNull();
		const sql = new PgDialect().sqlToQuery(query.where.mock.calls[0][0]);
		expect(sql.sql).toContain('"linked_accounts"."user_id"');
		expect(sql.params).toEqual([ACCOUNT_ID, 'owner-b']);
		expect(loadDashboardView).not.toHaveBeenCalled();
		expect(db.insert).not.toHaveBeenCalled();
	});

	it('rejects malformed IDs and never shares the fallback account', async () => {
		expect(await publishSharedProfile('owner', 'invalid-id', 'IDR')).toBeNull();
		expect(db.select).not.toHaveBeenCalled();
		selection([{ id: ACCOUNT_ID }]);
		const fallback = dashboard();
		fallback.activeAccount!.id = 'different-account';
		vi.mocked(loadDashboardView).mockResolvedValue(fallback);
		expect(await publishSharedProfile('owner', ACCOUNT_ID, 'IDR')).toBeNull();
		expect(db.insert).not.toHaveBeenCalled();
	});

	it('generates a random link and preserves it while replacing only the saved snapshot', async () => {
		for (let i = 0; i < 2; i++) {
			selection([{ id: ACCOUNT_ID }]);
			vi.mocked(loadDashboardView).mockResolvedValue(dashboard());
			const query = insertion([{ token: TOKEN }]);
			expect(await publishSharedProfile('owner', ACCOUNT_ID, 'USD')).toBe(`/share/${TOKEN}`);
			const values = query.values.mock.calls[0][0];
			expect(values.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
			expect(values.linkedAccountId).toBe(ACCOUNT_ID);
			const conflict = query.onConflictDoUpdate.mock.calls[0][0];
			expect(conflict.target).toBe(schema.sharedProfiles.linkedAccountId);
			expect(Object.keys(conflict.set).sort()).toEqual(['publishedAt', 'snapshot']);
		}
		const firstToken = db.insert.mock.results[0].value.values.mock.calls[0][0].token;
		const secondToken = db.insert.mock.results[1].value.values.mock.calls[0][0].token;
		expect(firstToken).not.toBe(secondToken);
	});

	it('returns the saved public snapshot without loading or syncing Riot data', async () => {
		const snapshot = createSharedProfileSnapshot(dashboard());
		selection([{ snapshot, publishedAt: new Date(SYNCED_AT) }]);
		expect(await loadSharedProfile(TOKEN)).toEqual({ snapshot, publishedAt: SYNCED_AT });
		expect(loadDashboardView).not.toHaveBeenCalled();
		expect(db.insert).not.toHaveBeenCalled();
		expect(await loadSharedProfile('../invalid')).toBeNull();
		expect(db.select).toHaveBeenCalledTimes(1);
	});

	it('removes match history and identifiers from previously published snapshots too', async () => {
		const snapshot = createSharedProfileSnapshot(dashboard())!;
		const legacy = {
			...snapshot,
			account: { ...snapshot.account, puuid: 'private-puuid' },
			stats: undefined,
			tracker: { matches: [match()] }
		};
		selection([{ snapshot: legacy, publishedAt: new Date(SYNCED_AT) }]);
		const result = await loadSharedProfile(TOKEN);
		expect(result?.snapshot.stats.sampleCount).toBe(1);
		const json = JSON.stringify(result);
		for (const privateValue of [
			'tracker',
			'matchId',
			'private-match-id',
			'PrivateOpponent',
			'private-puuid'
		]) {
			expect(json).not.toContain(privateValue);
		}
	});

	it('looks up existing links only through the owning user and account', async () => {
		const query = selection([{ token: TOKEN, publishedAt: new Date(SYNCED_AT) }]);
		expect(await getProfileShare('owner-a', ACCOUNT_ID)).toEqual({
			path: `/share/${TOKEN}`,
			publishedAt: SYNCED_AT
		});
		const sql = new PgDialect().sqlToQuery(query.where.mock.calls[0][0]);
		expect(sql.params).toEqual(['owner-a', ACCOUNT_ID]);
	});
});
