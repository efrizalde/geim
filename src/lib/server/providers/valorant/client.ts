import { z } from 'zod';
import { safeErrorMessage } from '../../crypto/redact';
import {
	DEFAULT_CLIENT_PLATFORM_B64,
	RIOT_AUTH_AUTHORIZE_URL,
	VALORANT_ITEM_TYPES,
	regionToPdShard,
	type ValorantItemCategory,
	type ValorantPdShard
} from './constants';
import {
	CompetitiveUpdatesResponseSchema,
	EntitlementsResponseSchema,
	MatchHistoryResponseSchema,
	PlayerLoadoutResponseSchema,
	RiotPassthroughAffinitySchema,
	RiotUserInfoSchema,
	extractBaseSkinVpPrices,
	normalizeStorefront,
	normalizeWallet,
	parseAuthRedirectUrl,
	type NormalizedStorefront,
	type NormalizedWallet,
	type ParsedAuthTokens
} from './schemas';

const DEFAULT_TIMEOUT_MS = 12_000;

export type CookieJar = Record<string, string>;

export function mergeSetCookieHeaders(jar: CookieJar, headers: Headers): CookieJar {
	const next: CookieJar = { ...jar };
	const setCookies =
		typeof headers.getSetCookie === 'function'
			? headers.getSetCookie()
			: (headers.get('set-cookie')?.split(/,(?=[^;]+=[^;]+)/) ?? []);

	for (const raw of setCookies) {
		const firstPair = raw.split(';', 1)[0]?.trim();
		if (!firstPair) continue;
		const eqIdx = firstPair.indexOf('=');
		if (eqIdx <= 0) continue;
		const name = firstPair.slice(0, eqIdx).trim();
		const value = firstPair.slice(eqIdx + 1).trim();
		if (name && value) {
			next[name] = value;
		}
	}

	return next;
}

export function serializeCookieJar(jar: CookieJar): string {
	return Object.entries(jar)
		.filter(([, value]) => Boolean(value))
		.map(([key, value]) => `${key}=${value}`)
		.join('; ');
}

const ValorantApiVersionSchema = z.object({
	status: z.number(),
	data: z.object({
		riotClientVersion: z.string().min(1)
	})
});

let cachedClientVersion: { version: string; expiresAt: number } | undefined;

/**
 * Resolve the current `X-Riot-ClientVersion` string from `valorant-api.com/v1/version` (cached 30 min).
 */
export async function fetchRiotClientVersion(): Promise<string> {
	const now = Date.now();
	if (cachedClientVersion && cachedClientVersion.expiresAt > now) {
		return cachedClientVersion.version;
	}

	const res = await fetch('https://valorant-api.com/v1/version', {
		signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
	});
	if (!res.ok) {
		throw new Error(`valorant-api version check failed with HTTP ${res.status}`);
	}

	const parsed = ValorantApiVersionSchema.parse(await res.json());
	cachedClientVersion = {
		version: parsed.data.riotClientVersion,
		expiresAt: now + 30 * 60 * 1000
	};
	return parsed.data.riotClientVersion;
}

export type CookieReauthOutcome =
	| { status: 'ok'; tokens: ParsedAuthTokens; cookies: CookieJar }
	| { status: 'expired_session'; reason: string }
	| { status: 'blocked_cloudflare'; statusCode: number }
	| { status: 'rate_limited'; retryAfterSeconds?: number }
	| { status: 'error'; reason: string };

/**
 * Silently renew a Riot session using an `ssid` cookie jar (`GET /authorize` without following redirects).
 */
