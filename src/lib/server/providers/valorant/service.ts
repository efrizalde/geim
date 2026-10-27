import { and, desc, eq } from 'drizzle-orm';
import { ENCRYPTION_MASTER_KEY, HENRIKDEV_API_KEY } from '$app/env/private';
import { safeErrorMessage } from '../../crypto/redact';
import { openPayload, sealPayload } from '../../crypto/seal';
import { getDb, schema } from '../../db';
import { calculateProportionalValuation, type SupportedCurrency } from '../../valuation/money';
import {
	DEFAULT_ID_VP_PACK_PROFILE,
	getIdrToUsdFxRate,
	getPlayerCardMeta,
	getPlayerTitleText,
	getValorantAssetIndex,
	type TierMetadata
} from './assets';
import {
	attemptDirectLogin,
	fetchAccountXpRaw,
	fetchCompetitiveUpdates,
	fetchEntitlementsToken,
	fetchHenrikMatchV4Raw,
	fetchHenrikTrackerBundle,
	fetchMatchDetailsRaw,
	fetchMatchHistory,
	fetchOwnedCategory,
	fetchPlayerMmrRaw,
	fetchPlayerNames,
	fetchRiotClientVersion,
	fetchRiotIdentity,
	fetchStorefront,
	fetchWallet,
	renewSessionWithCookies,
	resolveValorantAffinity,
	submitDirectMfa,
	type CookieJar,
	type ValorantSessionContext
} from './client';
import type { SkinAcquisitionSource } from './skin-catalog';
import { regionToPdShard } from './constants';
import {
	parseAuthRedirectUrl,
	type NormalizedStorefront,
	type NormalizedWallet,
	type ParsedAuthTokens
} from './schemas';
import {
	collectMissingNamePuuids,
	extractCareerProfile,
	extractHenrikCareerProfile,
	hydrateMatchesWithAssets,
	mergeStoredMatches,
	parseDetailedMatch,
	parseHenrikStoredMatch,
	parseHenrikV4Match,
	type HydratedMatchItem,
	type StoredCareerProfile,
	type StoredMatchRecord
} from './tracker';

interface SealedRiotSession {
	accessToken: string;
	idToken?: string;
	entitlementsToken: string;
	cookies: CookieJar;
}

const REFRESH_COOLDOWN_MS = 12_000;

function requireMasterKey(): string {
	if (!ENCRYPTION_MASTER_KEY) {
		throw new Error('ENCRYPTION_MASTER_KEY is not configured in .env.');
	}
	return ENCRYPTION_MASTER_KEY;
}

export type ConnectAccountInput =
	| { mode: 'redirect'; redirectUrl: string; ssidCookie?: string }
	| { mode: 'ssid'; ssidCookie: string }
	| { mode: 'credentials'; username: string; password: string };

export type ConnectAccountResult =
	| { status: 'connected'; accountId: string; riotId: string }
	| { status: 'mfa_required'; pendingCookiesSealed: string; emailHint?: string }
	| { status: 'error'; message: string };

export async function connectValorantAccount(
	userId: string,
	input: ConnectAccountInput
): Promise<ConnectAccountResult> {
	const masterKey = requireMasterKey();
	let tokens: ParsedAuthTokens;
	let cookies: CookieJar = {};

	try {
		if (input.mode === 'redirect') {
			tokens = parseAuthRedirectUrl(input.redirectUrl);
			if (input.ssidCookie?.trim()) {
				cookies.ssid = input.ssidCookie.trim();
			}
		} else if (input.mode === 'ssid') {
			const ssid = input.ssidCookie.trim();
			if (!ssid) return { status: 'error', message: 'Please paste a valid ssid cookie value.' };
			const outcome = await renewSessionWithCookies({ ssid });
			if (outcome.status !== 'ok') {
				return {
					status: 'error',
					message:
						outcome.status === 'blocked_cloudflare'
							? 'Cloudflare blocked ssid renewal from this IP. Use the Redirect URL option instead.'
							: `ssid cookie renewal failed (${outcome.status}).`
				};
			}
			tokens = outcome.tokens;
			cookies = outcome.cookies;
		} else {
			const outcome = await attemptDirectLogin(input.username.trim(), input.password);
			if (outcome.status === 'mfa_required') {
				const pendingCookiesSealed = sealPayload(
					JSON.stringify(outcome.cookies),
					masterKey,
					`mfa:${userId}`
				);
				return {
					status: 'mfa_required',
					pendingCookiesSealed,
					emailHint: outcome.emailHint
				};
			}
			if (outcome.status !== 'ok') {
				return {
					status: 'error',
					message:
						outcome.status === 'blocked_captcha'
							? 'Riot blocked direct login with Cloudflare/hCaptcha. Use the Redirect URL option instead.'
							: outcome.status === 'invalid_credentials'
								? 'Invalid Riot username or password.'
								: `Direct login failed (${outcome.status}).`
				};
			}
			tokens = outcome.tokens;
			cookies = outcome.cookies;
		}

		return await finalizeAndSyncLinkedAccount(userId, tokens, cookies);
	} catch (err) {
		return { status: 'error', message: safeErrorMessage(err) };
	}
}

export async function submitValorantMfaCode(
	userId: string,
	code: string,
	pendingCookiesSealed: string
): Promise<ConnectAccountResult> {
	const masterKey = requireMasterKey();
	try {
		const pendingCookies = JSON.parse(
			openPayload(pendingCookiesSealed, masterKey, `mfa:${userId}`)
		) as CookieJar;

		const outcome = await submitDirectMfa(code, pendingCookies);
		if (outcome.status !== 'ok') {
			return {
				status: 'error',
				message:
					outcome.status === 'invalid_credentials'
						? 'Invalid or expired MFA code.'
						: `MFA verification failed (${outcome.status}).`
			};
		}

		return await finalizeAndSyncLinkedAccount(userId, outcome.tokens, outcome.cookies);
	} catch (err) {
		return { status: 'error', message: safeErrorMessage(err) };
	}
}

