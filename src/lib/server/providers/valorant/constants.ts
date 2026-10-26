export const VALORANT_CURRENCIES = {
	VP: '85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741',
	RADIANITE: 'e59aa87c-4cbf-517a-5983-6e81511be9b7',
	KINGDOM_CREDITS: '85ca954a-41f2-ce94-9b45-8ca3dd39a00d'
} as const;

export const VALORANT_ITEM_TYPES = {
	AGENTS: '01bb38e1-da47-4e6a-9b3d-945fe4655707',
	CONTRACTS: 'f85cb6f7-33e5-4dc8-b609-ec7212301948',
	SPRAYS: 'd5f120f8-ff8c-4aac-92ea-f2b5acbe9475',
	BUDDIES: 'dd3bf334-87f3-40bd-b043-682a57a8dc3a',
	CARDS: '3f296c07-64c3-494c-923b-fe692a4fa1bd',
	SKIN_LEVELS: 'e7c63390-eda7-46e0-bb7a-a6abdacd2433',
	SKIN_CHROMAS: '3ad1b2b2-acdb-4524-852f-954a76ddae0a',
	TITLES: 'de7caa6b-adf7-4588-bbd1-143831e786c6'
} as const;

export type ValorantItemCategory = keyof typeof VALORANT_ITEM_TYPES;

export const VALORANT_PD_SHARDS = ['ap', 'na', 'eu', 'kr', 'pbe'] as const;
export type ValorantPdShard = (typeof VALORANT_PD_SHARDS)[number];

export const VALORANT_REGIONS = ['ap', 'na', 'eu', 'kr', 'latam', 'br', 'pbe'] as const;
export type ValorantRegion = (typeof VALORANT_REGIONS)[number];

/**
 * Map a VALORANT affinity/region (`latam` and `br` route PD traffic through `na`) to its PD shard.
 */
export function regionToPdShard(region: string): ValorantPdShard {
	const normalized = region.trim().toLowerCase();
	switch (normalized) {
		case 'ap':
			return 'ap';
		case 'eu':
			return 'eu';
		case 'kr':
			return 'kr';
		case 'pbe':
			return 'pbe';
		case 'na':
		case 'latam':
		case 'br':
			return 'na';
		default:
			throw new Error(`Unsupported VALORANT region/affinity: "${region}"`);
	}
}

/**
 * Standard Windows PC Riot Client platform payload encoded as Base64 for `X-Riot-ClientPlatform`.
 */
export const DEFAULT_CLIENT_PLATFORM_B64 = Buffer.from(
	JSON.stringify({
		platformType: 'PC',
		platformOS: 'Windows',
		platformOSVersion: '10.0.19042.1.256.64bit',
		platformChipset: 'Unknown'
	}),
	'utf8'
).toString('base64');

export const RIOT_AUTH_AUTHORIZE_URL =
	'https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid';