export async function renewSessionWithCookies(cookies: CookieJar): Promise<CookieReauthOutcome> {
	if (!cookies.ssid) {
		return { status: 'expired_session', reason: 'Missing ssid cookie in cookie jar.' };
	}

	try {
		const res = await fetch(RIOT_AUTH_AUTHORIZE_URL, {
			method: 'GET',
			redirect: 'manual',
			headers: {
				Cookie: serializeCookieJar(cookies),
				Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
				'User-Agent': 'RiotClient/91.0.2.1870.3774 rso-auth (Windows;10;;Professional, x64)'
			},
			signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
		});

		const updatedCookies = mergeSetCookieHeaders(cookies, res.headers);

		if (res.status === 429) {
			const retryHeader = Number(res.headers.get('retry-after'));
			return {
				status: 'rate_limited',
				retryAfterSeconds: Number.isFinite(retryHeader) ? retryHeader : undefined
			};
		}

		if (res.status === 403) {
			return { status: 'blocked_cloudflare', statusCode: res.status };
		}

		const location = res.headers.get('location') ?? '';
		if (location.includes('access_token=')) {
			const tokens = parseAuthRedirectUrl(location);
			return { status: 'ok', tokens, cookies: updatedCookies };
		}

		if (location.includes('/login') || location.includes('authenticate.riotgames.com')) {
			return {
				status: 'expired_session',
				reason: 'Riot redirected back to interactive login; ssid cookie is expired or revoked.'
			};
		}

		return {
			status: 'error',
			reason: `Unexpected cookie-reauth HTTP ${res.status} response.`
		};
	} catch (err) {
		return { status: 'error', reason: safeErrorMessage(err) };
	}
}

export type DirectAuthOutcome =
	| { status: 'ok'; tokens: ParsedAuthTokens; cookies: CookieJar }
	| { status: 'mfa_required'; emailHint?: string; cookies: CookieJar }
	| { status: 'invalid_credentials' }
	| { status: 'blocked_captcha'; detail: string }
	| { status: 'rate_limited' }
	| { status: 'error'; reason: string };

const RiotAuthApiResponseSchema = z.object({
	type: z.string(),
	error: z.string().optional(),
	response: z
		.object({
			parameters: z
				.object({
					uri: z.string().optional()
				})
				.optional()
		})
		.optional(),
	multifactor: z
		.object({
			email: z.string().optional()
		})
		.optional()
});

/**
 * Attempt direct Riot credential authentication (`POST` init cookies -> `PUT` credentials).
 * Treats Cloudflare 403 or hCaptcha requirement as `blocked_captcha` (never implements bypasses).
 */
export async function attemptDirectLogin(
	username: string,
	password: string
): Promise<DirectAuthOutcome> {
	const authEndpoint = 'https://auth.riotgames.com/api/v1/authorization';
	const commonHeaders = {
		'Content-Type': 'application/json',
		Accept: 'application/json',
		'User-Agent': 'RiotClient/91.0.2.1870.3774 rso-auth (Windows;10;;Professional, x64)'
	};

	try {
		const initRes = await fetch(authEndpoint, {
			method: 'POST',
			headers: commonHeaders,
			body: JSON.stringify({
				client_id: 'play-valorant-web-prod',
				nonce: '1',
				redirect_uri: 'https://playvalorant.com/opt_in',
				response_type: 'token id_token',
				scope: 'account openid'
			}),
			signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
		});

		if (initRes.status === 403) {
			return {
				status: 'blocked_captcha',
				detail: 'Cloudflare/WAF blocked POST /api/v1/authorization (HTTP 403).'
			};
		}
		if (initRes.status === 429) return { status: 'rate_limited' };

		let jar = mergeSetCookieHeaders({}, initRes.headers);
		const initBodyText = await initRes.text();
		if (initBodyText.includes('captcha_not_allowed') || initBodyText.includes('hcaptcha')) {
			// Check whether init already demands captcha
			try {
				const initParsed = RiotAuthApiResponseSchema.safeParse(JSON.parse(initBodyText));
				if (initParsed.success && initParsed.data.type === 'captcha') {
					return {
						status: 'blocked_captcha',
						detail: 'Riot authorization requires interactive CAPTCHA challenge.'
					};
				}
			} catch {
				// Continue to PUT check if JSON differs
			}
		}

		const loginRes = await fetch(authEndpoint, {
			method: 'PUT',
			headers: {
				...commonHeaders,
				Cookie: serializeCookieJar(jar)
			},
			body: JSON.stringify({
				type: 'auth',
				username,
				password,
				remember: true,
				language: 'en_US'
			}),
			signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
		});

		jar = mergeSetCookieHeaders(jar, loginRes.headers);

		if (loginRes.status === 403) {
			return {
				status: 'blocked_captcha',
				detail: 'Cloudflare/anti-bot blocked PUT /api/v1/authorization (HTTP 403).'
			};
		}
		if (loginRes.status === 429) return { status: 'rate_limited' };

		const parsed = RiotAuthApiResponseSchema.parse(await loginRes.json());

		if (parsed.error === 'auth_failure') {
			return { status: 'invalid_credentials' };
		}
		if (
			parsed.type === 'captcha' ||
			parsed.error === 'captcha_not_allowed' ||
			parsed.error === 'rate_limited'
		) {
			return parsed.error === 'rate_limited'
				? { status: 'rate_limited' }
				: {
						status: 'blocked_captcha',
						detail: `Riot login blocked by challenge (${parsed.error ?? parsed.type}).`
					};
		}
		if (parsed.type === 'multifactor') {
			return {
				status: 'mfa_required',
				emailHint: parsed.multifactor?.email,
				cookies: jar
			};
		}
		if (parsed.type === 'response' && parsed.response?.parameters?.uri) {
			const tokens = parseAuthRedirectUrl(parsed.response.parameters.uri);
			return { status: 'ok', tokens, cookies: jar };
		}

		return {
			status: 'error',
			reason: `Unhandled Riot auth response type "${parsed.type}"${parsed.error ? ` (${parsed.error})` : ''}.`
		};
	} catch (err) {
		return { status: 'error', reason: safeErrorMessage(err) };
	}
}

