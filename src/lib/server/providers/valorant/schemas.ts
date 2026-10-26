import { z } from 'zod';
import { VALORANT_CURRENCIES, VALORANT_ITEM_TYPES } from './constants';

export interface ParsedAuthTokens {
	accessToken: string;
	idToken?: string;
	expiresInSeconds: number;
}

/**
 * Extract `access_token`, `id_token`, and `expires_in` from a Riot OAuth redirect URI
 * (`https://playvalorant.com/opt_in#access_token=...`).
 */
export function parseAuthRedirectUrl(rawUrl: string): ParsedAuthTokens {
	const trimmed = rawUrl.trim();
	const hashIndex = trimmed.indexOf('#');
	const queryString = hashIndex >= 0 ? trimmed.slice(hashIndex + 1) : trimmed;
	const params = new URLSearchParams(queryString);

	const accessToken = params.get('access_token');
	if (!accessToken) {
		throw new Error('Redirect URL does not contain an access_token fragment.');
	}

	const idToken = params.get('id_token') ?? undefined;
	const rawExpires = Number(params.get('expires_in') ?? '3600');
	const expiresInSeconds = Number.isFinite(rawExpires) && rawExpires > 0 ? rawExpires : 3600;

	return { accessToken, idToken, expiresInSeconds };
}

export const RiotUserInfoSchema = z.object({
	sub: z.string().min(1),
	acct: z
		.object({
			game_name: z.string().optional(),
			tag_line: z.string().optional()
		})
		.optional()
});

export const RiotPassthroughAffinitySchema = z.object({
	affinities: z.object({
		live: z.string().min(1)
	})
});

const RewardSchema = z.object({
	ItemTypeID: z.string(),
	ItemID: z.string(),
	Quantity: z.number().int().nonnegative()
});

const SingleItemOfferSchema = z.object({
	OfferID: z.string(),
	IsDirectPurchase: z.boolean().optional(),
	StartDate: z.string().optional(),
	Cost: z.record(z.string(), z.number()),
	Rewards: z.array(RewardSchema)
});

const BonusStoreOfferSchema = z.object({
	BonusOfferID: z.string(),
	Offer: SingleItemOfferSchema,
	DiscountPercent: z.number(),
	DiscountCosts: z.record(z.string(), z.number()),
	IsSeen: z.boolean().optional()
});

export const StorefrontResponseSchema = z.object({
	SkinsPanelLayout: z.object({
		SingleItemOffers: z.array(z.string()),
		SingleItemStoreOffers: z.array(SingleItemOfferSchema).optional(),
		SingleItemOffersRemainingDurationInSeconds: z.number()
	}),
	BonusStore: z
		.object({
			BonusStoreOffers: z.array(BonusStoreOfferSchema),
			BonusStoreRemainingDurationInSeconds: z.number()
		})
		.nullable()
		.optional()
});

export interface NormalizedDailyOffer {
	offerId: string;
	skinLevelId: string;
	vpPrice: number | null;
	rawCosts: Record<string, number>;
}

export interface NormalizedNightMarketOffer {
	bonusOfferId: string;
	offerId: string;
	skinLevelId: string;
	baseVpPrice: number | null;
	discountedVpPrice: number | null;
	discountPercent: number;
	isSeen: boolean;
}

export type NormalizedNightMarket =
	| { status: 'absent' }
	| {
			status: 'active';
			expiresAt: string;
			remainingSeconds: number;
			offers: NormalizedNightMarketOffer[];
	  };

export interface NormalizedStorefront {
	fetchedAt: string;
	dailyExpiresAt: string;
	dailyRemainingSeconds: number;
	dailyOffers: NormalizedDailyOffer[];
	nightMarket: NormalizedNightMarket;
	catalogPrices?: Record<string, number>;
}

/**
 * Normalize a validated Riot Storefront v3 payload without inventing missing prices or fake BonusStores.
 */
export function normalizeStorefront(
	raw: unknown,
	fetchedAt: Date = new Date()
): NormalizedStorefront {
	const parsed = StorefrontResponseSchema.parse(raw);
	const panel = parsed.SkinsPanelLayout;
	const dailyRemainingSeconds = Math.max(
		0,
		Math.floor(panel.SingleItemOffersRemainingDurationInSeconds)
	);
	const dailyExpiresAt = new Date(fetchedAt.getTime() + dailyRemainingSeconds * 1000).toISOString();

	const detailedById = new Map(
		(panel.SingleItemStoreOffers ?? []).map((offer) => [offer.OfferID, offer])
	);

	const dailyOffers: NormalizedDailyOffer[] =
		panel.SingleItemStoreOffers && panel.SingleItemStoreOffers.length > 0
			? panel.SingleItemStoreOffers.map((offer) => {
					const skinReward = offer.Rewards.find(
						(r) => r.ItemTypeID === VALORANT_ITEM_TYPES.SKIN_LEVELS
					);
					const vpCost = offer.Cost[VALORANT_CURRENCIES.VP];
					return {
						offerId: offer.OfferID,
						skinLevelId: skinReward?.ItemID ?? offer.OfferID,
						vpPrice: typeof vpCost === 'number' ? vpCost : null,
						rawCosts: offer.Cost
					};
				})
			: panel.SingleItemOffers.map((skinLevelId) => {
					const matched = detailedById.get(skinLevelId);
					const vpCost = matched?.Cost[VALORANT_CURRENCIES.VP];
					return {
						offerId: skinLevelId,
						skinLevelId,
						vpPrice: typeof vpCost === 'number' ? vpCost : null,
						rawCosts: matched?.Cost ?? {}
					};
				});

	let nightMarket: NormalizedNightMarket = { status: 'absent' };
	if (parsed.BonusStore != null) {
		const bonusRemainingSeconds = Math.max(
			0,
			Math.floor(parsed.BonusStore.BonusStoreRemainingDurationInSeconds)
		);
		const bonusExpiresAt = new Date(
			fetchedAt.getTime() + bonusRemainingSeconds * 1000
		).toISOString();

		nightMarket = {
			status: 'active',
			expiresAt: bonusExpiresAt,
			remainingSeconds: bonusRemainingSeconds,
			offers: parsed.BonusStore.BonusStoreOffers.map((bonus) => {
				const skinReward = bonus.Offer.Rewards.find(
					(r) => r.ItemTypeID === VALORANT_ITEM_TYPES.SKIN_LEVELS
				);
				const baseVp = bonus.Offer.Cost[VALORANT_CURRENCIES.VP];
				const discountedVp = bonus.DiscountCosts[VALORANT_CURRENCIES.VP];
				return {
					bonusOfferId: bonus.BonusOfferID,
					offerId: bonus.Offer.OfferID,
					skinLevelId: skinReward?.ItemID ?? bonus.Offer.OfferID,
					baseVpPrice: typeof baseVp === 'number' ? baseVp : null,
					discountedVpPrice: typeof discountedVp === 'number' ? discountedVp : null,
					discountPercent: bonus.DiscountPercent,
					isSeen: bonus.IsSeen ?? false
				};
			})
		};
	}

	return {
		fetchedAt: fetchedAt.toISOString(),
		dailyExpiresAt,
		dailyRemainingSeconds,
		dailyOffers,
		nightMarket
	};
}

