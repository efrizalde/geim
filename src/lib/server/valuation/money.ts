export type SupportedCurrency = 'IDR' | 'USD';

export const CURRENCY_MINOR_DECIMALS: Record<SupportedCurrency, number> = {
	IDR: 0,
	USD: 2
};

export interface RegionalVpPackProfile {
	id: string;
	regionCode: string;
	packVpTotal: number; // Base VP + bonus VP
	packPriceMinor: bigint; // In minor units of `currency` (e.g. IDR whole rupiah, USD cents)
	currency: SupportedCurrency;
	source: string;
	verifiedAt: string;
	isCustom: boolean;
}

export interface DatedFxRate {
	baseCurrency: SupportedCurrency;
	quoteCurrency: SupportedCurrency;
	/**
	 * Rate scaled by 10^8 (`1_0000_0000n` = 1.0) so `1 USD = 16250.50 IDR` is `1625050000000n`.
	 */
	rateScaledE8: bigint;
	source: string;
	asOf: string;
}

export interface SkinPriceRecord {
	baseSkinId: string;
	vpPrice: number | null; // null = unpriced (Battle Pass, contract, bundle-only); 0 = confirmed free
}

export interface InventoryValuationResult {
	ownedBaseSkinCount: number;
	pricedBaseSkinCount: number;
	unpricedBaseSkinCount: number;
	isPartial: boolean;
	knownVpSubtotal: number;
	estimatedDisplayMinor: bigint | null;
	displayCurrency: SupportedCurrency;
	formattedEstimate: string | null;
	unavailableReason?: string;
}

const FX_SCALE = 100_000_000n;

function pow10(exp: number): bigint {
	return 10n ** BigInt(exp);
}

/**
 * Divide `numerator / denominator` with half-away-from-zero rounding on non-negative bigints.
 */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
	if (denominator <= 0n) throw new Error('Denominator must be positive.');
	return (numerator + denominator / 2n) / denominator;
}

export function formatMinorCurrency(
	minorAmount: bigint,
	currency: SupportedCurrency,
	locale = currency === 'IDR' ? 'id-ID' : 'en-US'
): string {
	const decimals = CURRENCY_MINOR_DECIMALS[currency];
	const scale = Number(pow10(decimals));
	const majorNumber = Number(minorAmount) / scale;

	return new Intl.NumberFormat(locale, {
		style: 'currency',
		currency,
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	}).format(majorNumber);
}

/**
 * Compute proportional VP-pack & FX valuation over deduplicated base skins using exact `bigint` arithmetic.
 * Never treats `null` (unpriced) items as `0` and never double-converts matching currencies.
 */
export function calculateProportionalValuation(params: {
	skins: SkinPriceRecord[];
	packProfile: RegionalVpPackProfile | null;
	displayCurrency: SupportedCurrency;
	fxRate?: DatedFxRate | null;
}): InventoryValuationResult {
	const { skins, packProfile, displayCurrency, fxRate } = params;

	let pricedCount = 0;
	let unpricedCount = 0;
	let vpSubtotal = 0;

	const seenBaseSkinIds = new Set<string>();
	for (const skin of skins) {
		const normalizedId = skin.baseSkinId.toLowerCase();
		if (seenBaseSkinIds.has(normalizedId)) continue;
		seenBaseSkinIds.add(normalizedId);

		if (skin.vpPrice === null) {
			unpricedCount += 1;
		} else {
			pricedCount += 1;
			vpSubtotal += skin.vpPrice;
		}
	}

	const ownedBaseSkinCount = pricedCount + unpricedCount;
	const isPartial = unpricedCount > 0;

	if (!packProfile || packProfile.packVpTotal <= 0) {
		return {
			ownedBaseSkinCount,
			pricedBaseSkinCount: pricedCount,
			unpricedBaseSkinCount: unpricedCount,
			isPartial,
			knownVpSubtotal: vpSubtotal,
			estimatedDisplayMinor: null,
			displayCurrency,
			formattedEstimate: null,
			unavailableReason: 'No regional VP pack profile configured.'
		};
	}

	const vpBig = BigInt(vpSubtotal);
	const packVpBig = BigInt(packProfile.packVpTotal);
	const packMinor = packProfile.packPriceMinor;

	if (packProfile.currency === displayCurrency) {
		const estimatedMinor = divRoundHalfUp(vpBig * packMinor, packVpBig);
		return {
			ownedBaseSkinCount,
			pricedBaseSkinCount: pricedCount,
			unpricedBaseSkinCount: unpricedCount,
			isPartial,
			knownVpSubtotal: vpSubtotal,
			estimatedDisplayMinor: estimatedMinor,
			displayCurrency,
			formattedEstimate: formatMinorCurrency(estimatedMinor, displayCurrency)
		};
	}

	if (
		!fxRate ||
		fxRate.baseCurrency !== packProfile.currency ||
		fxRate.quoteCurrency !== displayCurrency
	) {
		return {
			ownedBaseSkinCount,
			pricedBaseSkinCount: pricedCount,
			unpricedBaseSkinCount: unpricedCount,
			isPartial,
			knownVpSubtotal: vpSubtotal,
			estimatedDisplayMinor: null,
			displayCurrency,
			formattedEstimate: null,
			unavailableReason: `Missing FX rate from ${packProfile.currency} to ${displayCurrency}.`
		};
	}

	const baseDecimals = CURRENCY_MINOR_DECIMALS[packProfile.currency];
	const quoteDecimals = CURRENCY_MINOR_DECIMALS[displayCurrency];

	// Convert native major value = (vpBig * packMinor / 10^baseDecimals) / packVpBig
	// Multiply by fxRate (rateScaledE8 / 10^8) and scale to 10^quoteDecimals in a single rational step!
	const numerator = vpBig * packMinor * fxRate.rateScaledE8 * pow10(quoteDecimals);
	const denominator = packVpBig * FX_SCALE * pow10(baseDecimals);
	const estimatedMinor = divRoundHalfUp(numerator, denominator);

	return {
		ownedBaseSkinCount,
		pricedBaseSkinCount: pricedCount,
		unpricedBaseSkinCount: unpricedCount,
		isPartial,
		knownVpSubtotal: vpSubtotal,
		estimatedDisplayMinor: estimatedMinor,
		displayCurrency,
		formattedEstimate: formatMinorCurrency(estimatedMinor, displayCurrency)
	};
}
