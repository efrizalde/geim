import { describe, expect, it } from 'vitest';
import { resolveRaritySpec, toProxiedValorantMediaUrl } from '../rarity';
import { hashPassword, validatePassword, validateUsername, verifyPassword } from './auth/password';
import { lookupVerifiedSkinCatalog } from './providers/valorant/skin-catalog';
import { checkLoginRateLimit, clearFailedLogins, recordFailedLogin } from './auth/rate-limit';
import { redactSecrets } from './crypto/redact';
import { openPayload, sealPayload } from './crypto/seal';
import { VALORANT_CURRENCIES, VALORANT_ITEM_TYPES } from './providers/valorant/constants';
import {
	extractBaseSkinVpPrices,
	normalizeStorefront,
	normalizeWallet,
	parseAuthRedirectUrl
} from './providers/valorant/schemas';
import {
	collectMissingNamePuuids,
	extractCareerProfile,
	hydrateMatchesWithAssets,
	parseDetailedMatch
} from './providers/valorant/tracker';
import { calculateProportionalValuation } from './valuation/money';

const TEST_HEX_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('AES-256-GCM session envelope (seal / open)', () => {
	it('round-trips session JSON bound to an account AAD and rejects cross-account swaps', () => {
		const sessionJson = JSON.stringify({ ssid: 'secret-cookie-val', shard: 'ap' });
		const sealed = sealPayload(sessionJson, TEST_HEX_KEY, 'account-uuid-1');

		expect(sealed.startsWith('v1.')).toBe(true);
		expect(sealed).not.toContain('secret-cookie-val');
		expect(openPayload(sealed, TEST_HEX_KEY, 'account-uuid-1')).toBe(sessionJson);

		expect(() => openPayload(sealed, TEST_HEX_KEY, 'account-uuid-2')).toThrow();
	});

	it('rejects tampered ciphertext', () => {
		const sealed = sealPayload('{"ok":true}', TEST_HEX_KEY);
		const parts = sealed.split('.');
		parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');

		expect(() => openPayload(parts.join('.'), TEST_HEX_KEY)).toThrow();
	});
});

describe('secret redaction', () => {
	it('redacts OAuth fragments, cookies, bearer tokens, JWTs, and JSON passwords', () => {
		const fakeJwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJwdXVpZC0xMjMifQ.signature123';
		const dirty = [
			`https://playvalorant.com/opt_in#access_token=${fakeJwt}&id_token=${fakeJwt}&expires_in=3600`,
			'Cookie: ssid=supersecretssid; tdid=my_tdid; clid=ap1',
			'Authorization: Bearer secret_bearer_tok',
			'{"username":"player","password":"myHunter2Password"}'
		].join(' | ');

		const clean = redactSecrets(dirty);
		expect(clean).not.toContain('supersecretssid');
		expect(clean).not.toContain('secret_bearer_tok');
		expect(clean).not.toContain('myHunter2Password');
		expect(clean).not.toContain(fakeJwt);
		expect(clean).toContain('[REDACTED]');
	});
});