async function finalizeAndSyncLinkedAccount(
	userId: string,
	tokens: ParsedAuthTokens,
	cookies: CookieJar
): Promise<ConnectAccountResult> {
	const masterKey = requireMasterKey();
	const db = getDb();

	const [entitlementsToken, identity, affinity] = await Promise.all([
		fetchEntitlementsToken(tokens.accessToken),
		fetchRiotIdentity(tokens.accessToken),
		resolveValorantAffinity(tokens.accessToken, tokens.idToken, 'ap')
	]);

	const authMode = cookies.ssid ? 'cookie_jar' : 'token_only';
	const now = new Date();
	const expiresAt = new Date(now.getTime() + tokens.expiresInSeconds * 1000);

	const existingRows = await db
		.select({ id: schema.linkedAccounts.id })
		.from(schema.linkedAccounts)
		.where(
			and(
				eq(schema.linkedAccounts.userId, userId),
				eq(schema.linkedAccounts.game, 'valorant'),
				eq(schema.linkedAccounts.puuid, identity.puuid)
			)
		)
		.limit(1);

	let accountId: string;
	if (existingRows[0]) {
		accountId = existingRows[0].id;
		await db
			.update(schema.linkedAccounts)
			.set({
				gameName: identity.gameName,
				tagLine: identity.tagLine,
				region: affinity.region,
				shard: affinity.shard,
				authMode,
				connectionStatus: 'connected',
				updatedAt: now
			})
			.where(eq(schema.linkedAccounts.id, accountId));
	} else {
		const inserted = await db
			.insert(schema.linkedAccounts)
			.values({
				userId,
				game: 'valorant',
				puuid: identity.puuid,
				gameName: identity.gameName,
				tagLine: identity.tagLine,
				region: affinity.region,
				shard: affinity.shard,
				authMode,
				connectionStatus: 'connected'
			})
			.returning({ id: schema.linkedAccounts.id });
		accountId = inserted[0].id;
	}

	const sessionPayload: SealedRiotSession = {
		accessToken: tokens.accessToken,
		idToken: tokens.idToken,
		entitlementsToken,
		cookies
	};
	const sealedPayload = sealPayload(JSON.stringify(sessionPayload), masterKey, accountId);

	await db
		.insert(schema.providerSessions)
		.values({
			linkedAccountId: accountId,
			sealedPayload,
			keyVersion: 1,
			accessTokenExpiresAt: expiresAt,
			lastRenewedAt: now,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: schema.providerSessions.linkedAccountId,
			set: {
				sealedPayload,
				accessTokenExpiresAt: expiresAt,
				lastRenewedAt: now,
				updatedAt: now
			}
		});

	await syncValorantAccountData(userId, accountId, { bypassCooldown: true });

	return {
		status: 'connected',
		accountId,
		riotId: `${identity.gameName}#${identity.tagLine}`
	};
}

async function syncTrackerWithHenrikDev(params: {
	account: typeof schema.linkedAccounts.$inferSelect;
	apiKey: string;
	hydrateScoreboardLimit?: number;
}): Promise<boolean> {
	const { account, apiKey, hydrateScoreboardLimit = 12 } = params;
	const db = getDb();
	try {
		const [assets, bundle, prevRows] = await Promise.all([
			getValorantAssetIndex(),
			fetchHenrikTrackerBundle({
				puuid: account.puuid,
				gameName: account.gameName,
				tagLine: account.tagLine,
				region: account.region,
				apiKey
			}),
			db
				.select()
				.from(schema.trackerSnapshots)
				.where(eq(schema.trackerSnapshots.linkedAccountId, account.id))
				.orderBy(desc(schema.trackerSnapshots.fetchedAt))
				.limit(5)
		]);

		let existingMatches: StoredMatchRecord[] = [];
		for (const row of [...prevRows].reverse()) {
			const rowMatches = (row.matchesJson as StoredMatchRecord[]) ?? [];
			existingMatches = mergeStoredMatches(existingMatches, rowMatches, bundle.rrDeltaByMatchId);
		}
		const prevCareer = (prevRows[0]?.profileJson as StoredCareerProfile) ?? null;

		const v4Parsed = bundle.v4Matches
			.map((raw) => parseHenrikV4Match(raw, account.puuid, bundle.rrDeltaByMatchId))
			.filter((m): m is StoredMatchRecord => m !== null);
		const storedParsed = bundle.storedMatches
			.map((raw) => parseHenrikStoredMatch(raw, bundle.rrDeltaByMatchId))
			.filter((m): m is StoredMatchRecord => m !== null);

		let merged = mergeStoredMatches(existingMatches, storedParsed, bundle.rrDeltaByMatchId);
		merged = mergeStoredMatches(merged, v4Parsed, bundle.rrDeltaByMatchId);

		// Hydrate full 10-player scoreboards for stored matches missing a scoreboard (bounded per sync)
		const missingScoreboardIds = merged
			.filter((m) => m.scoreboard.length === 0)
			.slice(0, hydrateScoreboardLimit)
			.map((m) => m.matchId);

		const hydratedV4Records: StoredMatchRecord[] = [];
		const BATCH_SIZE = 4;
		for (let i = 0; i < missingScoreboardIds.length; i += BATCH_SIZE) {
			const batch = missingScoreboardIds.slice(i, i + BATCH_SIZE);
			const settled = await Promise.allSettled(
				batch.map((id) => fetchHenrikMatchV4Raw(account.region, id, apiKey))
			);
			for (const r of settled) {
				if (r.status === 'fulfilled' && r.value) {
					const parsed = parseHenrikV4Match(r.value, account.puuid, bundle.rrDeltaByMatchId);
					if (parsed) hydratedV4Records.push(parsed);
				}
			}
		}

		if (hydratedV4Records.length > 0) {
			merged = mergeStoredMatches(merged, hydratedV4Records, bundle.rrDeltaByMatchId);
		}

		const careerProfile = extractHenrikCareerProfile({
			rawAccount: bundle.account,
			rawMmrV3: bundle.mmrV3,
			latestRankedMatchId: bundle.latestRankedMatchId,
			seasonsById: assets.seasonsById,
			fallbackProfile: prevCareer
		});

		if (!careerProfile && merged.length === 0) return false;

		const syncedAt = new Date();
		await db.insert(schema.trackerSnapshots).values({
			linkedAccountId: account.id,
			fetchedAt: syncedAt,
			profileJson: careerProfile ??
				prevCareer ?? {
					accountLevel: null,
					accountXp: null,
					playerCardId: null,
					playerTitleId: null,
					latestSeasonId: null,
					currentTier: 0,
					currentRr: 0,
					lastRrDelta: null,
					lastRankedMatchId: null,
					actWins: 0,
					actGames: 0,
					peakTier: 0,
					peakSeasonId: null,
					actHistory: []
				},
			matchesJson: merged,
			parserVersion: 3
		});

		const hAcc = bundle.account as { name?: string; tag?: string } | null;
		await db
			.update(schema.linkedAccounts)
			.set({
				...(hAcc?.name?.trim()
					? {
							gameName: hAcc.name.trim(),
							tagLine: hAcc.tag?.trim() || account.tagLine
						}
					: {}),
				lastSyncedAt: syncedAt,
				updatedAt: syncedAt
			})
			.where(eq(schema.linkedAccounts.id, account.id));

		return true;
	} catch {
		return false;
	}
}

