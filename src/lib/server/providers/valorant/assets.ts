import { z } from 'zod';
import { VALORANT_CURRENCIES } from './constants';
import { lookupVerifiedSkinCatalog, type SkinAcquisitionSource } from './skin-catalog';
import type { DatedFxRate, RegionalVpPackProfile } from '../../valuation/money';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const FX_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface TierMetadata {
	uuid: string;
	name: string;
	devName: string;
	rank: number;
	accentHex: string;
	iconUrl: string | null;
}

export interface ChromaMetadata {
	uuid: string;
	displayName: string;
	displayIcon: string | null;
	fullRender: string | null;
	swatch: string | null;
	streamedVideo: string | null;
}

export interface SkinLevelMetadata {
	uuid: string;
	levelNumber: number;
	displayName: string;
	effectLabel: string;
	displayIcon: string | null;
	streamedVideo: string | null;
}

export interface SkinMetadata {
	skinUuid: string;
	displayName: string;
	weaponName: string;
	isMelee: boolean;
	isStandardOrRandom: boolean;
	displayIcon: string | null;
	wallpaper: string | null;
	tier: TierMetadata | null;
	standardTierVpPrice: number | null;
	source: SkinAcquisitionSource;
	levelIds: string[];
	levels: SkinLevelMetadata[];
	chromas: ChromaMetadata[];
	previewVideoUrl: string | null;
}

export interface CompetitiveTierMeta {
	tier: number;
	tierName: string;
	divisionName: string;
	smallIcon: string | null;
	largeIcon: string | null;
	colorHex: string;
}

export interface SeasonMeta {
	uuid: string;
	actName: string;
	fullLabel: string; // e.g. "V26: ACT VI"
	startTime: string;
	endTime: string;
}

export interface AgentMeta {
	uuid: string;
	displayName: string;
	roleName: string | null;
	roleIcon: string | null;
	displayIcon: string | null;
	bustPortrait: string | null;
}

export interface MapMeta {
	uuid: string;
	mapUrl: string;
	displayName: string;
	listViewIcon: string | null;
	splash: string | null;
}

export interface PlayerCardMeta {
	uuid: string;
	displayName: string;
	displayIcon: string | null;
	smallArt: string | null;
	wideArt: string | null;
	largeArt: string | null;
}

export interface ValorantAssetIndex {
	bySkinLevelId: Map<string, SkinMetadata>;
	bySkinUuid: Map<string, SkinMetadata>;
	tiersById: Map<string, TierMetadata>;
	competitiveTiersById: Map<number, CompetitiveTierMeta>;
	seasonsById: Map<string, SeasonMeta>;
	agentsById: Map<string, AgentMeta>;
	mapsByUrl: Map<string, MapMeta>;
	currencyIcons: {
		vp: string;
		radianite: string;
		kingdomCredits: string;
	};
}

const STANDARD_FIREARM_TIER_VP: Record<string, number> = {
	'12683d76-48d7-84a3-4e09-6985794f0445': 875, // Select
	'0cebb8be-46d7-c12a-d306-e9907bfc5a25': 1275, // Deluxe
	'60bca009-4182-7998-dee7-b8a2558dc369': 1775, // Premium
	'e046854e-406c-37f4-6607-19a9ba8426fc': 2175, // Exclusive baseline fallback
	'411e4a55-4e59-7757-41f0-86a53f101bb5': 2475 // Ultra
};

const ContentTiersApiSchema = z.object({
	data: z.array(
		z.object({
			uuid: z.string(),
			displayName: z.string(),
			devName: z.string(),
			rank: z.number().optional(),
			highlightColor: z.string().nullable().optional(),
			displayIcon: z.string().nullable().optional()
		})
	)
});

const WeaponsApiSchema = z.object({
	data: z.array(
		z.object({
			uuid: z.string(),
			displayName: z.string(),
			category: z.string().nullable().optional(),
			defaultSkinUuid: z.string().nullable().optional(),
			skins: z.array(
				z.object({
					uuid: z.string(),
					displayName: z.string(),
					contentTierUuid: z.string().nullable().optional(),
					wallpaper: z.string().nullable().optional(),
					displayIcon: z.string().nullable().optional(),
					chromas: z.array(
						z.object({
							uuid: z.string(),
							displayName: z.string(),
							displayIcon: z.string().nullable().optional(),
							fullRender: z.string().nullable().optional(),
							swatch: z.string().nullable().optional(),
							streamedVideo: z.string().nullable().optional()
						})
					),
					levels: z.array(
						z.object({
							uuid: z.string(),
							displayName: z.string().nullable().optional(),
							levelItem: z.string().nullable().optional(),
							displayIcon: z.string().nullable().optional(),
							streamedVideo: z.string().nullable().optional()
						})
					)
				})
			)
		})
	)
});