describe('VALORANT storefront, wallet & catalog normalization', () => {
	it('parses redirect URL fragments cleanly', () => {
		const parsed = parseAuthRedirectUrl(
			'https://playvalorant.com/opt_in#access_token=tok_abc&id_token=id_xyz&token_type=Bearer&expires_in=3600'
		);
		expect(parsed).toEqual({
			accessToken: 'tok_abc',
			idToken: 'id_xyz',
			expiresInSeconds: 3600
		});
	});

	it('distinguishes absent BonusStore from active Night Market and anchors expiry to fetchedAt', () => {
		const fetchedAt = new Date('2026-10-26T10:00:00.000Z');
		const rawDailyOnly = {
			SkinsPanelLayout: {
				SingleItemOffers: ['skin-level-1'],
				SingleItemStoreOffers: [
					{
						OfferID: 'offer-1',
						Cost: { [VALORANT_CURRENCIES.VP]: 1775 },
						Rewards: [
							{
								ItemTypeID: VALORANT_ITEM_TYPES.SKIN_LEVELS,
								ItemID: 'skin-level-1',
								Quantity: 1
							}
						]
					}
				],
				SingleItemOffersRemainingDurationInSeconds: 3600
			},
			BonusStore: null
		};

		const dailyNormalized = normalizeStorefront(rawDailyOnly, fetchedAt);
		expect(dailyNormalized.dailyExpiresAt).toBe('2026-10-26T11:00:00.000Z');
		expect(dailyNormalized.dailyOffers[0]?.vpPrice).toBe(1775);
		expect(dailyNormalized.nightMarket).toEqual({ status: 'absent' });

		const rawWithBonus = {
			...rawDailyOnly,
			BonusStore: {
				BonusStoreRemainingDurationInSeconds: 7200,
				BonusStoreOffers: [
					{
						BonusOfferID: 'bonus-1',
						DiscountPercent: 34,
						DiscountCosts: { [VALORANT_CURRENCIES.VP]: 1171 },
						IsSeen: true,
						Offer: {
							OfferID: 'offer-reaver',
							Cost: { [VALORANT_CURRENCIES.VP]: 1775 },
							Rewards: [
								{
									ItemTypeID: VALORANT_ITEM_TYPES.SKIN_LEVELS,
									ItemID: 'reaver-vandal-lvl1',
									Quantity: 1
								}
							]
						}
					}
				]
			}
		};

		const bonusNormalized = normalizeStorefront(rawWithBonus, fetchedAt);
		expect(bonusNormalized.nightMarket.status).toBe('active');
		if (bonusNormalized.nightMarket.status === 'active') {
			expect(bonusNormalized.nightMarket.expiresAt).toBe('2026-10-26T12:00:00.000Z');
			expect(bonusNormalized.nightMarket.offers[0]).toMatchObject({
				skinLevelId: 'reaver-vandal-lvl1',
				baseVpPrice: 1775,
				discountedVpPrice: 1171,
				discountPercent: 34
			});
		}
	});

	it('preserves 0 balance versus null (missing currency) in wallet responses', () => {
		const wallet = normalizeWallet({
			Balances: {
				[VALORANT_CURRENCIES.VP]: 0,
				[VALORANT_CURRENCIES.RADIANITE]: 140
			}
		});

		expect(wallet.vp).toBe(0);
		expect(wallet.radianite).toBe(140);
		expect(wallet.kingdomCredits).toBeNull();
	});

	it('indexes single-item skin level VP offers while ignoring multi-item bundles', () => {
		const catalogMap = extractBaseSkinVpPrices({
			Offers: [
				{
					OfferID: 'single-skin',
					Cost: { [VALORANT_CURRENCIES.VP]: 2175 },
					Rewards: [
						{
							ItemTypeID: VALORANT_ITEM_TYPES.SKIN_LEVELS,
							ItemID: 'Kuronami-Vandal-Lvl1',
							Quantity: 1
						}
					]
				},
				{
					OfferID: 'bundle-offer',
					Cost: { [VALORANT_CURRENCIES.VP]: 7100 },
					Rewards: [
						{ ItemTypeID: VALORANT_ITEM_TYPES.SKIN_LEVELS, ItemID: 'item-a', Quantity: 1 },
						{ ItemTypeID: VALORANT_ITEM_TYPES.SKIN_LEVELS, ItemID: 'item-b', Quantity: 1 }
					]
				}
			]
		});

		expect(catalogMap.get('kuronami-vandal-lvl1')).toBe(2175);
		expect(catalogMap.has('item-a')).toBe(false);
	});

	it('prices melee & exclusive skin-level offers with case-insensitive UUIDs and tolerates nullable catalog fields', () => {
		const catalogMap = extractBaseSkinVpPrices({
			Offers: [
				{
					OfferID: 'recon-balisong-offer',
					IsDirectPurchase: true,
					StartDate: null,
					Cost: { [VALORANT_CURRENCIES.VP.toUpperCase()]: 3550 },
					Rewards: [
						{
							ItemTypeID: VALORANT_ITEM_TYPES.SKIN_LEVELS.toUpperCase(),
							ItemID: 'Recon-Balisong-Level-1',
							Quantity: 1
						}
					]
				},
				{
					OfferID: 'luxe-knife-offer',
					Cost: { [VALORANT_CURRENCIES.VP]: 1750 },
					Rewards: [
						{
							ItemTypeID: VALORANT_ITEM_TYPES.SKIN_LEVELS,
							ItemID: 'luxe-knife-level-1'
						}
					]
				},
				{
					OfferID: 'malformed-free-or-spray-offer',
					Cost: null,
					Rewards: null
				}
			]
		});

		expect(catalogMap.get('recon-balisong-level-1')).toBe(3550);
		expect(catalogMap.get('luxe-knife-level-1')).toBe(1750);
		expect(catalogMap.size).toBe(2);
	});
});

