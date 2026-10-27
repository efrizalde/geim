import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	selectCount: 0,
	insert: vi.fn(),
	update: vi.fn(),
	getDb: vi.fn()
}));

vi.mock('$app/env/private', () => ({ ENCRYPTION_MASTER_KEY: 'test-key', HENRIKDEV_API_KEY: '' }));
vi.mock('../../crypto/seal', () => ({
	openPayload: () => JSON.stringify({ accessToken: 'token', entitlementsToken: 'token' }),
	sealPayload: vi.fn()
}));
vi.mock('../../db', async () => ({
	getDb: mocks.getDb,
	schema: await import('../../db/schema')
}));
vi.mock('./assets', () => ({
	CURRENCY_ICONS: {},
	DEFAULT_ID_VP_PACK_PROFILE: {},
	EMPTY_ASSET_INDEX: {},
	getIdrToUsdFxRate: vi.fn(),
	getPlayerCardMeta: vi.fn(),
	getPlayerTitleText: vi.fn(),
	getValorantAssetIndex: vi.fn(async () => ({}))
}));
vi.mock('./client', () => ({
	fetchRiotClientVersion: vi.fn(async () => 'version'),
	fetchStorefront: vi.fn(async () => ({})),
	fetchWallet: vi.fn(async () => ({})),
	fetchOwnedCategory: vi.fn(async () => ({ Entitlements: [] })),
	fetchMatchHistory: vi.fn(async () => ({ History: [] })),
	fetchCompetitiveUpdates: vi.fn(async () => ({ Matches: [] })),
	fetchAccountXpRaw: vi.fn(async () => ({})),
	fetchPlayerMmrRaw: vi.fn(async () => ({}))
}));

beforeEach(() => {
	mocks.selectCount = 0;
	mocks.insert.mockReset();
	mocks.update.mockReset();
	const db = {
		select: () => {
			const index = mocks.selectCount++;
			return {
				from: () => ({
					where: () => ({
						limit: async () =>
							index === 0
								? [
										{
											id: 'account',
											userId: 'user',
											region: 'ap',
											puuid: 'player',
											lastSyncedAt: null
										}
									]
								: [
										{
											sealedPayload: 'sealed',
											accessTokenExpiresAt: new Date(Date.now() + 600_000)
										}
									],
						orderBy: () => Promise.reject(new Error('database read failed'))
					})
				})
			};
		},
		update: mocks.update.mockImplementation(() => ({
			set: () => ({
				where: () => ({ returning: async () => [{ id: 'account' }], catch: async () => {} })
			})
		})),
		insert: mocks.insert
	};
	mocks.getDb.mockReturnValue(db);
});

it('does not write or prune snapshots when the prior history read fails', async () => {
	const { syncValorantAccountData } = await import('./service');
	const result = await syncValorantAccountData('user', 'account');
	expect(result.ok).toBe(false);
	expect(result.error).toContain('preserve');
	expect(mocks.insert).not.toHaveBeenCalled();
});
