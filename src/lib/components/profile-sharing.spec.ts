import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import MobileFloatingNav from './MobileFloatingNav.svelte';
import ProfileHero from './ProfileHero.svelte';
import ShareProfileDialog from './ShareProfileDialog.svelte';
import SharedStatsSection from './SharedStatsSection.svelte';

vi.mock('$app/forms', () => ({ enhance: vi.fn() }));
vi.mock('@lucide/svelte', () => ({
	Activity: vi.fn(),
	Backpack: vi.fn(),
	Check: vi.fn(),
	Clock: vi.fn(),
	Copy: vi.fn(),
	Crosshair: vi.fn(),
	ExternalLink: vi.fn(),
	Eye: vi.fn(),
	Flame: vi.fn(),
	Link2: vi.fn(),
	Lock: vi.fn(),
	RefreshCw: vi.fn(),
	Share2: vi.fn(),
	ShieldAlert: vi.fn(),
	ShieldCheck: vi.fn(),
	Store: vi.fn(),
	Swords: vi.fn(),
	Trash2: vi.fn(),
	Trophy: vi.fn(),
	X: vi.fn()
}));
vi.mock('$app/paths', () => ({
	resolve: (route: string, params?: { token: string }) =>
		route.replace('[token]', params?.token ?? '')
}));

describe('shared profile controls & mobile floating dock', () => {
	it('renders a read-only profile without wallet, shop, sync, disconnect, or publishing controls', () => {
		const { body } = render(ProfileHero, {
			props: {
				activeAccount: { gameName: 'TestPlayer', tagLine: 'TEST', shard: 'ap' },
				profile: null,
				currencyIcons: { vp: '', radianite: '', kingdomCredits: '' },
				wallet: { vp: 123456, radianite: 654321, kingdomCredits: 123789 },
				activeModule: 'inventory',
				onSelectModule: vi.fn(),
				relativeSyncText: '2026-10-26',
				readOnly: true
			}
		});
		expect(body).toContain('TestPlayer');
		expect(body).toContain('Stats');
		expect(body).toContain('Collection');
		expect(body.indexOf('Collection')).toBeLessThan(body.indexOf('Stats'));
		for (const privateControl of [
			'<form',
			'Daily Shop',
			'refreshAccount',
			'disconnectAccount',
			'Share Profile',
			'123,456'
		]) {
			expect(body).not.toContain(privateControl);
		}
	});

	it('renders aggregate metrics without a match list', () => {
		const { body } = render(SharedStatsSection, {
			props: {
				stats: {
					sampleCount: 2,
					wins: 1,
					losses: 1,
					draws: 0,
					kills: 30,
					deaths: 15,
					assists: 8,
					killDeathRatio: 2,
					winPercent: 50,
					averageCombatScore: 200,
					averageDamagePerRound: 150,
					headshotPercent: 25,
					kastPercent: 75
				}
			}
		});
		expect(body).toContain('50.0%');
		expect(body).toContain('K/D Ratio');
		expect(body).toContain('Performance Overview');
		expect(body).toContain('<svg');
		expect(body).toContain('2.00');
		expect(body).not.toContain('Match History');
		expect(body).not.toContain('<table');
	});

	it('renders an explicit publish confirmation and disables publishing unsynced accounts', () => {
		const { body } = render(ShareProfileDialog, {
			props: {
				accountId: 'account',
				riotId: 'TestPlayer#TEST',
				lastSyncedAt: null,
				existingPath: null,
				onClose: vi.fn()
			}
		});
		expect(body).toContain('<dialog');
		expect(body).toContain('aria-labelledby="share-title"');
		expect(body).toContain('Confirm &amp; Publish Profile');
		expect(body).toContain('name="confirmed" value="yes"');
		expect(body).toContain('disabled');
		expect(body).toContain('Sync this account before publishing');
		expect(body).toContain('Visible to Link Holders');
		expect(body).toContain('Always Kept Private');
	});

	it('renders frosted glass mobile floating nav with Overview, Daily Shop, and Collection tabs', () => {
		const ownerRender = render(MobileFloatingNav, {
			props: {
				activeModule: 'tracker',
				onSelectModule: vi.fn(),
				ownedSkinCount: 24,
				matchSampleCount: 15,
				shopCountdown: '08:12:30'
			}
		});
		expect(ownerRender.body).toContain('glass-dock');
		expect(ownerRender.body).toContain('aria-label="Overview &amp; Tracker"');
		expect(ownerRender.body).toContain('Daily Shop');
		expect(ownerRender.body).toContain('Collection');

		const readOnlyRender = render(MobileFloatingNav, {
			props: {
				activeModule: 'inventory',
				onSelectModule: vi.fn(),
				readOnly: true,
				ownedSkinCount: 24
			}
		});
		expect(readOnlyRender.body).toContain('Collection');
		expect(readOnlyRender.body).toContain('Stats');
		expect(readOnlyRender.body).not.toContain('Daily Shop');
	});
});