describe('fixed-point inventory valuation', () => {
	it('deduplicates base skins, separates unpriced items, and converts IDR <-> USD accurately', () => {
		const skins = [
			{ baseSkinId: 'skin-vandal-prime', vpPrice: 1775 },
			{ baseSkinId: 'SKIN-VANDAL-PRIME', vpPrice: 1775 }, // duplicate level/variant entry
			{ baseSkinId: 'skin-melee-kuronami', vpPrice: 5350 },
			{ baseSkinId: 'skin-battlepass-1', vpPrice: null }, // unpriced, must not become 0
			{ baseSkinId: 'skin-classic-free', vpPrice: 0 } // confirmed free
		];

		// Example IDR pack profile: 5350 VP for Rp 500.000
		const idrPack = {
			id: 'id-5350',
			regionCode: 'ID',
			packVpTotal: 5350,
			packPriceMinor: 500_000n,
			currency: 'IDR' as const,
			source: 'test-fixture',
			verifiedAt: '2026-10-26',
			isCustom: false
		};

		const inIdr = calculateProportionalValuation({
			skins,
			packProfile: idrPack,
			displayCurrency: 'IDR'
		});

		expect(inIdr.ownedBaseSkinCount).toBe(4);
		expect(inIdr.pricedBaseSkinCount).toBe(3);
		expect(inIdr.unpricedBaseSkinCount).toBe(1);
		expect(inIdr.isPartial).toBe(true);
		expect(inIdr.knownVpSubtotal).toBe(7125); // 1775 + 5350 + 0
		// 7125 * 500000 / 5350 = 665887.85 -> 665888 IDR
		expect(inIdr.estimatedDisplayMinor).toBe(665_888n);

		// Convert IDR -> USD at 1 IDR = 0.00006250 USD (1 USD = 16,000 IDR -> rateScaledE8 = 6250n)
		const inUsd = calculateProportionalValuation({
			skins,
			packProfile: idrPack,
			displayCurrency: 'USD',
			fxRate: {
				baseCurrency: 'IDR',
				quoteCurrency: 'USD',
				rateScaledE8: 6250n,
				source: 'test-fx',
				asOf: '2026-10-26'
			}
		});

		// 665887.850467 IDR / 16000 = $41.61799 -> 4162 cents ($41.62)
		expect(inUsd.estimatedDisplayMinor).toBe(4162n);
		expect(inUsd.formattedEstimate).toBe('$41.62');
	});
});

