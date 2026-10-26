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
});