export async function syncValorantAccountData(
	userId: string,
	accountId: string,
	opts: { bypassCooldown?: boolean; deepHistory?: boolean } = {}
): Promise<{ ok: boolean; error?: string }> {
	const db = getDb();
	const masterKey = requireMasterKey();
	const henrikKey = HENRIKDEV_API_KEY?.trim() || '';

	const accRows = await db
		.select()
		.from(schema.linkedAccounts)
		.where(and(eq(schema.linkedAccounts.id, accountId), eq(schema.linkedAccounts.userId, userId)))
		.limit(1);

	const account = accRows[0];
	if (!account) {
		return { ok: false, error: 'Account not found.' };
	}

	if (
		!opts.bypassCooldown &&
		account.lastSyncedAt &&
		Date.now() - account.lastSyncedAt.getTime() < REFRESH_COOLDOWN_MS
	) {
		return { ok: true };
	}

	// When the user explicitly requests Fetch Deep History and HenrikDev is configured, run HenrikDev directly
	if (opts.deepHistory && henrikKey) {
		const ok = await syncTrackerWithHenrikDev({
			account,
			apiKey: henrikKey,
			hydrateScoreboardLimit: 20
		});
		if (ok) return { ok: true };
	}

	const sessRows = await db
		.select()
		.from(schema.providerSessions)
		.where(eq(schema.providerSessions.linkedAccountId, accountId))
		.limit(1);

	const providerSession = sessRows[0];
	if (!providerSession) {
		await db
			.update(schema.linkedAccounts)
			.set({ connectionStatus: 'reconnect_required', updatedAt: new Date() })
			.where(eq(schema.linkedAccounts.id, accountId));
		if (henrikKey) {
			const hOk = await syncTrackerWithHenrikDev({ account, apiKey: henrikKey });
			if (hOk && opts.deepHistory) return { ok: true };
		}
		return { ok: false, error: 'Session missing; please reconnect Riot account.' };
	}

	let unsealed: SealedRiotSession;
	try {
		unsealed = JSON.parse(
			openPayload(providerSession.sealedPayload, masterKey, accountId)
		) as SealedRiotSession;
	} catch {
		return { ok: false, error: 'Failed to decrypt Riot session. Please reconnect.' };
	}

	const now = Date.now();
	const tokenExpired =
		!providerSession.accessTokenExpiresAt ||
		providerSession.accessTokenExpiresAt.getTime() - now < 60_000;

	if (tokenExpired) {
		if (!unsealed.cookies?.ssid) {
			await db
				.update(schema.linkedAccounts)
				.set({ connectionStatus: 'reconnect_required', updatedAt: new Date() })
				.where(eq(schema.linkedAccounts.id, accountId));
			if (henrikKey) {
				const hOk = await syncTrackerWithHenrikDev({ account, apiKey: henrikKey });
				if (hOk) {
					return opts.deepHistory
						? { ok: true }
						: {
								ok: false,
								error:
									'Tracker match history synced via HenrikDev. Reconnect Riot URL/ssid to refresh Daily Shop & Inventory.'
							};
				}
			}
			return {
				ok: false,
				error: 'Short-lived Riot token expired. Paste a fresh Redirect URL or add an ssid cookie.'
			};
		}

		const renewed = await renewSessionWithCookies(unsealed.cookies);
		if (renewed.status !== 'ok') {
			await db
				.update(schema.linkedAccounts)
				.set({ connectionStatus: 'reconnect_required', updatedAt: new Date() })
				.where(eq(schema.linkedAccounts.id, accountId));
			if (henrikKey) {
				const hOk = await syncTrackerWithHenrikDev({ account, apiKey: henrikKey });
				if (hOk && opts.deepHistory) return { ok: true };
			}
			return {
				ok: false,
				error: `Session renewal failed (${renewed.status}). Please reconnect your Riot account.`
			};
		}

		const newEntitlements = await fetchEntitlementsToken(renewed.tokens.accessToken);
		unsealed = {
			accessToken: renewed.tokens.accessToken,
			idToken: renewed.tokens.idToken,
			entitlementsToken: newEntitlements,
			cookies: renewed.cookies
		};
		const newExpiresAt = new Date(Date.now() + renewed.tokens.expiresInSeconds * 1000);
		await db
			.update(schema.providerSessions)
			.set({
				sealedPayload: sealPayload(JSON.stringify(unsealed), masterKey, accountId),
				accessTokenExpiresAt: newExpiresAt,
				lastRenewedAt: new Date(),
				updatedAt: new Date()
			})
			.where(eq(schema.providerSessions.linkedAccountId, accountId));
	}

	try {
		const [clientVersion, assets] = await Promise.all([
			fetchRiotClientVersion(),
			getValorantAssetIndex()
		]);

		const ctx: ValorantSessionContext = {
			puuid: account.puuid,
			shard: regionToPdShard(account.region),
			region: account.region,
			accessToken: unsealed.accessToken,
			entitlementsToken: unsealed.entitlementsToken,
			clientVersion
		};

		const [
			storeRes,
			walletRes,
			skinsRes,
			chromasRes,
			buddiesRes,
			matchesRes,
			compMatchesRes,
			compUpdatesRes,
			xpRes,
			mmrRes,
			prevTrackerRows
		] = await Promise.allSettled([
			fetchStorefront(ctx),
			fetchWallet(ctx),
			fetchOwnedCategory(ctx, 'SKIN_LEVELS'),
			fetchOwnedCategory(ctx, 'SKIN_CHROMAS'),
			fetchOwnedCategory(ctx, 'BUDDIES'),
			fetchMatchHistory(ctx, { startIndex: 0, endIndex: 20 }),
			fetchMatchHistory(ctx, { startIndex: 0, endIndex: 20, queue: 'competitive' }),
			fetchCompetitiveUpdates(ctx, { startIndex: 0, endIndex: 20, queue: 'competitive' }),
			fetchAccountXpRaw(ctx),
			fetchPlayerMmrRaw(ctx),
			db
				.select()
				.from(schema.trackerSnapshots)
				.where(eq(schema.trackerSnapshots.linkedAccountId, accountId))
				.orderBy(desc(schema.trackerSnapshots.fetchedAt))
				.limit(5)
		]);

		const syncedAt = new Date();

		if (storeRes.status === 'fulfilled') {
			const store: NormalizedStorefront = storeRes.value;
			const wallet = walletRes.status === 'fulfilled' ? walletRes.value : null;

			await db.insert(schema.storeSnapshots).values({
				linkedAccountId: accountId,
				fetchedAt: new Date(store.fetchedAt),
				dailyExpiresAt: new Date(store.dailyExpiresAt),
				bonusExpiresAt:
					store.nightMarket.status === 'active' ? new Date(store.nightMarket.expiresAt) : null,
				offersJson: store,
				walletJson: wallet,
				parserVersion: 2
			});
		} else {
			const errMsg = safeErrorMessage(storeRes.reason);
			if (errMsg.includes('HTTP 400') || errMsg.includes('HTTP 401')) {
				await db
					.update(schema.linkedAccounts)
					.set({ connectionStatus: 'reconnect_required', updatedAt: new Date() })
					.where(eq(schema.linkedAccounts.id, accountId));
				return {
					ok: false,
					error: 'Riot session token expired. Click Link / Reconnect to paste a fresh Redirect URL.'
				};
			}
			return { ok: false, error: errMsg };
		}

		if (skinsRes.status === 'fulfilled') {
			const skinLevelIds = skinsRes.value.Entitlements.map((e) => e.ItemID.toLowerCase());
			const chromaIds =
				chromasRes.status === 'fulfilled'
					? chromasRes.value.Entitlements.map((e) => e.ItemID.toLowerCase())
					: [];
			const buddyCount =
				buddiesRes.status === 'fulfilled' ? buddiesRes.value.Entitlements.length : null;
			const matches = matchesRes.status === 'fulfilled' ? matchesRes.value : null;

			await db.insert(schema.inventorySnapshots).values({
				linkedAccountId: accountId,
				fetchedAt: syncedAt,
				skinLevelIdsJson: skinLevelIds,
				chromaIdsJson: chromaIds,
				buddyCount,
				matchesJson: matches,
				parserVersion: 1
			});
		}

		// Paginate additional Riot PD match-history & competitive-updates slices when available
		const maxGeneralIndex = opts.deepHistory ? 100 : 60;
		const maxCompIndex = opts.deepHistory ? 80 : 40;
		const extraPagesPromises: Array<Promise<unknown>> = [];
		if (matchesRes.status === 'fulfilled' && matchesRes.value.Total > matchesRes.value.EndIndex) {
			const total = Math.min(matchesRes.value.Total, maxGeneralIndex);
			for (let start = matchesRes.value.EndIndex; start < total; start += 20) {
				extraPagesPromises.push(
					fetchMatchHistory(ctx, { startIndex: start, endIndex: Math.min(start + 20, total) })
				);
			}
		}
		if (
			compMatchesRes.status === 'fulfilled' &&
			compMatchesRes.value.Total > compMatchesRes.value.EndIndex
		) {
			const totalComp = Math.min(compMatchesRes.value.Total, maxCompIndex);
			for (let start = compMatchesRes.value.EndIndex; start < totalComp; start += 20) {
				extraPagesPromises.push(
					fetchMatchHistory(ctx, {
						startIndex: start,
						endIndex: Math.min(start + 20, totalComp),
						queue: 'competitive'
					})
				);
			}
		}
		if (opts.deepHistory) {
			for (const q of ['unrated', 'deathmatch', 'swiftplay']) {
				extraPagesPromises.push(fetchMatchHistory(ctx, { startIndex: 0, endIndex: 20, queue: q }));
			}
		}
		if (compUpdatesRes.status === 'fulfilled' && compUpdatesRes.value.Matches.length >= 15) {
			extraPagesPromises.push(
				fetchCompetitiveUpdates(ctx, { startIndex: 20, endIndex: 40, queue: 'competitive' })
			);
			if (opts.deepHistory) {
				extraPagesPromises.push(
					fetchCompetitiveUpdates(ctx, { startIndex: 40, endIndex: 60, queue: 'competitive' })
				);
			}
		}

		const extraPagesSettled =
			extraPagesPromises.length > 0 ? await Promise.allSettled(extraPagesPromises) : [];

		const rrDeltaByMatchId = new Map<string, number>();
		const orderedMatchIds: string[] = [];
		const seenMatchIds = new Set<string>();
		const pushMatchId = (id: string | undefined) => {
			const trimmed = id?.trim();
			if (!trimmed) return;
			const lower = trimmed.toLowerCase();
			if (seenMatchIds.has(lower)) return;
			seenMatchIds.add(lower);
			orderedMatchIds.push(trimmed);
		};

		if (matchesRes.status === 'fulfilled') {
			for (const h of matchesRes.value.History) pushMatchId(h.MatchID);
		}
		if (compMatchesRes.status === 'fulfilled') {
			for (const h of compMatchesRes.value.History) pushMatchId(h.MatchID);
		}
		if (compUpdatesRes.status === 'fulfilled') {
			for (const u of compUpdatesRes.value.Matches) {
				pushMatchId(u.MatchID);
				if (typeof u.RankedRatingEarned === 'number') {
					rrDeltaByMatchId.set(u.MatchID.toLowerCase(), u.RankedRatingEarned);
				}
			}
		}
		for (const res of extraPagesSettled) {
			if (res.status !== 'fulfilled' || !res.value || typeof res.value !== 'object') continue;
			const val = res.value as {
				History?: Array<{ MatchID: string }>;
				Matches?: Array<{ MatchID: string; RankedRatingEarned?: number }>;
			};
			for (const h of val.History ?? []) pushMatchId(h.MatchID);
			for (const u of val.Matches ?? []) {
				pushMatchId(u.MatchID);
				if (typeof u.RankedRatingEarned === 'number') {
					rrDeltaByMatchId.set(u.MatchID.toLowerCase(), u.RankedRatingEarned);
				}
			}
		}

		// Reuse previously indexed match records so we only fetch details for new matches
		let existingMatches: StoredMatchRecord[] = [];
		let prevCareer: StoredCareerProfile | null = null;
		if (prevTrackerRows.status === 'fulfilled') {
			for (const row of [...prevTrackerRows.value].reverse()) {
				const rowMatches = (row.matchesJson as StoredMatchRecord[]) ?? [];
				existingMatches = mergeStoredMatches(existingMatches, rowMatches, rrDeltaByMatchId);
			}
			prevCareer = (prevTrackerRows.value[0]?.profileJson as StoredCareerProfile) ?? null;
		}
		const existingById = new Map(existingMatches.map((m) => [m.matchId.toLowerCase(), m]));

		// Always fetch the newest match (for fresh playerCard/title) + any unindexed match IDs (bounded)
		const newestMatchId = orderedMatchIds[0];
		const missingMatchIds = orderedMatchIds.filter(
			(id, idx) => idx === 0 || !existingById.has(id.toLowerCase())
		);
		const idsToFetch = missingMatchIds.slice(0, 35);

		// ponytail: batch size 8 keeps Riot PD concurrency safe without a queue dependency
		const rawMatchPayloads: unknown[] = [];
		let latestMatchRaw: unknown | null = null;
		const BATCH_SIZE = 8;
		for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
			const batch = idsToFetch.slice(i, i + BATCH_SIZE);
			const settled = await Promise.allSettled(batch.map((id) => fetchMatchDetailsRaw(ctx, id)));
			settled.forEach((r, idx) => {
				if (r.status === 'fulfilled') {
					rawMatchPayloads.push(r.value);
					if (newestMatchId && batch[idx]?.toLowerCase() === newestMatchId.toLowerCase()) {
						latestMatchRaw = r.value;
					}
				}
			});
		}

		const careerProfile = extractCareerProfile({
			rawXp: xpRes.status === 'fulfilled' ? xpRes.value : null,
			rawMmr: mmrRes.status === 'fulfilled' ? mmrRes.value : null,
			latestMatchRaw: latestMatchRaw ?? rawMatchPayloads[0] ?? null,
			ownerPuuid: account.puuid,
			seasonsById: assets.seasonsById
		});
		if (!careerProfile.playerCardId && prevCareer?.playerCardId) {
			careerProfile.playerCardId = prevCareer.playerCardId;
		}
		if (!careerProfile.playerTitleId && prevCareer?.playerTitleId) {
			careerProfile.playerTitleId = prevCareer.playerTitleId;
		}
		if (careerProfile.accountLevel === null && prevCareer?.accountLevel !== null) {
			careerProfile.accountLevel = prevCareer?.accountLevel ?? null;
		}
		if (
			careerProfile.lastRankedMatchId &&
			typeof careerProfile.lastRrDelta === 'number' &&
			!rrDeltaByMatchId.has(careerProfile.lastRankedMatchId.toLowerCase())
		) {
			rrDeltaByMatchId.set(
				careerProfile.lastRankedMatchId.toLowerCase(),
				careerProfile.lastRrDelta
			);
		}

		const missingNamePuuids = collectMissingNamePuuids(rawMatchPayloads);
		if (!account.gameName.trim() || account.gameName === 'Unknown') {
			missingNamePuuids.push(account.puuid.toLowerCase());
		}
		const resolvedNamesByPuuid = await fetchPlayerNames(ctx, missingNamePuuids);
		if (
			!resolvedNamesByPuuid.has(account.puuid.toLowerCase()) &&
			account.gameName.trim() &&
			account.gameName !== 'Unknown'
		) {
			resolvedNamesByPuuid.set(account.puuid.toLowerCase(), {
				gameName: account.gameName.trim(),
				tagLine: account.tagLine.trim()
			});
		}

		const newlyParsedMatches: StoredMatchRecord[] = rawMatchPayloads
			.map((raw) =>
				parseDetailedMatch(
					raw,
					account.puuid,
					{
						matchId: careerProfile.lastRankedMatchId,
						rrDelta: careerProfile.lastRrDelta
					},
					resolvedNamesByPuuid,
					rrDeltaByMatchId
				)
			)
			.filter((m): m is StoredMatchRecord => m !== null);

		const mergedMatches = mergeStoredMatches(existingMatches, newlyParsedMatches, rrDeltaByMatchId);

		await db.insert(schema.trackerSnapshots).values({
			linkedAccountId: accountId,
			fetchedAt: syncedAt,
			profileJson: careerProfile,
			matchesJson: mergedMatches,
			parserVersion: 2
		});

		if (henrikKey) {
			await syncTrackerWithHenrikDev({ account, apiKey: henrikKey, hydrateScoreboardLimit: 12 });
		}

		const refreshedOwnerIdentity = resolvedNamesByPuuid.get(account.puuid.toLowerCase());
		await db
			.update(schema.linkedAccounts)
			.set({
				...(refreshedOwnerIdentity?.gameName
					? {
							gameName: refreshedOwnerIdentity.gameName,
							tagLine: refreshedOwnerIdentity.tagLine || account.tagLine
						}
					: {}),
				connectionStatus: 'connected',
				lastSyncedAt: syncedAt,
				updatedAt: syncedAt
			})
			.where(eq(schema.linkedAccounts.id, accountId));

		return { ok: true };
	} catch (err) {
		return { ok: false, error: safeErrorMessage(err) };
	}
}