const CompetitiveTiersApiSchema = z.object({
	data: z.array(
		z.object({
			uuid: z.string(),
			tiers: z.array(
				z.object({
					tier: z.number(),
					tierName: z.string(),
					divisionName: z.string(),
					color: z.string().nullable().optional(),
					smallIcon: z.string().nullable().optional(),
					largeIcon: z.string().nullable().optional()
				})
			)
		})
	)
});

const SeasonsApiSchema = z.object({
	data: z.array(
		z.object({
			uuid: z.string(),
			displayName: z.string(),
			parentUuid: z.string().nullable().optional(),
			startTime: z.string(),
			endTime: z.string()
		})
	)
});

const AgentsApiSchema = z.object({
	data: z.array(
		z.object({
			uuid: z.string(),
			displayName: z.string(),
			displayIcon: z.string().nullable().optional(),
			bustPortrait: z.string().nullable().optional(),
			fullPortrait: z.string().nullable().optional(),
			role: z
				.object({
					displayName: z.string(),
					displayIcon: z.string().nullable().optional()
				})
				.nullable()
				.optional()
		})
	)
});

const MapsApiSchema = z.object({
	data: z.array(
		z.object({
			uuid: z.string(),
			displayName: z.string(),
			mapUrl: z.string().nullable().optional(),
			listViewIcon: z.string().nullable().optional(),
			splash: z.string().nullable().optional()
		})
	)
});

function titleCaseRank(raw: string): string {
	return raw
		.toLowerCase()
		.split(' ')
		.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
		.join(' ');
}

const LEVEL_ITEM_LABELS: Record<string, string> = {
	VFX: 'Custom VFX',
	SFX: 'Custom SFX',
	SoundEffects: 'Custom SFX',
	Animation: 'Custom Animation',
	Finisher: 'Kill Finisher',
	KillBanner: 'Kill Banner',
	KillCounter: 'Kill Counter',
	KillEffect: 'Kill Effect',
	Transformation: 'Model Transformation',
	InspectAndKill: 'Inspect & Kill Audio',
	TopFrag: 'Champion Aura',
	HeartbeatAndMapSensor: 'Heartbeat Sensor',
	Randomizer: 'Skin Randomizer',
	FishAnimation: 'Aquarium Animation',
	Voiceover: 'Custom Voiceover',
	AttackerDefenderSwap: 'Side-Swap Form'
};

function formatLevelEffectLabel(rawLevelItem: string | null | undefined, index: number): string {
	if (!rawLevelItem) {
		return index === 0 ? 'Base Model' : `Level ${index + 1} Upgrade`;
	}
	const key = rawLevelItem.replace(/^EEquippableSkinLevelItem::/, '').trim();
	if (LEVEL_ITEM_LABELS[key]) return LEVEL_ITEM_LABELS[key];
	return key.replace(/([a-z])([A-Z])/g, '$1 $2');
}

let cachedAssets: { index: ValorantAssetIndex; expiresAt: number } | undefined;