/**
 * Submit a 6-digit MFA code against an active pending Riot authorization cookie jar.
 */
export async function submitDirectMfa(
	code: string,
	pendingCookies: CookieJar
): Promise<DirectAuthOutcome> {
	try {
		const res = await fetch('https://auth.riotgames.com/api/v1/authorization', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				Cookie: serializeCookieJar(pendingCookies),
				'User-Agent': 'RiotClient/91.0.2.1870.3774 rso-auth (Windows;10;;Professional, x64)'
			},
			body: JSON.stringify({
				type: 'multifactor',
				code: code.trim(),
				rememberDevice: true
			}),
			signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
		});

		const jar = mergeSetCookieHeaders(pendingCookies, res.headers);
		if (res.status === 429) return { status: 'rate_limited' };
		if (res.status === 403) {
			return { status: 'blocked_captcha', detail: 'Cloudflare blocked MFA submission (HTTP 403).' };
		}

		const parsed = RiotAuthApiResponseSchema.parse(await res.json());
		if (parsed.error === 'multifactor_attempt_failed') {
			return { status: 'invalid_credentials' };
		}
		if (parsed.type === 'response' && parsed.response?.parameters?.uri) {
			const tokens = parseAuthRedirectUrl(parsed.response.parameters.uri);
			return { status: 'ok', tokens, cookies: jar };
		}

		return {
			status: 'error',
			reason: `Unexpected MFA response "${parsed.type}"${parsed.error ? ` (${parsed.error})` : ''}.`
		};
	} catch (err) {
		return { status: 'error', reason: safeErrorMessage(err) };
	}
}

const EntitlementsTokenSchema = z.object({
	entitlements_token: z.string().min(1)
});

export async function fetchEntitlementsToken(accessToken: string): Promise<string> {
	const res = await fetch('https://entitlements.auth.riotgames.com/api/token/v1', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: '{}',
		signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
	});

	if (!res.ok) {
		throw new Error(`Entitlements token request failed with HTTP ${res.status}`);
	}

	const parsed = EntitlementsTokenSchema.parse(await res.json());
	return parsed.entitlements_token;
}

