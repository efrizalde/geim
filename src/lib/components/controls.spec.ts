import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import InventorySection from './InventorySection.svelte';
import TrackerSection from './TrackerSection.svelte';

vi.mock('@lucide/svelte', () => ({
	ArrowUpDown: vi.fn(),
	Calendar: vi.fn(),
	Check: vi.fn(),
	ChevronDown: vi.fn(),
	Clock: vi.fn(),
	Crosshair: vi.fn(),
	Film: vi.fn(),
	Flame: vi.fn(),
	Info: vi.fn(),
	Lock: vi.fn(),
	Rotate3d: vi.fn(),
	Search: vi.fn(),
	Shield: vi.fn(),
	Sparkles: vi.fn(),
	Swords: vi.fn(),
	Trophy: vi.fn(),
	X: vi.fn(),
	Zap: vi.fn()
}));
vi.mock('./RarityCardShell.svelte', () => ({ default: vi.fn() }));
vi.mock('./RarityWeaponChamber.svelte', () => ({ default: vi.fn() }));

describe('themed dropdowns, rarity summary & form controls', () => {
	it('offers older matches when the selected filter has no loaded results', () => {
		const { body } = render(TrackerSection, {
			props: {
				ownerPuuid: 'owner',
				ownerAccount: { id: 'account', gameName: 'Player', tagLine: 'TAG' },
				profile: null,
				tracker: {
					latestSeasonId: 'old-act',
					latestSeasonLabel: 'Old act',
					hasFullActHistory: false,
					acts: [],
					matches: [],
					totalMatches: 45,
					queueTotals: { all: 45, competitive: 5 },
					seasonCounts: { competitive: { 'old-act': 5 } }
				}
			}
		});
		expect(body).toContain('Load older matches');
	});
	it('renders unified Owned Skins priced/unpriced section, rarity tier logos + counts, and sort controls', () => {
		const { body } = render(InventorySection, {
			props: {
				inventory: {
					rawSkinLevelCount: 12,
					rawChromaCount: 4,
					buddyCount: 7,
					ownedSkins: [
						{
							skinUuid: 's-1',
							displayName: 'Kuronami Vandal',
							weaponName: 'Vandal',
							isMelee: false,
							displayIcon: null,
							previewVideoUrl: null,
							tier: {
								uuid: 'e046854e-406c-37f4-6607-19a9ba8426fc',
								name: 'Exclusive Edition',
								devName: 'Exclusive',
								rank: 4,
								accentHex: '#f5955b',
								iconUrl:
									'https://media.valorant-api.com/contenttiers/e046854e-406c-37f4-6607-19a9ba8426fc/displayicon.png'
							},
							unlockedLevels: 4,
							totalLevels: 4,
							levels: [],
							unlockedChromas: 2,
							totalChromas: 4,
							chromas: [],
							source: 'store',
							vpPrice: 2375,
							fiatEstimate: 'Rp 221.963'
						},
						{
							skinUuid: 's-2',
							displayName: 'Reaver Vandal',
							weaponName: 'Vandal',
							isMelee: false,
							displayIcon: null,
							previewVideoUrl: null,
							tier: {
								uuid: '60bca009-4182-7998-dee7-b8a2558dc369',
								name: 'Premium Edition',
								devName: 'Premium',
								rank: 3,
								accentHex: '#d1548d',
								iconUrl:
									'https://media.valorant-api.com/contenttiers/60bca009-4182-7998-dee7-b8a2558dc369/displayicon.png'
							},
							unlockedLevels: 4,
							totalLevels: 4,
							levels: [],
							unlockedChromas: 1,
							totalChromas: 4,
							chromas: [],
							source: 'store',
							vpPrice: 1775,
							fiatEstimate: 'Rp 165.888'
						}
					],
					valuation: {
						ownedBaseSkinCount: 3,
						pricedBaseSkinCount: 2,
						unpricedBaseSkinCount: 1,
						isPartial: true,
						knownVpSubtotal: 4150,
						formattedEstimate: 'Rp 387.850',
						packBasisLabel: 'test',
						fxBasisLabel: null
					}
				},
				vpIconUrl: '',
				onInspectSkin: vi.fn()
			}
		});
		expect(body).toContain('data-sort-dropdown');
		expect(body).toContain('id="inv-sort"');
		expect(body).toContain('aria-haspopup="listbox"');
		expect(body).toContain('aria-label="Search collection"');
		expect(body).toContain('Price: High to Low');
		expect(body).toContain('Owned Skins');
		expect(body).toContain('Priced');
		expect(body).toContain('Unpriced');
		expect(body).toContain('Levels');
		expect(body).toContain('Chromas');
		expect(body).toContain('Buddies');
		expect(body).toContain('360° Studio');
		expect(body).toContain('title="Filter collection by Store (2)"');
		expect(body).toContain('Owned by Rarity Tier');
		expect(body).toContain('aria-label="Exclusive Edition: 1 owned"');
		expect(body).toContain('aria-label="Premium Edition: 1 owned"');
		expect(body).toContain('aria-label="Ultra Edition: 0 owned"');
	});

	it('renders the custom competitive act dropdown with rank icon and act label', () => {
		const { body } = render(TrackerSection, {
			props: {
				ownerPuuid: '',
				profile: null,
				tracker: {
					latestSeasonId: 'test-act',
					latestSeasonLabel: 'Test Act',
					hasFullActHistory: true,
					matches: [],
					acts: [
						{
							seasonId: 'test-act',
							label: 'Test Act',
							tier: 12,
							rankName: 'Test Rank',
							rankIcon: 'https://media.valorant-api.com/competitivetiers/rank.png',
							rankColorHex: '#94a3b8',
							peakTier: 12,
							peakRankName: 'Test Rank',
							peakRankIcon: null,
							rr: 50,
							wins: 3,
							losses: 2,
							games: 5,
							matchSampleCount: 4
						}
					]
				}
			}
		});
		expect(body).toContain('data-act-dropdown');
		expect(body).toContain('aria-label="Competitive act"');
		expect(body).toContain('aria-haspopup="listbox"');
		expect(body).toContain('https://media.valorant-api.com/competitivetiers/rank.png');
		expect(body).toContain('Test Act');
	});

	it('paginates match history across acts when current act has a small sample', () => {
		const mkMatch = (idx: number, seasonId: string) => ({
			matchId: `m-${idx}`,
			mapUrl: '/Game/Maps/Ascent/Ascent',
			mapName: `Map ${idx}`,
			mapIcon: null,
			mapSplash: null,
			queueId: 'competitive',
			seasonId,
			startedAt: new Date(1792857681602 - idx * 3600_000).toISOString(),
			durationSeconds: 1800,
			outcome: 'win' as const,
			roundsWon: 13,
			roundsLost: 7,
			roundsPlayed: 20,
			characterId: 'agent-clove',
			agentName: 'Clove',
			agentIcon: null,
			competitiveTier: 12,
			rankName: 'Gold 3',
			rankIcon: null,
			rrDelta: 20,
			isMatchMvp: false,
			isTeamMvp: false,
			kills: 20,
			deaths: 12,
			assists: 6,
			score: 4400,
			damageDealt: 3200,
			damageReceived: 2400,
			headshots: 16,
			bodyshots: 32,
			legshots: 2,
			kastRounds: 16,
			firstBloods: 2,
			flawlessRounds: 1,
			aces: 0,
			acs: 220,
			adr: 160,
			kd: 1.67,
			hsPercent: 32,
			kastPercent: 80,
			ddDeltaPerRound: 40,
			scoreboard: [],
			hasScoreboard: false
		});

		const { body } = render(TrackerSection, {
			props: {
				ownerPuuid: 'owner-1',
				ownerAccount: { id: 'acc-1', gameName: 'NAON', tagLine: 'EUY' },
				profile: null,
				tracker: {
					latestSeasonId: 'act-current',
					latestSeasonLabel: 'V26: ACT VI',
					hasFullActHistory: true,
					matches: [
						mkMatch(1, 'act-current'),
						mkMatch(2, 'act-current'),
						mkMatch(3, 'act-current'),
						mkMatch(4, 'act-prev'),
						mkMatch(5, 'act-prev'),
						mkMatch(6, 'act-prev')
					],
					acts: [
						{
							seasonId: 'act-current',
							label: 'V26: ACT VI',
							tier: 12,
							rankName: 'Gold 3',
							rankIcon: null,
							rankColorHex: '#94a3b8',
							peakTier: 12,
							peakRankName: 'Gold 3',
							peakRankIcon: null,
							rr: 31,
							wins: 3,
							losses: 0,
							games: 3,
							matchSampleCount: 3
						},
						{
							seasonId: 'act-prev',
							label: 'V26: ACT V',
							tier: 11,
							rankName: 'Silver 2',
							rankIcon: null,
							rankColorHex: '#94a3b8',
							peakTier: 11,
							peakRankName: 'Silver 2',
							peakRankIcon: null,
							rr: 0,
							wins: 2,
							losses: 5,
							games: 7,
							matchSampleCount: 3
						}
					]
				}
			}
		});

		expect(body).toContain('data-match-pagination');
		expect(body).toContain('aria-label="Match history pagination"');
		expect(body).toContain('aria-label="Next page"');
		expect(body).toContain('Fetch Deep History');
		expect(body).toContain('Map 1');
		expect(body).toContain('Map 5');
		expect(body).not.toContain('Map 6');
	});
});