describe('account credentials & login rate limiter', () => {
	it('accepts any password of length >= 4 without complexity rules and rejects < 4', () => {
		expect(validatePassword('').ok).toBe(false);
		expect(validatePassword('123').ok).toBe(false);
		expect(validatePassword('1234')).toEqual({ ok: true, value: '1234' });
		expect(validatePassword('abcd')).toEqual({ ok: true, value: 'abcd' });
		expect(validatePassword('    ')).toEqual({ ok: true, value: '    ' });
		expect(validatePassword('a'.repeat(129)).ok).toBe(false);
	});

	it('normalizes usernames and rejects malformed or oversized input', () => {
		expect(validateUsername(' Player_1 ')).toEqual({ ok: true, value: 'player_1' });
		for (const input of [null, 'ab', 'a'.repeat(33), 'player name', '<script>', '\u0130user']) {
			expect(validateUsername(input).ok).toBe(false);
		}
	});

	it('hashes and verifies passwords in constant time with scrypt', async () => {
		const hash = await hashPassword('1234');
		expect(hash.startsWith('scryptv1$')).toBe(true);
		expect(await verifyPassword('1234', hash)).toBe(true);
		expect(await verifyPassword('1235', hash)).toBe(false);
	});

	it('throttles repeated failed login attempts and resets on clear', () => {
		const ip = 'test-ip-1';
		const t0 = 1_000_000;
		for (let i = 0; i < 5; i++) {
			expect(checkLoginRateLimit(ip, t0).allowed).toBe(true);
			recordFailedLogin(ip, t0);
		}

		const blocked = checkLoginRateLimit(ip, t0 + 5_000);
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterSeconds).toBe(55);

		clearFailedLogins(ip);
		expect(checkLoginRateLimit(ip, t0 + 5_000).allowed).toBe(true);
	});
});