export async function disconnectValorantAccount(userId: string, accountId: string): Promise<void> {
	const db = getDb();
	await db
		.delete(schema.linkedAccounts)
		.where(and(eq(schema.linkedAccounts.id, accountId), eq(schema.linkedAccounts.userId, userId)));
}

export interface HydratedSkinLevelItem {
	uuid: string;
	levelNumber: number;
	displayName: string;
	effectLabel: string;
	displayIcon: string | null;
	streamedVideo: string | null;
	unlocked: boolean;
}

export interface HydratedChromaItem {
	uuid: string;
	name: string;
	swatch: string | null;
	render: string | null;
	streamedVideo: string | null;
	unlocked: boolean;
}

export interface HydratedShopCard {
	offerId: string;
	skinLevelId: string;
	displayName: string;
	weaponName: string;
	displayIcon: string | null;
	previewVideoUrl: string | null;
	totalLevels: number;
	levels: HydratedSkinLevelItem[];
	chromas: HydratedChromaItem[];
	tier: TierMetadata | null;
	vpPrice: number | null;
	fiatEstimate: string | null;
	baseVpPrice?: number | null;
	discountPercent?: number;
}

export interface HydratedOwnedSkin {
	skinUuid: string;
	displayName: string;
	weaponName: string;
	isMelee: boolean;
	displayIcon: string | null;
	previewVideoUrl: string | null;
	tier: TierMetadata | null;
	unlockedLevels: number;
	totalLevels: number;
	levels: HydratedSkinLevelItem[];
	unlockedChromas: number;
	totalChromas: number;
	chromas: HydratedChromaItem[];
	source: SkinAcquisitionSource;
	vpPrice: number | null;
	fiatEstimate: string | null;
}

