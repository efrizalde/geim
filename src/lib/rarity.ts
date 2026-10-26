import type { TierMetadata } from '#lib/server/providers/valorant/assets.js';

export type RarityRank = 0 | 1 | 2 | 3 | 4 | 5;

export interface RarityVisualSpec {
	rank: RarityRank;
	key: 'standard' | 'select' | 'deluxe' | 'premium' | 'exclusive' | 'ultra';
	label: string;
	primaryHex: string;
	secondaryHex: string;
	tertiaryHex: string;
	glowRgba: string;
	glowStrongRgba: string;
	borderBaseRgba: string;
	particleCount: number;
	breathDurationSec: number;
	floatAmplitudePx: number;
	tiltMaxDeg: number;
	hasAnimatedBorder: boolean;
	hasFoilShimmer: boolean;
	hasHaloRing: boolean;
}

const SPECS: Record<RarityRank, RarityVisualSpec> = {
	0: {
		rank: 0,
		key: 'standard',
		label: 'Battle Pass / Event',
		primaryHex: '#94a3b8',
		secondaryHex: '#64748b',
		tertiaryHex: '#475569',
		glowRgba: 'rgba(148, 163, 184, 0.10)',
		glowStrongRgba: 'rgba(148, 163, 184, 0.20)',
		borderBaseRgba: 'rgba(255, 255, 255, 0.08)',
		particleCount: 0,
		breathDurationSec: 0,
		floatAmplitudePx: 0,
		tiltMaxDeg: 3,
		hasAnimatedBorder: false,
		hasFoilShimmer: false,
		hasHaloRing: false
	},
	1: {
		rank: 1,
		key: 'select',
		label: 'Select',
		primaryHex: '#5a9fe2',
		secondaryHex: '#38bdf8',
		tertiaryHex: '#818cf8',
		glowRgba: 'rgba(90, 159, 226, 0.18)',
		glowStrongRgba: 'rgba(56, 189, 248, 0.34)',
		borderBaseRgba: 'rgba(90, 159, 226, 0.28)',
		particleCount: 0,
		breathDurationSec: 4.2,
		floatAmplitudePx: 1.5,
		tiltMaxDeg: 4.5,
		hasAnimatedBorder: false,
		hasFoilShimmer: false,
		hasHaloRing: false
	},
	2: {
		rank: 2,
		key: 'deluxe',
		label: 'Deluxe',
		primaryHex: '#18c9b5',
		secondaryHex: '#009587',
		tertiaryHex: '#34d399',
		glowRgba: 'rgba(24, 201, 181, 0.22)',
		glowStrongRgba: 'rgba(20, 184, 166, 0.42)',
		borderBaseRgba: 'rgba(24, 201, 181, 0.34)',
		particleCount: 5,
		breathDurationSec: 3.5,
		floatAmplitudePx: 2.8,
		tiltMaxDeg: 6,
		hasAnimatedBorder: false,
		hasFoilShimmer: false,
		hasHaloRing: false
	},
	3: {
		rank: 3,
		key: 'premium',
		label: 'Premium',
		primaryHex: '#eb6aa8',
		secondaryHex: '#d1548d',
		tertiaryHex: '#a855f7',
		glowRgba: 'rgba(209, 84, 141, 0.28)',
		glowStrongRgba: 'rgba(236, 72, 153, 0.52)',
		borderBaseRgba: 'rgba(235, 106, 168, 0.42)',
		particleCount: 8,
		breathDurationSec: 2.9,
		floatAmplitudePx: 4.2,
		tiltMaxDeg: 7.5,
		hasAnimatedBorder: true,
		hasFoilShimmer: true,
		hasHaloRing: false
	},
	4: {
		rank: 4,
		key: 'exclusive',
		label: 'Exclusive',
		primaryHex: '#ff9b54',
		secondaryHex: '#f97316',
		tertiaryHex: '#ff4655',
		glowRgba: 'rgba(245, 149, 91, 0.32)',
		glowStrongRgba: 'rgba(251, 146, 60, 0.62)',
		borderBaseRgba: 'rgba(255, 155, 84, 0.50)',
		particleCount: 12,
		breathDurationSec: 2.4,
		floatAmplitudePx: 5.2,
		tiltMaxDeg: 9,
		hasAnimatedBorder: true,
		hasFoilShimmer: true,
		hasHaloRing: true
	},
	5: {
		rank: 5,
		key: 'ultra',
		label: 'Ultra',
		primaryHex: '#ffe066',
		secondaryHex: '#f59e0b',
		tertiaryHex: '#22d3ee',
		glowRgba: 'rgba(250, 214, 99, 0.38)',
		glowStrongRgba: 'rgba(251, 191, 36, 0.72)',
		borderBaseRgba: 'rgba(255, 224, 102, 0.62)',
		particleCount: 16,
		breathDurationSec: 2.0,
		floatAmplitudePx: 6.2,
		tiltMaxDeg: 10.5,
		hasAnimatedBorder: true,
		hasFoilShimmer: true,
		hasHaloRing: true
	}
};

const DEV_NAME_TO_RANK: Record<string, RarityRank> = {
	select: 1,
	deluxe: 2,
	premium: 3,
	exclusive: 4,
	ultra: 5
};

export function resolveRaritySpec(tier: TierMetadata | null | undefined): RarityVisualSpec {
	if (!tier) return SPECS[0];
	const devKey = tier.devName?.toLowerCase() ?? '';
	const byDev = DEV_NAME_TO_RANK[devKey];
	if (byDev !== undefined) return SPECS[byDev];
	const clamped = Math.max(0, Math.min(5, Math.round(tier.rank ?? 1))) as RarityRank;
	return SPECS[clamped];
}

export function toProxiedValorantMediaUrl(rawUrl: string | null | undefined): string | null {
	if (!rawUrl) return null;
	try {
		const parsed = new URL(rawUrl);
		if (parsed.protocol === 'https:' && parsed.hostname === 'media.valorant-api.com') {
			return `/api/valorant-media?url=${encodeURIComponent(rawUrl)}`;
		}
	} catch {
		// Fall through and return raw URL
	}
	return rawUrl;
}