describe('VALORANT career profile & detailed match telemetry parser', () => {
	it('extracts level, current rank, and breaks peak rank ties by most recent season startTime', () => {
		const seasonsById = new Map([
			[
				'season-old',
				{
					uuid: 'season-old',
					actName: 'ACT II',
					fullLabel: 'V25: ACT II',
					startTime: '2025-03-01T00:00:00Z',
					endTime: '2025-05-01T00:00:00Z'
				}
			],
			[
				'season-newer',
				{
					uuid: 'season-newer',
					actName: 'ACT VI',
					fullLabel: 'V25: ACT VI',
					startTime: '2025-10-15T00:00:00Z',
					endTime: '2026-01-08T00:00:00Z'
				}
			],
			[
				'season-current',
				{
					uuid: 'season-current',
					actName: 'ACT VI',
					fullLabel: 'V26: ACT VI',
					startTime: '2026-10-01T00:00:00Z',
					endTime: '2026-12-15T00:00:00Z'
				}
			]
		]);

		const profile = extractCareerProfile({
			rawXp: { Progress: { Level: 230, XP: 4120 } },
			rawMmr: {
				LatestCompetitiveUpdate: {
					MatchID: 'match-comp-1',
					SeasonID: 'season-current',
					TierAfterUpdate: 12,
					RankedRatingAfterUpdate: 31,
					RankedRatingEarned: 21
				},
				QueueSkills: {
					competitive: {
						SeasonalInfoBySeasonID: {
							'season-old': {
								SeasonID: 'season-old',
								CompetitiveTier: 17,
								WinsByTier: { '18': 3 }
							},
							'season-newer': {
								SeasonID: 'season-newer',
								CompetitiveTier: 18,
								WinsByTier: { '18': 5 }
							},
							'season-current': {
								SeasonID: 'season-current',
								CompetitiveTier: 12,
								RankedRating: 31,
								NumberOfWinsWithPlacements: 3,
								NumberOfGames: 3,
								WinsByTier: { '12': 3 }
							}
						}
					}
				}
			},
			latestMatchRaw: {
				players: [
					{
						subject: 'owner-puuid',
						playerCard: 'card-clove-uuid',
						playerTitle: 'title-uuid'
					}
				]
			},
			ownerPuuid: 'owner-puuid',
			seasonsById
		});

		expect(profile.accountLevel).toBe(230);
		expect(profile.playerCardId).toBe('card-clove-uuid');
		expect(profile.currentTier).toBe(12);
		expect(profile.currentRr).toBe(31);
		expect(profile.lastRrDelta).toBe(21);
		expect(profile.actWins).toBe(3);
		expect(profile.actGames).toBe(3);
		expect(profile.peakTier).toBe(18);
		expect(profile.peakSeasonId).toBe('season-newer');
		expect(profile.actHistory?.map((a) => a.seasonId)).toEqual([
			'season-current',
			'season-newer',
			'season-old'
		]);
	});

	it('computes ADR, HS%, KAST% (including 5s trade window), First Bloods, Flawless, and Aces', () => {
		const rawMatch = {
			matchInfo: {
				matchId: 'match-comp-1',
				mapId: '/Game/Maps/Ascent/Ascent',
				queueID: 'competitive',
				seasonId: 'season-current',
				gameStartMillis: 1761470000000,
				gameLengthMillis: 1800000
			},
			teams: [
				{ teamId: 'Blue', won: true, roundsPlayed: 2, roundsWon: 2 },
				{ teamId: 'Red', won: false, roundsPlayed: 2, roundsWon: 0 }
			],
			players: [
				{
					subject: 'owner-puuid',
					gameName: 'NAON',
					tagLine: 'EUY',
					teamId: 'Blue',
					characterId: 'agent-clove',
					competitiveTier: 12,
					stats: { score: 620, roundsPlayed: 2, kills: 5, deaths: 1, assists: 0 }
				},
				{
					subject: 'ally-puuid',
					gameName: 'Ally',
					tagLine: '001',
					teamId: 'Blue',
					characterId: 'agent-jett',
					competitiveTier: 13,
					stats: { score: 310, roundsPlayed: 2, kills: 1, deaths: 0, assists: 1 }
				},
				{
					subject: 'enemy-puuid',
					gameName: 'Enemy',
					tagLine: '999',
					teamId: 'Red',
					characterId: 'agent-omen',
					competitiveTier: 12,
					stats: { score: 210, roundsPlayed: 2, kills: 1, deaths: 2, assists: 0 }
				}
			],
			roundResults: [
				{
					// Round 0: Owner gets an Ace (5 kills), First Blood, and Flawless ceremony
					roundNum: 0,
					winningTeam: 'Blue',
					roundCeremony: 'CeremonyFlawless',
					firstBloodPlayer: 'owner-puuid',
					playerStats: [
						{
							subject: 'owner-puuid',
							damage: [
								{ receiver: 'enemy-puuid', damage: 200, headshots: 2, bodyshots: 2, legshots: 0 }
							],
							kills: [
								{ roundTime: 12000, killer: 'owner-puuid', victim: 'enemy-puuid', assistants: [] },
								{ roundTime: 15000, killer: 'owner-puuid', victim: 'e2', assistants: [] },
								{ roundTime: 18000, killer: 'owner-puuid', victim: 'e3', assistants: [] },
								{ roundTime: 22000, killer: 'owner-puuid', victim: 'e4', assistants: [] },
								{ roundTime: 26000, killer: 'owner-puuid', victim: 'e5', assistants: [] }
							]
						}
					]
				},
				{
					// Round 1: Owner dies at 20000ms with 0 kills/assists, but Ally trades the killer at 23500ms (<= 5000ms -> KAST!)
					roundNum: 1,
					winningTeam: 'Blue',
					playerStats: [
						{
							subject: 'owner-puuid',
							damage: [
								{ receiver: 'enemy-puuid', damage: 100, headshots: 0, bodyshots: 2, legshots: 0 }
							],
							kills: []
						},
						{
							subject: 'enemy-puuid',
							damage: [
								{ receiver: 'owner-puuid', damage: 150, headshots: 1, bodyshots: 0, legshots: 0 }
							],
							kills: [
								{ roundTime: 20000, killer: 'enemy-puuid', victim: 'owner-puuid', assistants: [] }
							]
						},
						{
							subject: 'ally-puuid',
							damage: [
								{ receiver: 'enemy-puuid', damage: 160, headshots: 1, bodyshots: 0, legshots: 0 }
							],
							kills: [
								{ roundTime: 23500, killer: 'ally-puuid', victim: 'enemy-puuid', assistants: [] }
							]
						}
					]
				}
			]
		};

		const parsed = parseDetailedMatch(rawMatch, 'owner-puuid', {
			matchId: 'match-comp-1',
			rrDelta: 21
		});

		expect(parsed).not.toBeNull();
		expect(parsed?.outcome).toBe('win');
		expect(parsed?.rrDelta).toBe(21);
		expect(parsed?.isMatchMvp).toBe(true);
		expect(parsed?.damageDealt).toBe(300);
		expect(parsed?.damageReceived).toBe(150);
		expect(parsed?.headshots).toBe(2);
		expect(parsed?.bodyshots).toBe(4);
		expect(parsed?.firstBloods).toBe(1);
		expect(parsed?.flawlessRounds).toBe(1);
		expect(parsed?.aces).toBe(1);
		expect(parsed?.kastRounds).toBe(2); // Round 0 (Kill/Survived) + Round 1 (Traded within 3.5s)
	});

	it('resolves empty match-details Riot IDs via Name Service map and preserves agent fallback metadata when hidden', () => {
		const rawMatchWithBlankNames = {
			matchInfo: {
				matchId: 'match-incognito',
				mapId: '/Game/Maps/Ascent/Ascent',
				queueID: 'competitive',
				seasonId: 'season-current',
				gameStartMillis: 1761470000000,
				gameLengthMillis: 1800000
			},
			teams: [{ teamId: 'Blue', won: true, roundsPlayed: 1, roundsWon: 1 }],
			players: [
				{
					subject: 'owner-puuid',
					gameName: '',
					tagLine: '',
					teamId: 'Blue',
					characterId: 'agent-clove',
					stats: { score: 300, roundsPlayed: 1, kills: 2, deaths: 0, assists: 0 }
				},
				{
					subject: 'resolved-ally-puuid',
					gameName: '',
					tagLine: '',
					teamId: 'Blue',
					characterId: 'agent-jett',
					stats: { score: 200, roundsPlayed: 1, kills: 1, deaths: 0, assists: 1 }
				},
				{
					subject: 'hidden-enemy-puuid',
					gameName: '',
					tagLine: '',
					teamId: 'Red',
					characterId: 'agent-omen',
					stats: { score: 100, roundsPlayed: 1, kills: 0, deaths: 1, assists: 0 }
				}
			],
			roundResults: []
		};

		expect(collectMissingNamePuuids([rawMatchWithBlankNames])).toEqual([
			'owner-puuid',
			'resolved-ally-puuid',
			'hidden-enemy-puuid'
		]);

		const resolvedNames = new Map([['resolved-ally-puuid', { gameName: 'TenZ', tagLine: 'NA1' }]]);

		const parsed = parseDetailedMatch(
			rawMatchWithBlankNames,
			'owner-puuid',
			undefined,
			resolvedNames
		);
		expect(parsed).not.toBeNull();

		const hydrated = hydrateMatchesWithAssets(
			[parsed!],
			{
				bySkinLevelId: new Map(),
				bySkinUuid: new Map(),
				tiersById: new Map(),
				competitiveTiersById: new Map(),
				seasonsById: new Map(),
				agentsById: new Map([
					[
						'agent-clove',
						{
							uuid: 'agent-clove',
							displayName: 'Clove',
							roleName: 'Controller',
							roleIcon: null,
							displayIcon: null,
							bustPortrait: null
						}
					],
					[
						'agent-jett',
						{
							uuid: 'agent-jett',
							displayName: 'Jett',
							roleName: 'Duelist',
							roleIcon: null,
							displayIcon: null,
							bustPortrait: null
						}
					],
					[
						'agent-omen',
						{
							uuid: 'agent-omen',
							displayName: 'Omen',
							roleName: 'Controller',
							roleIcon: null,
							displayIcon: null,
							bustPortrait: null
						}
					]
				]),
				mapsByUrl: new Map(),
				currencyIcons: { vp: '', radianite: '', kingdomCredits: '' }
			},
			{ puuid: 'owner-puuid', gameName: 'NAON', tagLine: 'EUY' }
		);

		const board = hydrated[0]!.scoreboard;
		expect(board.find((p) => p.puuid === 'owner-puuid')).toMatchObject({
			gameName: 'NAON',
			tagLine: 'EUY',
			agentName: 'Clove'
		});
		expect(board.find((p) => p.puuid === 'resolved-ally-puuid')).toMatchObject({
			gameName: 'TenZ',
			tagLine: 'NA1',
			agentName: 'Jett'
		});
		expect(board.find((p) => p.puuid === 'hidden-enemy-puuid')).toMatchObject({
			gameName: '',
			tagLine: '',
			agentName: 'Omen'
		});
	});
});