export interface HydratedActOption {
	seasonId: string;
	label: string;
	tier: number;
	rankName: string;
	rankIcon: string | null;
	rankColorHex: string;
	peakTier: number;
	peakRankName: string;
	peakRankIcon: string | null;
	rr: number;
	wins: number;
	losses: number;
	games: number;
	matchSampleCount: number;
}

export interface HydratedProfileBanner {
	accountLevel: number | null;
	accountXp: number | null;
	avatarUrl: string | null;
	wideBannerUrl: string | null;
	heroAgentPortraitUrl: string | null;
	playerTitleText: string | null;
	currentRank: {
		tier: number;
		name: string;
		rr: number;
		lastRrDelta: number | null;
		iconUrl: string | null;
		colorHex: string;
		actLabel: string;
		actWins: number;
		actGames: number;
		actLosses: number;
	};
	peakRank: {
		tier: number;
		name: string;
		iconUrl: string | null;
		colorHex: string;
		actLabel: string;
	} | null;
}

export async function loadDashboardView(
	userId: string,
	displayCurrency: SupportedCurrency,
	selectedAccountId?: string
) {
	const db = getDb();
	const accounts = await db
		.select({
			id: schema.linkedAccounts.id,
			puuid: schema.linkedAccounts.puuid,
			gameName: schema.linkedAccounts.gameName,
			tagLine: schema.linkedAccounts.tagLine,
			region: schema.linkedAccounts.region,
			shard: schema.linkedAccounts.shard,
			authMode: schema.linkedAccounts.authMode,
			connectionStatus: schema.linkedAccounts.connectionStatus,
			lastSyncedAt: schema.linkedAccounts.lastSyncedAt
		})
		.from(schema.linkedAccounts)
		.where(eq(schema.linkedAccounts.userId, userId))
		.orderBy(desc(schema.linkedAccounts.updatedAt));

	const activeAccount = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0] ?? null;

	const [assets, fxRate] = await Promise.all([
		getValorantAssetIndex(),
		displayCurrency === 'USD' ? getIdrToUsdFxRate() : Promise.resolve(null)
	]);

	if (!activeAccount) {
		return {
			accounts: [],
			activeAccount: null,
			profile: null,
			currencyIcons: assets.currencyIcons,
			store: null,
			inventory: null,
			tracker: null
		};
	}

	const [latestStoreRows, latestInvRows, latestTrackerRows] = await Promise.all([
		db
			.select()
			.from(schema.storeSnapshots)
			.where(eq(schema.storeSnapshots.linkedAccountId, activeAccount.id))
			.orderBy(desc(schema.storeSnapshots.fetchedAt))
			.limit(5),
		db
			.select()
			.from(schema.inventorySnapshots)
			.where(eq(schema.inventorySnapshots.linkedAccountId, activeAccount.id))
			.orderBy(desc(schema.inventorySnapshots.fetchedAt))
			.limit(1),
		db
			.select()
			.from(schema.trackerSnapshots)
			.where(eq(schema.trackerSnapshots.linkedAccountId, activeAccount.id))
			.orderBy(desc(schema.trackerSnapshots.fetchedAt))
			.limit(5)
	]);

	const estimateSingleVp = (vp: number | null): string | null => {
		if (vp === null) return null;
		const res = calculateProportionalValuation({
			skins: [{ baseSkinId: 'item', vpPrice: vp }],
			packProfile: DEFAULT_ID_VP_PACK_PROFILE,
			displayCurrency,
			fxRate
		});
		return res.formattedEstimate;
	};

	const observedOfferVpBySkinUuid = new Map<string, number>();

	// Seed observed catalog VP prices from recent snapshots (oldest -> newest so freshest wins)
	for (const row of [...latestStoreRows].reverse()) {
		const snap = row.offersJson as NormalizedStorefront | null;
		if (!snap) continue;
		if (snap.catalogPrices) {
			for (const [lvlId, vp] of Object.entries(snap.catalogPrices)) {
				if (typeof vp !== 'number') continue;
				const meta = assets.bySkinLevelId.get(lvlId.toLowerCase());
				if (meta) {
					observedOfferVpBySkinUuid.set(meta.skinUuid, vp);
				}
			}
		}
		for (const offer of snap.dailyOffers ?? []) {
			if (offer.vpPrice === null) continue;
			const meta = assets.bySkinLevelId.get(offer.skinLevelId.toLowerCase());
			if (meta) {
				observedOfferVpBySkinUuid.set(meta.skinUuid, offer.vpPrice);
			}
		}
		if (snap.nightMarket?.status === 'active') {
			for (const nm of snap.nightMarket.offers) {
				if (nm.baseVpPrice === null) continue;
				const meta = assets.bySkinLevelId.get(nm.skinLevelId.toLowerCase());
				if (meta) {
					observedOfferVpBySkinUuid.set(meta.skinUuid, nm.baseVpPrice);
				}
			}
		}
	}

	let storeView = null;
	if (latestStoreRows[0]) {
		const rawStore = latestStoreRows[0].offersJson as NormalizedStorefront;
		const rawWallet = (latestStoreRows[0].walletJson as NormalizedWallet | null) ?? null;

		const dailyCards: HydratedShopCard[] = rawStore.dailyOffers.map((offer) => {
			const meta = assets.bySkinLevelId.get(offer.skinLevelId.toLowerCase());
			if (meta && offer.vpPrice !== null) {
				observedOfferVpBySkinUuid.set(meta.skinUuid, offer.vpPrice);
			}
			return {
				offerId: offer.offerId,
				skinLevelId: offer.skinLevelId,
				displayName: meta?.displayName ?? `Skin ${offer.skinLevelId.slice(0, 8)}`,
				weaponName: meta?.weaponName ?? 'Weapon',
				displayIcon: meta?.displayIcon ?? null,
				previewVideoUrl: meta?.previewVideoUrl ?? null,
				totalLevels: meta?.levelIds.length ?? 1,
				levels:
					meta?.levels.map((l, idx) => ({
						uuid: l.uuid,
						levelNumber: l.levelNumber,
						displayName: l.displayName,
						effectLabel: l.effectLabel,
						displayIcon: l.displayIcon,
						streamedVideo: l.streamedVideo,
						unlocked: idx === 0
					})) ?? [],
				chromas:
					meta?.chromas.map((c, idx) => ({
						uuid: c.uuid,
						name: c.displayName,
						swatch: c.swatch,
						render: c.fullRender ?? c.displayIcon,
						streamedVideo: c.streamedVideo,
						unlocked: idx === 0
					})) ?? [],
				tier: meta?.tier ?? null,
				vpPrice: offer.vpPrice,
				fiatEstimate: estimateSingleVp(offer.vpPrice)
			};
		});

		const nightMarketCards: HydratedShopCard[] | null =
			rawStore.nightMarket.status === 'active'
				? rawStore.nightMarket.offers.map((nm) => {
						const meta = assets.bySkinLevelId.get(nm.skinLevelId.toLowerCase());
						if (meta && nm.baseVpPrice !== null) {
							observedOfferVpBySkinUuid.set(meta.skinUuid, nm.baseVpPrice);
						}
						return {
							offerId: nm.offerId,
							skinLevelId: nm.skinLevelId,
							displayName: meta?.displayName ?? `Skin ${nm.skinLevelId.slice(0, 8)}`,
							weaponName: meta?.weaponName ?? 'Weapon',
							displayIcon: meta?.displayIcon ?? null,
							previewVideoUrl: meta?.previewVideoUrl ?? null,
							totalLevels: meta?.levelIds.length ?? 1,
							levels:
								meta?.levels.map((l, idx) => ({
									uuid: l.uuid,
									levelNumber: l.levelNumber,
									displayName: l.displayName,
									effectLabel: l.effectLabel,
									displayIcon: l.displayIcon,
									streamedVideo: l.streamedVideo,
									unlocked: idx === 0
								})) ?? [],
							chromas:
								meta?.chromas.map((c, idx) => ({
									uuid: c.uuid,
									name: c.displayName,
									swatch: c.swatch,
									render: c.fullRender ?? c.displayIcon,
									streamedVideo: c.streamedVideo,
									unlocked: idx === 0
								})) ?? [],
							tier: meta?.tier ?? null,
							vpPrice: nm.discountedVpPrice,
							baseVpPrice: nm.baseVpPrice,
							discountPercent: nm.discountPercent,
							fiatEstimate: estimateSingleVp(nm.discountedVpPrice)
						};
					})
				: null;

		storeView = {
			fetchedAt: rawStore.fetchedAt,
			dailyExpiresAt: rawStore.dailyExpiresAt,
			isStale: new Date(rawStore.dailyExpiresAt).getTime() <= Date.now(),
			dailyCards,
			nightMarket:
				rawStore.nightMarket.status === 'active'
					? {
							active: true as const,
							expiresAt: rawStore.nightMarket.expiresAt,
							cards: nightMarketCards ?? []
						}
					: { active: false as const, expiresAt: null, cards: [] },
			wallet: rawWallet
		};
	}

	let inventoryView = null;
	if (latestInvRows[0]) {
		const invRow = latestInvRows[0];
		const ownedLevelSet = new Set(
			(invRow.skinLevelIdsJson as string[]).map((id) => id.toLowerCase())
		);
		const ownedChromaSet = new Set(
			(invRow.chromaIdsJson as string[]).map((id) => id.toLowerCase())
		);

		const groupedBySkin = new Map<string, HydratedOwnedSkin>();
		for (const levelId of ownedLevelSet) {
			const meta = assets.bySkinLevelId.get(levelId);
			if (!meta || meta.isStandardOrRandom) continue;
			if (groupedBySkin.has(meta.skinUuid)) continue;

			const hydratedLevels: HydratedSkinLevelItem[] = meta.levels.map((l) => ({
				uuid: l.uuid,
				levelNumber: l.levelNumber,
				displayName: l.displayName,
				effectLabel: l.effectLabel,
				displayIcon: l.displayIcon,
				streamedVideo: l.streamedVideo,
				unlocked: ownedLevelSet.has(l.uuid)
			}));

			const hydratedChromas: HydratedChromaItem[] = meta.chromas.map((c, idx) => ({
				uuid: c.uuid,
				name: c.displayName,
				swatch: c.swatch,
				render: c.fullRender ?? c.displayIcon,
				streamedVideo: c.streamedVideo,
				unlocked: idx === 0 || ownedChromaSet.has(c.uuid)
			}));

			const unlockedLevels = hydratedLevels.filter((l) => l.unlocked).length;
			const unlockedChromas = hydratedChromas.filter((c) => c.unlocked).length;

			const knownVp =
				observedOfferVpBySkinUuid.get(meta.skinUuid) ?? meta.standardTierVpPrice ?? null;

			groupedBySkin.set(meta.skinUuid, {
				skinUuid: meta.skinUuid,
				displayName: meta.displayName,
				weaponName: meta.weaponName,
				isMelee: meta.isMelee,
				displayIcon: meta.displayIcon,
				previewVideoUrl: meta.previewVideoUrl,
				tier: meta.tier,
				unlockedLevels,
				totalLevels: meta.levelIds.length,
				levels: hydratedLevels,
				unlockedChromas,
				totalChromas: meta.chromas.length,
				chromas: hydratedChromas,
				source: meta.source,
				vpPrice: knownVp,
				fiatEstimate: estimateSingleVp(knownVp)
			});
		}

		const ownedSkins = Array.from(groupedBySkin.values()).sort((a, b) => {
			const priceDiff = (b.vpPrice ?? -1) - (a.vpPrice ?? -1);
			if (priceDiff !== 0) return priceDiff;
			return a.displayName.localeCompare(b.displayName);
		});

		const valuation = calculateProportionalValuation({
			skins: ownedSkins.map((s) => ({ baseSkinId: s.skinUuid, vpPrice: s.vpPrice })),
			packProfile: DEFAULT_ID_VP_PACK_PROFILE,
			displayCurrency,
			fxRate
		});

		inventoryView = {
			fetchedAt: invRow.fetchedAt.toISOString(),
			rawSkinLevelCount: ownedLevelSet.size,
			rawChromaCount: ownedChromaSet.size,
			buddyCount: invRow.buddyCount,
			ownedSkins,
			valuation: {
				ownedBaseSkinCount: valuation.ownedBaseSkinCount,
				pricedBaseSkinCount: valuation.pricedBaseSkinCount,
				unpricedBaseSkinCount: valuation.unpricedBaseSkinCount,
				isPartial: valuation.isPartial,
				knownVpSubtotal: valuation.knownVpSubtotal,
				formattedEstimate: valuation.formattedEstimate,
				unavailableReason: valuation.unavailableReason ?? null,
				packBasisLabel: DEFAULT_ID_VP_PACK_PROFILE.source,
				fxBasisLabel: fxRate ? `${fxRate.source} (${fxRate.asOf})` : null
			}
		};
	}

	let profileView: HydratedProfileBanner | null = null;
	let trackerView: {
		fetchedAt: string;
		latestSeasonId: string | null;
		latestSeasonLabel: string;
		hasFullActHistory: boolean;
		acts: HydratedActOption[];
		matches: HydratedMatchItem[];
	} | null = null;

	if (latestTrackerRows[0]) {
		const tRow = latestTrackerRows[0];
		const career = tRow.profileJson as StoredCareerProfile;
		let storedMatches: StoredMatchRecord[] = [];
		for (const row of [...latestTrackerRows].reverse()) {
			const rowMatches = (row.matchesJson as StoredMatchRecord[]) ?? [];
			storedMatches = mergeStoredMatches(storedMatches, rowMatches);
		}
		const hydratedMatches = hydrateMatchesWithAssets(storedMatches, assets, {
			puuid: activeAccount.puuid,
			gameName: activeAccount.gameName,
			tagLine: activeAccount.tagLine
		});

		const [cardMeta, titleText] = await Promise.all([
			getPlayerCardMeta(career.playerCardId),
			getPlayerTitleText(career.playerTitleId)
		]);

		// Find most played agent for atmospheric hero bust portrait
		const agentCounts = new Map<string, number>();
		for (const m of storedMatches) {
			if (m.characterId) {
				agentCounts.set(m.characterId, (agentCounts.get(m.characterId) ?? 0) + 1);
			}
		}
		const topAgentId = [...agentCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
		const heroAgentPortraitUrl = topAgentId
			? (assets.agentsById.get(topAgentId)?.bustPortrait ?? null)
			: null;

		const curRankMeta = assets.competitiveTiersById.get(career.currentTier);
		const curSeasonMeta = career.latestSeasonId
			? assets.seasonsById.get(career.latestSeasonId.toLowerCase())
			: undefined;

		const peakRankMeta =
			career.peakTier >= 3 ? assets.competitiveTiersById.get(career.peakTier) : undefined;
		const peakSeasonMeta = career.peakSeasonId
			? assets.seasonsById.get(career.peakSeasonId.toLowerCase())
			: undefined;

		profileView = {
			accountLevel: career.accountLevel,
			accountXp: career.accountXp,
			avatarUrl: cardMeta?.displayIcon ?? cardMeta?.smallArt ?? null,
			wideBannerUrl: cardMeta?.wideArt ?? null,
			heroAgentPortraitUrl,
			playerTitleText: titleText,
			currentRank: {
				tier: career.currentTier,
				name: curRankMeta?.tierName ?? 'Unrated',
				rr: career.currentRr,
				lastRrDelta: career.lastRrDelta,
				iconUrl: curRankMeta?.largeIcon ?? curRankMeta?.smallIcon ?? null,
				colorHex: curRankMeta?.colorHex ?? '#94a3b8',
				actLabel: curSeasonMeta?.fullLabel ?? 'Current Act',
				actWins: career.actWins,
				actGames: career.actGames,
				actLosses: Math.max(0, career.actGames - career.actWins)
			},
			peakRank: peakRankMeta
				? {
						tier: career.peakTier,
						name: peakRankMeta.tierName,
						iconUrl: peakRankMeta.largeIcon ?? peakRankMeta.smallIcon ?? null,
						colorHex: peakRankMeta.colorHex,
						actLabel: peakSeasonMeta?.fullLabel ?? 'Career Peak'
					}
				: null
		};

		// Hydrate full competitive Act history for the Act Dropdown
		const sampleCountBySeason = new Map<string, number>();
		for (const m of hydratedMatches) {
			if (m.seasonId) {
				sampleCountBySeason.set(m.seasonId, (sampleCountBySeason.get(m.seasonId) ?? 0) + 1);
			}
		}

		const hasFullActHistory = Boolean(career.actHistory && career.actHistory.length > 0);
		const fallbackActsMap = new Map<
			string,
			{ seasonId: string; tier: number; peakTier: number; rr: number; wins: number; games: number }
		>();
		if (!hasFullActHistory) {
			if (career.latestSeasonId) {
				const sid = career.latestSeasonId.toLowerCase();
				fallbackActsMap.set(sid, {
					seasonId: sid,
					tier: career.currentTier,
					peakTier: Math.max(career.currentTier, 0),
					rr: career.currentRr,
					wins: career.actWins,
					games: career.actGames
				});
			}
			for (const m of hydratedMatches) {
				if (m.seasonId && !fallbackActsMap.has(m.seasonId)) {
					const seasonMatches = hydratedMatches.filter((x) => x.seasonId === m.seasonId);
					const wins = seasonMatches.filter((x) => x.outcome === 'win').length;
					const maxTier = Math.max(0, ...seasonMatches.map((x) => x.competitiveTier));
					fallbackActsMap.set(m.seasonId, {
						seasonId: m.seasonId,
						tier: maxTier,
						peakTier: maxTier,
						rr: 0,
						wins,
						games: seasonMatches.length
					});
				}
			}
			if (career.peakSeasonId && career.peakTier >= 3) {
				const psid = career.peakSeasonId.toLowerCase();
				if (!fallbackActsMap.has(psid)) {
					fallbackActsMap.set(psid, {
						seasonId: psid,
						tier: career.peakTier,
						peakTier: career.peakTier,
						rr: 0,
						wins: 0,
						games: 0
					});
				}
			}
		}

		const rawActList = hasFullActHistory
			? career.actHistory!
			: [...fallbackActsMap.values()].sort((a, b) => {
					const msA = Date.parse(assets.seasonsById.get(a.seasonId)?.startTime ?? '') || 0;
					const msB = Date.parse(assets.seasonsById.get(b.seasonId)?.startTime ?? '') || 0;
					return msB - msA;
				});

		const acts: HydratedActOption[] = rawActList.map((entry) => {
			const sid = entry.seasonId.toLowerCase();
			const sMeta = assets.seasonsById.get(sid);
			const rMeta = assets.competitiveTiersById.get(entry.tier);
			const pMeta = assets.competitiveTiersById.get(entry.peakTier);
			return {
				seasonId: sid,
				label: sMeta?.fullLabel ?? `Season ${sid.slice(0, 6)}`,
				tier: entry.tier,
				rankName: rMeta?.tierName ?? 'Unrated',
				rankIcon: rMeta?.largeIcon ?? rMeta?.smallIcon ?? null,
				rankColorHex: rMeta?.colorHex ?? '#94a3b8',
				peakTier: entry.peakTier,
				peakRankName: pMeta?.tierName ?? 'Unrated',
				peakRankIcon: pMeta?.largeIcon ?? pMeta?.smallIcon ?? null,
				rr: entry.rr,
				wins: entry.wins,
				losses: Math.max(0, entry.games - entry.wins),
				games: entry.games,
				matchSampleCount: sampleCountBySeason.get(sid) ?? 0
			};
		});

		trackerView = {
			fetchedAt: tRow.fetchedAt.toISOString(),
			latestSeasonId: career.latestSeasonId?.toLowerCase() ?? null,
			latestSeasonLabel: curSeasonMeta?.fullLabel ?? 'Current Act',
			hasFullActHistory,
			acts,
			matches: hydratedMatches
		};
	}

	return {
		accounts: accounts.map((a) => ({
			id: a.id,
			gameName: a.gameName,
			tagLine: a.tagLine,
			region: a.region,
			shard: a.shard,
			authMode: a.authMode,
			connectionStatus: a.connectionStatus,
			lastSyncedAt: a.lastSyncedAt?.toISOString() ?? null
		})),
		activeAccount: {
			id: activeAccount.id,
			puuid: activeAccount.puuid,
			gameName: activeAccount.gameName,
			tagLine: activeAccount.tagLine,
			region: activeAccount.region,
			shard: activeAccount.shard,
			authMode: activeAccount.authMode,
			connectionStatus: activeAccount.connectionStatus,
			lastSyncedAt: activeAccount.lastSyncedAt?.toISOString() ?? null
		},
		profile: profileView,
		currencyIcons: assets.currencyIcons,
		store: storeView,
		inventory: inventoryView,
		tracker: trackerView
	};
}