export async function fetchRiotIdentity(accessToken: string): Promise<{
	puuid: string;
	gameName: string;
	tagLine: string;
}> {
	const res = await fetch('https://auth.riotgames.com/userinfo', {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${accessToken}`
		},
		signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
	});

	if (!res.ok) {
		throw new Error(`Riot /userinfo failed with HTTP ${res.status}`);
	}

	const parsed = RiotUserInfoSchema.parse(await res.json());
	return {
		puuid: parsed.sub,
		gameName: parsed.acct?.game_name?.trim() || 'Unknown',
		tagLine: parsed.acct?.tag_line?.trim() || '0000'
	};
}

export async function resolveValorantAffinity(
	accessToken: string,
	idToken: string | undefined,
	fallbackRegion = 'ap'
): Promise<{ region: string; shard: ValorantPdShard }> {
	if (idToken) {
		const res = await fetch('https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant', {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ id_token: idToken }),
			signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
		});

		if (res.ok) {
			const parsed = RiotPassthroughAffinitySchema.safeParse(await res.json());
			if (parsed.success) {
				const liveRegion = parsed.data.affinities.live.toLowerCase();
				return {
					region: liveRegion,
					shard: regionToPdShard(liveRegion)
				};
			}
		}
	}

	return {
		region: fallbackRegion,
		shard: regionToPdShard(fallbackRegion)
	};
}

export interface ValorantSessionContext {
	puuid: string;
	shard: ValorantPdShard;
	region: string;
	accessToken: string;
	entitlementsToken: string;
	clientVersion: string;
}

function buildPdHeaders(ctx: ValorantSessionContext): Record<string, string> {
	return {
		Authorization: `Bearer ${ctx.accessToken}`,
		'X-Riot-Entitlements-JWT': ctx.entitlementsToken,
		'X-Riot-ClientPlatform': DEFAULT_CLIENT_PLATFORM_B64,
		'X-Riot-ClientVersion': ctx.clientVersion,
		'Content-Type': 'application/json'
	};
}

async function pdFetchJson(
	ctx: ValorantSessionContext,
	path: string,
	init: RequestInit = {}
): Promise<unknown> {
	const url = `https://pd.${ctx.shard}.a.pvp.net${path}`;
	const res = await fetch(url, {
		...init,
		headers: {
			...buildPdHeaders(ctx),
			...(init.headers as Record<string, string> | undefined)
		},
		signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
	});

	if (!res.ok) {
		throw new Error(`VALORANT PD ${init.method ?? 'GET'} ${path} failed with HTTP ${res.status}`);
	}

	return res.json();
}

export async function fetchStorefront(ctx: ValorantSessionContext): Promise<NormalizedStorefront> {
	const fetchedAt = new Date();
	const raw = await pdFetchJson(ctx, `/store/v3/storefront/${ctx.puuid}`, {
		method: 'POST',
		body: '{}'
	});
	return normalizeStorefront(raw, fetchedAt);
}

export async function fetchWallet(ctx: ValorantSessionContext): Promise<NormalizedWallet> {
	const raw = await pdFetchJson(ctx, `/store/v1/wallet/${ctx.puuid}`);
	return normalizeWallet(raw);
}

export async function fetchCatalogSkinPrices(
	ctx: ValorantSessionContext
): Promise<Map<string, number>> {
	const raw = await pdFetchJson(ctx, '/store/v1/offers/');
	return extractBaseSkinVpPrices(raw);
}

export async function fetchOwnedCategory(
	ctx: ValorantSessionContext,
	category: ValorantItemCategory
) {
	const itemTypeId = VALORANT_ITEM_TYPES[category];
	const raw = await pdFetchJson(ctx, `/store/v1/entitlements/${ctx.puuid}/${itemTypeId}`);
	return EntitlementsResponseSchema.parse(raw);
}

export async function fetchPlayerLoadout(ctx: ValorantSessionContext) {
	const raw = await pdFetchJson(ctx, `/personalization/v2/players/${ctx.puuid}/playerloadout`);
	return PlayerLoadoutResponseSchema.parse(raw);
}

export async function fetchMatchHistory(
	ctx: ValorantSessionContext,
	opts: number | { startIndex?: number; endIndex?: number; queue?: string } = 20
) {
	const startIndex = typeof opts === 'number' ? 0 : (opts.startIndex ?? 0);
	const endIndex = typeof opts === 'number' ? opts : (opts.endIndex ?? startIndex + 20);
	const queueParam =
		typeof opts === 'object' && opts.queue ? `&queue=${encodeURIComponent(opts.queue)}` : '';
	const raw = await pdFetchJson(
		ctx,
		`/match-history/v1/history/${ctx.puuid}?startIndex=${startIndex}&endIndex=${endIndex}${queueParam}`
	);
	return MatchHistoryResponseSchema.parse(raw);
}

export async function fetchCompetitiveUpdates(
	ctx: ValorantSessionContext,
	opts: { startIndex?: number; endIndex?: number; queue?: string } = {}
) {
	const startIndex = opts.startIndex ?? 0;
	const endIndex = opts.endIndex ?? startIndex + 20;
	const queueParam = opts.queue ? `&queue=${encodeURIComponent(opts.queue)}` : '';
	const raw = await pdFetchJson(
		ctx,
		`/mmr/v1/players/${ctx.puuid}/competitiveupdates?startIndex=${startIndex}&endIndex=${endIndex}${queueParam}`
	);
	return CompetitiveUpdatesResponseSchema.parse(raw);
}

export async function fetchAccountXpRaw(ctx: ValorantSessionContext): Promise<unknown> {
	return pdFetchJson(ctx, `/account-xp/v1/players/${ctx.puuid}`);
}

export async function fetchPlayerMmrRaw(ctx: ValorantSessionContext): Promise<unknown> {
	return pdFetchJson(ctx, `/mmr/v1/players/${ctx.puuid}`);
}

export async function fetchMatchDetailsRaw(
	ctx: ValorantSessionContext,
	matchId: string
): Promise<unknown> {
	return pdFetchJson(ctx, `/match-details/v1/matches/${matchId}`);
}

const NameServiceResponseSchema = z.array(
	z.object({
		Subject: z.string(),
		GameName: z.string().nullable().optional(),
		TagLine: z.string().nullable().optional(),
		DisplayName: z.string().nullable().optional()
	})
);

/**
 * Batch-resolve Riot IDs (`GameName#TagLine`) for player PUUIDs via `PUT /name-service/v2/players`.
 * Riot's `match-details` payload often returns empty strings `""` for `gameName`/`tagLine` unless
 * resolved through Name Service (or when a player enables Streamer / Hide Name privacy mode).
 */
export async function fetchPlayerNames(
	ctx: ValorantSessionContext,
	puuids: string[]
): Promise<Map<string, { gameName: string; tagLine: string }>> {
	const resolved = new Map<string, { gameName: string; tagLine: string }>();
	const unique = Array.from(
		new Set(puuids.map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0))
	);
	if (unique.length === 0) return resolved;

	const CHUNK_SIZE = 50;
	for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
		const chunk = unique.slice(i, i + CHUNK_SIZE);
		try {
			const raw = await pdFetchJson(ctx, '/name-service/v2/players', {
				method: 'PUT',
				body: JSON.stringify(chunk)
			});
			const parsed = NameServiceResponseSchema.safeParse(raw);
			if (!parsed.success) continue;

			for (const entry of parsed.data) {
				const gameName = entry.GameName?.trim() || entry.DisplayName?.trim() || '';
				const tagLine = entry.TagLine?.trim() || '';
				if (gameName) {
					resolved.set(entry.Subject.toLowerCase(), { gameName, tagLine });
				}
			}
		} catch {
			// Best-effort enrichment: never fail match syncing if Name Service is unavailable
		}
	}

	return resolved;
}