export async function getValorantAssetIndex(): Promise<ValorantAssetIndex> {
	const now = Date.now();
	if (cachedAssets && cachedAssets.expiresAt > now) {
		return cachedAssets.index;
	}

	const [tiersRes, weaponsRes, compTiersRes, seasonsRes, agentsRes, mapsRes] = await Promise.all([
		fetch('https://valorant-api.com/v1/contenttiers', { signal: AbortSignal.timeout(12_000) }),
		fetch('https://valorant-api.com/v1/weapons', { signal: AbortSignal.timeout(15_000) }),
		fetch('https://valorant-api.com/v1/competitivetiers', {
			signal: AbortSignal.timeout(12_000)
		}),
		fetch('https://valorant-api.com/v1/seasons', { signal: AbortSignal.timeout(12_000) }),
		fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true', {
			signal: AbortSignal.timeout(12_000)
		}),
		fetch('https://valorant-api.com/v1/maps', { signal: AbortSignal.timeout(12_000) })
	]);

	if (!tiersRes.ok || !weaponsRes.ok) {
		if (cachedAssets) return cachedAssets.index;
		throw new Error('Failed to fetch VALORANT asset metadata from valorant-api.com');
	}

	const tiersData = ContentTiersApiSchema.parse(await tiersRes.json()).data;
	const weaponsData = WeaponsApiSchema.parse(await weaponsRes.json()).data;

	const FALLBACK_TIER_RANK: Record<string, number> = {
		Select: 1,
		Deluxe: 2,
		Premium: 3,
		Exclusive: 4,
		Ultra: 5
	};

	const tiersById = new Map<string, TierMetadata>();
	for (const tier of tiersData) {
		const rawHex = tier.highlightColor?.slice(0, 6);
		const computedRank =
			typeof tier.rank === 'number' ? tier.rank + 1 : (FALLBACK_TIER_RANK[tier.devName] ?? 1);
		tiersById.set(tier.uuid.toLowerCase(), {
			uuid: tier.uuid.toLowerCase(),
			name: tier.displayName,
			devName: tier.devName,
			rank: computedRank,
			accentHex: rawHex && /^[0-9a-fA-F]{6}$/.test(rawHex) ? `#${rawHex}` : '#38bdf8',
			iconUrl: tier.displayIcon ?? null
		});
	}

	const bySkinLevelId = new Map<string, SkinMetadata>();
	const bySkinUuid = new Map<string, SkinMetadata>();

	for (const weapon of weaponsData) {
		const isMelee =
			weapon.category?.includes('Melee') === true || weapon.displayName.toLowerCase() === 'melee';
		const defaultSkinId = weapon.defaultSkinUuid?.toLowerCase();

		for (const skin of weapon.skins) {
			const skinUuid = skin.uuid.toLowerCase();
			const lowerName = skin.displayName.toLowerCase();
			const isStandardOrRandom =
				skinUuid === defaultSkinId ||
				lowerName.startsWith('standard ') ||
				lowerName.includes('random favorite');

			const tierId = skin.contentTierUuid?.toLowerCase() ?? null;
			const tier = tierId ? (tiersById.get(tierId) ?? null) : null;

			const primaryIcon =
				skin.levels[0]?.displayIcon ??
				skin.chromas[0]?.fullRender ??
				skin.displayIcon ??
				skin.chromas[0]?.displayIcon ??
				null;

			const previewVideoUrl =
				[...skin.levels].reverse().find((l) => Boolean(l.streamedVideo))?.streamedVideo ??
				skin.chromas.find((c) => Boolean(c.streamedVideo))?.streamedVideo ??
				null;

			const catalogHit = !isStandardOrRandom ? lookupVerifiedSkinCatalog(skinUuid) : null;
			let standardTierVpPrice: number | null = null;
			let source: SkinAcquisitionSource = 'store';

			if (!isStandardOrRandom) {
				if (catalogHit) {
					standardTierVpPrice = catalogHit.vp;
					source = catalogHit.source;
				} else if (isMelee) {
					const isBpStyleMelee = skin.levels.length <= 1 && !previewVideoUrl;
					standardTierVpPrice = isBpStyleMelee ? 1000 : 4350;
					source = isBpStyleMelee ? 'battle_pass' : 'store';
				} else if (tierId) {
					standardTierVpPrice = STANDARD_FIREARM_TIER_VP[tierId] ?? null;
					source = skin.levels.length <= 1 && !previewVideoUrl ? 'battle_pass' : 'store';
				}
			}

			const levelIds = skin.levels.map((l) => l.uuid.toLowerCase());
			const levels: SkinLevelMetadata[] = skin.levels.map((l, idx) => ({
				uuid: l.uuid.toLowerCase(),
				levelNumber: idx + 1,
				displayName:
					l.displayName?.replace(/\s*\n\s*/g, ' ').trim() || `${skin.displayName} Level ${idx + 1}`,
				effectLabel: formatLevelEffectLabel(l.levelItem, idx),
				displayIcon: l.displayIcon ?? null,
				streamedVideo: l.streamedVideo ?? null
			}));
			const chromas: ChromaMetadata[] = skin.chromas.map((c) => ({
				uuid: c.uuid.toLowerCase(),
				displayName: c.displayName.replace(/\s*\n\s*/g, ' ').trim(),
				displayIcon: c.displayIcon ?? null,
				fullRender: c.fullRender ?? null,
				swatch: c.swatch ?? null,
				streamedVideo: c.streamedVideo ?? null
			}));

			const meta: SkinMetadata = {
				skinUuid,
				displayName: skin.displayName,
				weaponName: weapon.displayName,
				isMelee,
				isStandardOrRandom,
				displayIcon: primaryIcon,
				wallpaper: skin.wallpaper ?? null,
				tier,
				standardTierVpPrice,
				source,
				levelIds,
				levels,
				chromas,
				previewVideoUrl
			};

			bySkinUuid.set(skinUuid, meta);
			for (const levelId of levelIds) {
				bySkinLevelId.set(levelId, meta);
			}
		}
	}

	const competitiveTiersById = new Map<number, CompetitiveTierMeta>();
	if (compTiersRes.ok) {
		const tables = CompetitiveTiersApiSchema.parse(await compTiersRes.json()).data;
		const latestTable = tables[tables.length - 1];
		if (latestTable) {
			for (const t of latestTable.tiers) {
				const rawHex = t.color?.slice(0, 6);
				competitiveTiersById.set(t.tier, {
					tier: t.tier,
					tierName: titleCaseRank(t.tierName),
					divisionName: titleCaseRank(t.divisionName),
					smallIcon: t.smallIcon ?? null,
					largeIcon: t.largeIcon ?? null,
					colorHex: rawHex && /^[0-9a-fA-F]{6}$/.test(rawHex) ? `#${rawHex}` : '#94a3b8'
				});
			}
		}
	}

	const seasonsById = new Map<string, SeasonMeta>();
	if (seasonsRes.ok) {
		const rawSeasons = SeasonsApiSchema.parse(await seasonsRes.json()).data;
		const byUuid = new Map(rawSeasons.map((s) => [s.uuid.toLowerCase(), s]));
		for (const s of rawSeasons) {
			const parent = s.parentUuid ? byUuid.get(s.parentUuid.toLowerCase()) : undefined;
			const fullLabel = parent
				? `${parent.displayName.trim()}: ${s.displayName.trim()}`
				: s.displayName.trim();
			seasonsById.set(s.uuid.toLowerCase(), {
				uuid: s.uuid.toLowerCase(),
				actName: s.displayName.trim(),
				fullLabel,
				startTime: s.startTime,
				endTime: s.endTime
			});
		}
	}

	const agentsById = new Map<string, AgentMeta>();
	if (agentsRes.ok) {
		const rawAgents = AgentsApiSchema.parse(await agentsRes.json()).data;
		for (const a of rawAgents) {
			agentsById.set(a.uuid.toLowerCase(), {
				uuid: a.uuid.toLowerCase(),
				displayName: a.displayName,
				roleName: a.role?.displayName ?? null,
				roleIcon: a.role?.displayIcon ?? null,
				displayIcon: a.displayIcon ?? null,
				bustPortrait: a.bustPortrait ?? a.fullPortrait ?? null
			});
		}
	}

	const mapsByUrl = new Map<string, MapMeta>();
	if (mapsRes.ok) {
		const rawMaps = MapsApiSchema.parse(await mapsRes.json()).data;
		for (const m of rawMaps) {
			const meta: MapMeta = {
				uuid: m.uuid.toLowerCase(),
				mapUrl: m.mapUrl ?? m.uuid,
				displayName: m.displayName,
				listViewIcon: m.listViewIcon ?? null,
				splash: m.splash ?? null
			};
			if (m.mapUrl) mapsByUrl.set(m.mapUrl.toLowerCase(), meta);
			mapsByUrl.set(m.uuid.toLowerCase(), meta);
		}
	}

	const index: ValorantAssetIndex = {
		bySkinLevelId,
		bySkinUuid,
		tiersById,
		competitiveTiersById,
		seasonsById,
		agentsById,
		mapsByUrl,
		currencyIcons: {
			vp: `https://media.valorant-api.com/currencies/${VALORANT_CURRENCIES.VP}/displayicon.png`,
			radianite: `https://media.valorant-api.com/currencies/${VALORANT_CURRENCIES.RADIANITE}/displayicon.png`,
			kingdomCredits: `https://media.valorant-api.com/currencies/${VALORANT_CURRENCIES.KINGDOM_CREDITS}/displayicon.png`
		}
	};

	cachedAssets = { index, expiresAt: now + CACHE_TTL_MS };
	return index;
}