describe('progressive rarity visual spec & WebGL media proxy', () => {
	it('escalates particle count, float amplitude, 3D tilt, and conic/halo effects across ranks 0..5', () => {
		const mkTier = (devName: string, rank: number) => ({
			uuid: `tier-${devName}`,
			name: `${devName} Edition`,
			devName,
			iconUrl: null,
			accentHex: '#ffffff',
			rank
		});

		const tiers = [
			resolveRaritySpec(null),
			resolveRaritySpec(mkTier('Select', 1)),
			resolveRaritySpec(mkTier('Deluxe', 2)),
			resolveRaritySpec(mkTier('Premium', 3)),
			resolveRaritySpec(mkTier('Exclusive', 4)),
			resolveRaritySpec(mkTier('Ultra', 5))
		];

		expect(tiers.map((t) => t.rank)).toEqual([0, 1, 2, 3, 4, 5]);

		for (let i = 1; i < tiers.length; i++) {
			expect(tiers[i]!.tiltMaxDeg).toBeGreaterThanOrEqual(tiers[i - 1]!.tiltMaxDeg);
			expect(tiers[i]!.floatAmplitudePx).toBeGreaterThanOrEqual(tiers[i - 1]!.floatAmplitudePx);
			expect(tiers[i]!.particleCount).toBeGreaterThanOrEqual(tiers[i - 1]!.particleCount);
		}

		expect(tiers[3]!.hasAnimatedBorder).toBe(true); // Premium+
		expect(tiers[4]!.hasHaloRing).toBe(true); // Exclusive+
		expect(tiers[5]!.hasFoilShimmer).toBe(true); // Ultra
	});

	it('proxies only https://media.valorant-api.com/* URLs for CORS-safe WebGL textures', () => {
		const raw = 'https://media.valorant-api.com/weaponskinlevels/abc-123/displayicon.png';
		expect(toProxiedValorantMediaUrl(raw)).toBe(
			`/api/valorant-media?url=${encodeURIComponent(raw)}`
		);
		expect(toProxiedValorantMediaUrl('https://evil.example.com/icon.png')).toBe(
			'https://evil.example.com/icon.png'
		);
		expect(toProxiedValorantMediaUrl(null)).toBeNull();
	});

	it('resolves exact Store Exclusive, Store Melee, Battle Pass Melee, and Agent Gear VP prices', () => {
		expect(lookupVerifiedSkinCatalog('980fa063-436e-e51f-c38d-70a5b93a0f1c')).toEqual({
			vp: 2675,
			source: 'store'
		}); // Spectrum Phantom
		expect(lookupVerifiedSkinCatalog('f743fe2f-4cab-71d9-81e2-5b8f2f52923f')).toEqual({
			vp: 2375,
			source: 'store'
		}); // Kuronami Spectre
		expect(lookupVerifiedSkinCatalog('4ccb9517-4762-eb45-1242-7ca667223459')).toEqual({
			vp: 2175,
			source: 'store'
		}); // Arcane Vandal
		expect(lookupVerifiedSkinCatalog('39cf499b-4f82-e875-5320-b0a1d7fc58d4')).toEqual({
			vp: 3550,
			source: 'store'
		}); // Recon Balisong
		expect(lookupVerifiedSkinCatalog('4af88517-4949-9caa-9dda-1980f07202a4')).toEqual({
			vp: 1750,
			source: 'store'
		}); // Luxe Knife
		expect(lookupVerifiedSkinCatalog('3562e143-49eb-08be-2d0a-98a1f06fb7bd')).toEqual({
			vp: 1000,
			source: 'battle_pass'
		}); // Comet Sword
	});
});