const HENRIKDEV_BASE_URL = 'https://api.henrikdev.xyz';

async function henrikFetchData(path: string, apiKey: string): Promise<unknown | null> {
	const res = await fetch(`${HENRIKDEV_BASE_URL}${path}`, {
		headers: {
			Authorization: apiKey.trim(),
			Accept: 'application/json'
		},
		signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
	});
	if (!res.ok) return null;
	const json = (await res.json()) as { data?: unknown };
	return json?.data ?? null;
}

export async function fetchHenrikMatchV4Raw(
	region: string,
	matchId: string,
	apiKey: string
): Promise<unknown | null> {
	return henrikFetchData(
		`/valorant/v4/match/${encodeURIComponent(region)}/${encodeURIComponent(matchId)}`,
		apiKey
	);
}

/**
 * Fetch HenrikDev's archived `stored-matches`, `stored-mmr-history`, live `v4/matches`,
 * `v3/mmr`, and `v1/account` for a player using their PUUID (or `gameName#tagLine` fallback).
 */
export async function fetchHenrikTrackerBundle(params: {
	puuid: string;
	gameName: string;
	tagLine: string;
	region: string;
	apiKey: string;
}): Promise<{
	account: unknown | null;
	mmrV3: unknown | null;
	v4Matches: unknown[];
	storedMatches: unknown[];
	rrDeltaByMatchId: Map<string, number>;
	latestRankedMatchId: string | null;
}> {
	const { puuid, gameName, tagLine, region, apiKey } = params;
	const affinity = encodeURIComponent((region || 'ap').toLowerCase());
	const hasPuuid = Boolean(puuid.trim());
	const encodedPuuid = encodeURIComponent(puuid.trim());
	const encodedName = encodeURIComponent(gameName.trim());
	const encodedTag = encodeURIComponent(tagLine.trim());

	const storedMatchesPath = hasPuuid
		? `/valorant/v1/by-puuid/stored-matches/${affinity}/${encodedPuuid}`
		: `/valorant/v1/stored-matches/${affinity}/${encodedName}/${encodedTag}`;
	const storedMmrPath = hasPuuid
		? `/valorant/v1/by-puuid/stored-mmr-history/${affinity}/${encodedPuuid}`
		: `/valorant/v1/stored-mmr-history/${affinity}/${encodedName}/${encodedTag}`;
	const v4MatchesPath = hasPuuid
		? `/valorant/v4/by-puuid/matches/${affinity}/pc/${encodedPuuid}?size=10`
		: `/valorant/v4/matches/${affinity}/pc/${encodedName}/${encodedTag}?size=10`;
	const mmrV3Path = hasPuuid
		? `/valorant/v3/by-puuid/mmr/${affinity}/pc/${encodedPuuid}`
		: `/valorant/v3/mmr/${affinity}/pc/${encodedName}/${encodedTag}`;
	const accountPath = hasPuuid
		? `/valorant/v1/by-puuid/account/${encodedPuuid}`
		: `/valorant/v1/account/${encodedName}/${encodedTag}`;

	const [storedMatchesRes, storedMmrRes, v4MatchesRes, mmrV3Res, accountRes] =
		await Promise.allSettled([
			henrikFetchData(storedMatchesPath, apiKey),
			henrikFetchData(storedMmrPath, apiKey),
			henrikFetchData(v4MatchesPath, apiKey),
			henrikFetchData(mmrV3Path, apiKey),
			henrikFetchData(accountPath, apiKey)
		]);

	const storedMatches =
		storedMatchesRes.status === 'fulfilled' && Array.isArray(storedMatchesRes.value)
			? storedMatchesRes.value
			: [];
	const v4Matches =
		v4MatchesRes.status === 'fulfilled' && Array.isArray(v4MatchesRes.value)
			? v4MatchesRes.value
			: [];
	const storedMmrList =
		storedMmrRes.status === 'fulfilled' && Array.isArray(storedMmrRes.value)
			? (storedMmrRes.value as Array<{ match_id?: string; last_mmr_change?: number }>)
			: [];

	const rrDeltaByMatchId = new Map<string, number>();
	let latestRankedMatchId: string | null = null;
	for (const entry of storedMmrList) {
		const id = entry.match_id?.trim();
		if (!id) continue;
		if (!latestRankedMatchId) latestRankedMatchId = id;
		if (typeof entry.last_mmr_change === 'number') {
			rrDeltaByMatchId.set(id.toLowerCase(), entry.last_mmr_change);
		}
	}

	return {
		account: accountRes.status === 'fulfilled' ? accountRes.value : null,
		mmrV3: mmrV3Res.status === 'fulfilled' ? mmrV3Res.value : null,
		v4Matches,
		storedMatches,
		rrDeltaByMatchId,
		latestRankedMatchId
	};
}