const playerCardCache = new Map<string, PlayerCardMeta>();
const playerTitleCache = new Map<string, string | null>();

export async function getPlayerCardMeta(
	cardUuid: string | null | undefined
): Promise<PlayerCardMeta | null> {
	if (!cardUuid) return null;
	const id = cardUuid.toLowerCase();
	const cached = playerCardCache.get(id);
	if (cached) return cached;

	try {
		const res = await fetch(`https://valorant-api.com/v1/playercards/${id}`, {
			signal: AbortSignal.timeout(6_000)
		});
		if (!res.ok) return null;
		const json = (await res.json()) as {
			data?: {
				uuid: string;
				displayName: string;
				displayIcon?: string | null;
				smallArt?: string | null;
				wideArt?: string | null;
				largeArt?: string | null;
			};
		};
		if (!json.data) return null;
		const meta: PlayerCardMeta = {
			uuid: json.data.uuid,
			displayName: json.data.displayName,
			displayIcon: json.data.displayIcon ?? null,
			smallArt: json.data.smallArt ?? null,
			wideArt: json.data.wideArt ?? null,
			largeArt: json.data.largeArt ?? null
		};
		playerCardCache.set(id, meta);
		return meta;
	} catch {
		return null;
	}
}

export async function getPlayerTitleText(
	titleUuid: string | null | undefined
): Promise<string | null> {
	if (!titleUuid) return null;
	const id = titleUuid.toLowerCase();
	if (playerTitleCache.has(id)) return playerTitleCache.get(id) ?? null;

	try {
		const res = await fetch(`https://valorant-api.com/v1/playertitles/${id}`, {
			signal: AbortSignal.timeout(6_000)
		});
		if (!res.ok) return null;
		const json = (await res.json()) as { data?: { titleText?: string | null } };
		const text = json.data?.titleText?.trim() || null;
		playerTitleCache.set(id, text);
		return text;
	} catch {
		return null;
	}
}