export const WalletResponseSchema = z.object({
	Balances: z.record(z.string(), z.number())
});

export interface NormalizedWallet {
	vp: number | null;
	radianite: number | null;
	kingdomCredits: number | null;
}

/**
 * Preserve `null` when a currency key is absent vs `0` when the returned balance is zero.
 */
export function normalizeWallet(raw: unknown): NormalizedWallet {
	const parsed = WalletResponseSchema.parse(raw);
	const vp = parsed.Balances[VALORANT_CURRENCIES.VP];
	const radianite = parsed.Balances[VALORANT_CURRENCIES.RADIANITE];
	const kingdomCredits = parsed.Balances[VALORANT_CURRENCIES.KINGDOM_CREDITS];

	return {
		vp: typeof vp === 'number' ? vp : null,
		radianite: typeof radianite === 'number' ? radianite : null,
		kingdomCredits: typeof kingdomCredits === 'number' ? kingdomCredits : null
	};
}

const CatalogRewardSchema = z.object({
	ItemTypeID: z.string(),
	ItemID: z.string(),
	Quantity: z.number().int().nonnegative().nullable().optional()
});

const CatalogOfferItemSchema = z.object({
	OfferID: z.string(),
	IsDirectPurchase: z.boolean().nullable().optional(),
	StartDate: z.string().nullable().optional(),
	Cost: z.record(z.string(), z.number().nullable()).nullable().optional(),
	Rewards: z.array(CatalogRewardSchema).nullable().optional()
});

export const CatalogOffersResponseSchema = z.object({
	Offers: z.array(CatalogOfferItemSchema)
});

/**
 * Extract single-item standard VP prices keyed by `skinLevelId` from `GET /store/v1/offers/`.
 */
export function extractBaseSkinVpPrices(raw: unknown): Map<string, number> {
	const parsed = CatalogOffersResponseSchema.parse(raw);
	const prices = new Map<string, number>();
	const skinLevelTypeLower = VALORANT_ITEM_TYPES.SKIN_LEVELS.toLowerCase();

	for (const offer of parsed.Offers) {
		if (!offer.Rewards || offer.Rewards.length !== 1) continue;
		const reward = offer.Rewards[0];
		const qty = reward.Quantity ?? 1;
		if (reward.ItemTypeID.toLowerCase() !== skinLevelTypeLower || qty !== 1) continue;

		const vpCost =
			offer.Cost?.[VALORANT_CURRENCIES.VP] ?? offer.Cost?.[VALORANT_CURRENCIES.VP.toUpperCase()];
		if (typeof vpCost === 'number' && vpCost >= 0) {
			prices.set(reward.ItemID.toLowerCase(), vpCost);
		}
	}

	return prices;
}

export const EntitlementsResponseSchema = z.object({
	ItemTypeID: z.string(),
	Entitlements: z.array(
		z.object({
			TypeID: z.string().optional(),
			ItemID: z.string(),
			InstanceID: z.string().optional()
		})
	)
});

export const PlayerLoadoutResponseSchema = z.object({
	Subject: z.string(),
	Version: z.number(),
	Guns: z.array(
		z.object({
			ID: z.string(),
			SkinID: z.string(),
			SkinLevelID: z.string(),
			ChromaID: z.string(),
			CharmInstanceID: z.string().optional(),
			CharmID: z.string().optional(),
			CharmLevelID: z.string().optional()
		})
	),
	Sprays: z.array(
		z.object({
			EquipSlotID: z.string(),
			SprayID: z.string()
		})
	),
	Identity: z.object({
		PlayerCardID: z.string(),
		PlayerTitleID: z.string(),
		AccountLevel: z.number().optional(),
		PreferredLevelBorderID: z.string().optional(),
		HideAccountLevel: z.boolean().optional()
	})
});

export const MatchHistoryResponseSchema = z.object({
	Subject: z.string(),
	BeginIndex: z.number(),
	EndIndex: z.number(),
	Total: z.number(),
	History: z.array(
		z.object({
			MatchID: z.string(),
			GameStartTime: z.number(),
			QueueID: z.string().optional()
		})
	)
});
