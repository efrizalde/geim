import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ durable: null as unknown }));

vi.mock('../../db', () => ({
	getDb: () => ({
		select: () => ({
			from: () => ({
				where: () => ({ limit: async () => (state.durable ? [{ value: state.durable }] : []) })
			})
		}),
		insert: () => ({ values: () => ({ onConflictDoUpdate: async () => {} }) })
	}),
	schema: { appState: { value: {}, key: {} } }
}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
	state.durable = null;
});

it('keeps the required catalog available when optional metadata requests time out', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url.includes('/contenttiers')) {
				return Response.json({ data: [{ uuid: 'tier', displayName: 'Test', devName: 'Test' }] });
			}
			if (url.includes('/weapons')) return Response.json({ data: [] });
			throw new Error('optional request timed out');
		})
	);
	const { getValorantAssetIndex } = await import('./assets');
	const result = await getValorantAssetIndex();
	expect(result.tiersById.has('tier')).toBe(true);
	expect(result.seasonsById.size).toBe(0);
});

it('retains durable optional metadata while refreshing the required catalog', async () => {
	state.durable = {
		v: 1,
		skins: [],
		tiers: [],
		compTiers: [],
		agents: [],
		maps: [],
		seasons: [{ uuid: 'season', actName: 'Act', fullLabel: 'Act', startTime: '', endTime: '' }]
	};
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			if (url.includes('/contenttiers'))
				return Response.json({
					data: [{ uuid: 'new-tier', displayName: 'Test', devName: 'Test' }]
				});
			if (url.includes('/weapons')) return Response.json({ data: [] });
			throw new Error('optional request timed out');
		})
	);
	const { getValorantAssetIndex } = await import('./assets');
	expect((await getValorantAssetIndex()).seasonsById.has('season')).toBe(true);
	await vi.waitFor(async () => {
		const index = await getValorantAssetIndex();
		expect(index.tiersById.has('new-tier')).toBe(true);
		expect(index.seasonsById.has('season')).toBe(true);
	});
});