/**
 * Default Indonesia (`ID`) regional VP bundle basis: 5,350 VP (4,750 + 600 bonus) = Rp 500.000.
 */
export const DEFAULT_ID_VP_PACK_PROFILE: RegionalVpPackProfile = {
	id: 'id-5350-standard',
	regionCode: 'ID',
	packVpTotal: 5350,
	packPriceMinor: 500_000n,
	currency: 'IDR',
	source: 'Regional IDR 5,350 VP pack baseline (Rp 500.000)',
	verifiedAt: '2026-10-26',
	isCustom: false
};

const FrankfurterSchema = z.object({
	date: z.string(),
	rates: z.object({
		USD: z.number().positive()
	})
});

let cachedIdrToUsdFx: { rate: DatedFxRate; expiresAt: number } | undefined;

export async function getIdrToUsdFxRate(): Promise<DatedFxRate | null> {
	const now = Date.now();
	if (cachedIdrToUsdFx && cachedIdrToUsdFx.expiresAt > now) {
		return cachedIdrToUsdFx.rate;
	}

	try {
		const res = await fetch('https://api.frankfurter.dev/v1/latest?base=IDR&symbols=USD', {
			signal: AbortSignal.timeout(6_000)
		});
		if (!res.ok) return cachedIdrToUsdFx?.rate ?? null;

		const parsed = FrankfurterSchema.parse(await res.json());
		const scaled = BigInt(Math.round(parsed.rates.USD * 100_000_000));
		const rate: DatedFxRate = {
			baseCurrency: 'IDR',
			quoteCurrency: 'USD',
			rateScaledE8: scaled,
			source: 'ECB / Frankfurter',
			asOf: parsed.date
		};

		cachedIdrToUsdFx = { rate, expiresAt: now + FX_CACHE_TTL_MS };
		return rate;
	} catch {
		return cachedIdrToUsdFx?.rate ?? null;
	}
}
