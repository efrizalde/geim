import type { SeasonMeta, ValorantAssetIndex } from './assets';

export interface StoredActHistoryEntry {
	seasonId: string;
	tier: number;
	peakTier: number;
	rr: number;
	wins: number;
	games: number;
}

export interface StoredCareerProfile {
	accountLevel: number | null;
	accountXp: number | null;
	playerCardId: string | null;
	playerTitleId: string | null;
	latestSeasonId: string | null;
	currentTier: number;
	currentRr: number;
	lastRrDelta: number | null;
	lastRankedMatchId: string | null;
	actWins: number;
	actGames: number;
	peakTier: number;
	peakSeasonId: string | null;
	actHistory?: StoredActHistoryEntry[];
}

export interface ScoreboardPlayerEntry {
	puuid: string;
	gameName: string;
	tagLine: string;
	teamId: string;
	characterId: string;
	competitiveTier: number;
	kills: number;
	deaths: number;
	assists: number;
	score: number;
	acs: number;
	adr: number;
	hsPercent: number;
	firstBloods: number;
}

export interface StoredMatchRecord {
	matchId: string;
	mapUrl: string;
	queueId: string;
	seasonId: string;
	startedAt: string;
	durationSeconds: number;
	outcome: 'win' | 'loss' | 'draw';
	roundsWon: number;
	roundsLost: number;
	roundsPlayed: number;
	characterId: string;
	competitiveTier: number;
	rrDelta: number | null;
	isMatchMvp: boolean;
	isTeamMvp: boolean;
	kills: number;
	deaths: number;
	assists: number;
	score: number;
	damageDealt: number;
	damageReceived: number;
	headshots: number;
	bodyshots: number;
	legshots: number;
	kastRounds: number;
	firstBloods: number;
	flawlessRounds: number;
	aces: number;
	scoreboard: ScoreboardPlayerEntry[];
}

interface RawKillEvent {
	roundTime?: number;
	killer?: string;
	victim?: string;
	assistants?: string[];
}

interface RawDamageEvent {
	receiver?: string;
	damage?: number;
	headshots?: number;
	bodyshots?: number;
	legshots?: number;
}

interface RawRoundPlayerStat {
	subject: string;
	kills?: RawKillEvent[];
	damage?: RawDamageEvent[];
}

interface RawRoundResult {
	roundNum: number;
	winningTeam?: string;
	roundCeremony?: string;
	firstBloodPlayer?: string;
	playerStats?: RawRoundPlayerStat[];
}

interface RawMatchPlayer {
	subject: string;
	gameName?: string;
	tagLine?: string;
	teamId?: string;
	characterId?: string;
	playerCard?: string;
	playerTitle?: string;
	accountLevel?: number;
	competitiveTier?: number;
	stats?: {
		score?: number;
		roundsPlayed?: number;
		kills?: number;
		deaths?: number;
		assists?: number;
		playtimeMillis?: number;
	} | null;
}

interface RawMatchPayload {
	matchInfo?: {
		matchId?: string;
		mapId?: string;
		queueID?: string;
		seasonId?: string;
		gameStartMillis?: number;
		gameLengthMillis?: number;
	};
	players?: RawMatchPlayer[];
	teams?: Array<{
		teamId: string;
		won?: boolean;
		roundsPlayed?: number;
		roundsWon?: number;
	}>;
	roundResults?: RawRoundResult[];
}

export function extractCareerProfile(params: {
	rawXp: unknown;
	rawMmr: unknown;
	latestMatchRaw: unknown | null;
	ownerPuuid: string;
	seasonsById: Map<string, SeasonMeta>;
}): StoredCareerProfile {
	const { rawXp, rawMmr, latestMatchRaw, ownerPuuid, seasonsById } = params;

	const xpObj = rawXp as { Progress?: { Level?: number; XP?: number } } | null;
	let accountLevel = typeof xpObj?.Progress?.Level === 'number' ? xpObj.Progress.Level : null;
	const accountXp = typeof xpObj?.Progress?.XP === 'number' ? xpObj.Progress.XP : null;

	let playerCardId: string | null = null;
	let playerTitleId: string | null = null;

	const latestMatch = latestMatchRaw as RawMatchPayload | null;
	const meInLatest = latestMatch?.players?.find(
		(p) => p.subject.toLowerCase() === ownerPuuid.toLowerCase()
	);
	if (meInLatest) {
		playerCardId = meInLatest.playerCard ?? null;
		playerTitleId = meInLatest.playerTitle ?? null;
		if (accountLevel === null && typeof meInLatest.accountLevel === 'number') {
			accountLevel = meInLatest.accountLevel;
		}
	}

	const mmrObj = rawMmr as {
		LatestCompetitiveUpdate?: {
			MatchID?: string;
			SeasonID?: string;
			TierAfterUpdate?: number;
			RankedRatingAfterUpdate?: number;
			RankedRatingEarned?: number;
		};
		QueueSkills?: {
			competitive?: {
				SeasonalInfoBySeasonID?: Record<
					string,
					{
						SeasonID?: string;
						CompetitiveTier?: number;
						RankedRating?: number;
						NumberOfWinsWithPlacements?: number;
						NumberOfWins?: number;
						NumberOfGames?: number;
						WinsByTier?: Record<string, number> | null;
					}
				>;
			};
		};
	} | null;

	const latestUpdate = mmrObj?.LatestCompetitiveUpdate;
	const seasonsMap = mmrObj?.QueueSkills?.competitive?.SeasonalInfoBySeasonID ?? {};

	// Find active or latest competitive season
	let latestSeasonId = latestUpdate?.SeasonID ?? null;
	if (!latestSeasonId || !seasonsMap[latestSeasonId]) {
		let latestStartMs = -1;
		for (const sid of Object.keys(seasonsMap)) {
			const meta = seasonsById.get(sid.toLowerCase());
			const ms = meta ? Date.parse(meta.startTime) : 0;
			if (ms >= latestStartMs) {
				latestStartMs = ms;
				latestSeasonId = sid;
			}
		}
	}

	const curSeasonEntry = latestSeasonId ? seasonsMap[latestSeasonId] : undefined;
	const currentTier = curSeasonEntry?.CompetitiveTier ?? latestUpdate?.TierAfterUpdate ?? 0;
	const currentRr = curSeasonEntry?.RankedRating ?? latestUpdate?.RankedRatingAfterUpdate ?? 0;
	const actWins = curSeasonEntry?.NumberOfWinsWithPlacements ?? curSeasonEntry?.NumberOfWins ?? 0;
	const actGames = curSeasonEntry?.NumberOfGames ?? 0;

	let peakTier = 0;
	let peakSeasonId: string | null = null;
	let peakStartMs = -1;

	const actHistoryWithMs: Array<{ startMs: number; entry: StoredActHistoryEntry }> = [];

	for (const [sid, s] of Object.entries(seasonsMap)) {
		const winTiers = Object.entries(s.WinsByTier ?? {})
			.filter(([, count]) => count > 0)
			.map(([tierStr]) => Number(tierStr))
			.filter((n) => Number.isFinite(n));
		const maxTierInSeason = Math.max(s.CompetitiveTier ?? 0, ...winTiers);
		const games = s.NumberOfGames ?? 0;
		const wins = s.NumberOfWinsWithPlacements ?? s.NumberOfWins ?? 0;
		const meta = seasonsById.get(sid.toLowerCase());
		const startMs = meta ? Date.parse(meta.startTime) : 0;

		if (games > 0 || maxTierInSeason >= 3) {
			actHistoryWithMs.push({
				startMs,
				entry: {
					seasonId: sid.toLowerCase(),
					tier: s.CompetitiveTier ?? 0,
					peakTier: maxTierInSeason,
					rr: s.RankedRating ?? 0,
					wins,
					games
				}
			});
		}

		if (maxTierInSeason < 3) continue; // Ignore Unrated (0, 1, 2)

		if (maxTierInSeason > peakTier || (maxTierInSeason === peakTier && startMs >= peakStartMs)) {
			peakTier = maxTierInSeason;
			peakSeasonId = sid;
			peakStartMs = startMs;
		}
	}

	const actHistory = actHistoryWithMs.sort((a, b) => b.startMs - a.startMs).map((x) => x.entry);

	return {
		accountLevel,
		accountXp,
		playerCardId,
		playerTitleId,
		latestSeasonId,
		currentTier,
		currentRr,
		lastRrDelta:
			typeof latestUpdate?.RankedRatingEarned === 'number' ? latestUpdate.RankedRatingEarned : null,
		lastRankedMatchId: latestUpdate?.MatchID ?? null,
		actWins,
		actGames,
		peakTier,
		peakSeasonId,
		actHistory
	};
}

export function collectMissingNamePuuids(rawMatches: unknown[]): string[] {
	const missing = new Set<string>();
	for (const raw of rawMatches) {
		const players = (raw as RawMatchPayload | null)?.players ?? [];
		for (const p of players) {
			if (!p.subject) continue;
			if (!p.gameName?.trim() || !p.tagLine?.trim()) {
				missing.add(p.subject.toLowerCase());
			}
		}
	}
	return Array.from(missing);
}

export function parseDetailedMatch(
	raw: unknown,
	ownerPuuid: string,
	lastRankedUpdate?: { matchId: string | null; rrDelta: number | null },
	resolvedNamesByPuuid?: ReadonlyMap<string, { gameName: string; tagLine: string }>,
	rrDeltaByMatchId?: ReadonlyMap<string, number>
): StoredMatchRecord | null {
	const data = raw as RawMatchPayload;
	const info = data?.matchInfo;
	const players = data?.players;
	if (!info?.matchId || !players || players.length === 0) return null;

	const targetPuuid = ownerPuuid.toLowerCase();
	const me = players.find((p) => p.subject.toLowerCase() === targetPuuid);
	if (!me || !me.stats) return null;

	const perPlayerAgg = new Map<
		string,
		{
			damageDealt: number;
			damageReceived: number;
			headshots: number;
			bodyshots: number;
			legshots: number;
			firstBloods: number;
			kastRounds: number;
			aces: number;
		}
	>();

	for (const p of players) {
		perPlayerAgg.set(p.subject.toLowerCase(), {
			damageDealt: 0,
			damageReceived: 0,
			headshots: 0,
			bodyshots: 0,
			legshots: 0,
			firstBloods: 0,
			kastRounds: 0,
			aces: 0
		});
	}

	const rounds = data.roundResults ?? [];
	let myFlawlessRounds = 0;

	for (const round of rounds) {
		const pStats = round.playerStats ?? [];
		const allKillsInRound: Array<{
			killer: string;
			victim: string;
			roundTime: number;
			assistants: string[];
		}> = [];
		const roundKillsCount = new Map<string, number>();

		for (const ps of pStats) {
			const subj = ps.subject.toLowerCase();
			const agg = perPlayerAgg.get(subj);

			for (const dmg of ps.damage ?? []) {
				const amount = dmg.damage ?? 0;
				if (agg) {
					agg.damageDealt += amount;
					agg.headshots += dmg.headshots ?? 0;
					agg.bodyshots += dmg.bodyshots ?? 0;
					agg.legshots += dmg.legshots ?? 0;
				}
				if (dmg.receiver) {
					const recvAgg = perPlayerAgg.get(dmg.receiver.toLowerCase());
					if (recvAgg) recvAgg.damageReceived += amount;
				}
			}

			const killsArr = ps.kills ?? [];
			if (killsArr.length > 0) {
				roundKillsCount.set(subj, (roundKillsCount.get(subj) ?? 0) + killsArr.length);
			}
			for (const k of killsArr) {
				if (k.victim) {
					allKillsInRound.push({
						killer: (k.killer ?? ps.subject).toLowerCase(),
						victim: k.victim.toLowerCase(),
						roundTime: k.roundTime ?? 0,
						assistants: (k.assistants ?? []).map((a) => a.toLowerCase())
					});
				}
			}
		}

		// First blood detection
		const fbSubject = round.firstBloodPlayer?.toLowerCase();
		if (fbSubject && perPlayerAgg.has(fbSubject)) {
			perPlayerAgg.get(fbSubject)!.firstBloods += 1;
		} else if (allKillsInRound.length > 0) {
			const earliest = [...allKillsInRound].sort((a, b) => a.roundTime - b.roundTime)[0];
			const fbFallback = perPlayerAgg.get(earliest.killer);
			if (fbFallback) fbFallback.firstBloods += 1;
		}

		// KAST & Aces per player in round
		for (const p of players) {
			const subj = p.subject.toLowerCase();
			const agg = perPlayerAgg.get(subj);
			if (!agg) continue;

			const killsThisRound = roundKillsCount.get(subj) ?? 0;
			if (killsThisRound >= 5) {
				agg.aces += 1;
			}

			const gotKill = killsThisRound > 0;
			const gotAssist = allKillsInRound.some((k) => k.assistants.includes(subj));
			const deathEvent = allKillsInRound.find((k) => k.victim === subj);
			const survived = !deathEvent;
			const traded = Boolean(
				deathEvent &&
				allKillsInRound.some(
					(k) =>
						k.victim === deathEvent.killer &&
						k.roundTime >= deathEvent.roundTime &&
						k.roundTime - deathEvent.roundTime <= 5000
				)
			);

			if (gotKill || gotAssist || survived || traded) {
				agg.kastRounds += 1;
			}
		}

		if (
			me.teamId &&
			round.winningTeam === me.teamId &&
			round.roundCeremony === 'CeremonyFlawless'
		) {
			myFlawlessRounds += 1;
		}
	}

	const teams = data.teams ?? [];
	const myTeamObj = teams.find((t) => t.teamId === me.teamId);
	const enemyTeamObj = teams.find((t) => t.teamId !== me.teamId);

	const roundsPlayed = Math.max(1, me.stats.roundsPlayed ?? rounds.length ?? 1);
	const roundsWon = myTeamObj?.roundsWon ?? 0;
	const roundsLost = enemyTeamObj?.roundsWon ?? Math.max(0, roundsPlayed - roundsWon);

	let outcome: 'win' | 'loss' | 'draw' = 'draw';
	if (myTeamObj?.won === true) outcome = 'win';
	else if (enemyTeamObj?.won === true || (roundsLost > roundsWon && myTeamObj?.won === false))
		outcome = 'loss';
	else if (roundsWon > roundsLost) outcome = 'win';

	const scoreboard: ScoreboardPlayerEntry[] = players
		.map((p) => {
			const subj = p.subject.toLowerCase();
			const agg = perPlayerAgg.get(subj)!;
			const pRounds = Math.max(1, p.stats?.roundsPlayed ?? roundsPlayed);
			const pScore = p.stats?.score ?? 0;
			const totalShots = agg.headshots + agg.bodyshots + agg.legshots;
			const rawName = p.gameName?.trim() ?? '';
			const rawTag = p.tagLine?.trim() ?? '';
			const resolved = resolvedNamesByPuuid?.get(subj);
			const gameName = rawName || resolved?.gameName?.trim() || '';
			const tagLine = rawName
				? rawTag || resolved?.tagLine?.trim() || ''
				: resolved?.tagLine?.trim() || '';
			return {
				puuid: p.subject,
				gameName,
				tagLine,
				teamId: p.teamId ?? 'Neutral',
				characterId: (p.characterId ?? '').toLowerCase(),
				competitiveTier: p.competitiveTier ?? 0,
				kills: p.stats?.kills ?? 0,
				deaths: p.stats?.deaths ?? 0,
				assists: p.stats?.assists ?? 0,
				score: pScore,
				acs: Math.round(pScore / pRounds),
				adr: Math.round((agg.damageDealt / pRounds) * 10) / 10,
				hsPercent: totalShots > 0 ? Math.round((agg.headshots / totalShots) * 1000) / 10 : 0,
				firstBloods: agg.firstBloods
			};
		})
		.sort((a, b) => b.acs - a.acs);

	const topOverallScore = Math.max(0, ...players.map((p) => p.stats?.score ?? 0));
	const teammates = players.filter((p) => p.teamId === me.teamId);
	const topTeamScore = Math.max(0, ...teammates.map((p) => p.stats?.score ?? 0));
	const myScore = me.stats.score ?? 0;

	const myAgg = perPlayerAgg.get(targetPuuid)!;
	const matchIdLower = info.matchId.toLowerCase();
	const rrDelta =
		rrDeltaByMatchId?.get(matchIdLower) ??
		(lastRankedUpdate?.matchId && lastRankedUpdate.matchId.toLowerCase() === matchIdLower
			? lastRankedUpdate.rrDelta
			: null);

	return {
		matchId: info.matchId,
		mapUrl: info.mapId ?? '',
		queueId: (info.queueID || 'standard').toLowerCase(),
		seasonId: (info.seasonId ?? '').toLowerCase(),
		startedAt: new Date(info.gameStartMillis ?? Date.now()).toISOString(),
		durationSeconds: Math.round((info.gameLengthMillis ?? 0) / 1000),
		outcome,
		roundsWon,
		roundsLost,
		roundsPlayed,
		characterId: (me.characterId ?? '').toLowerCase(),
		competitiveTier: me.competitiveTier ?? 0,
		rrDelta,
		isMatchMvp: myScore > 0 && myScore >= topOverallScore,
		isTeamMvp: myScore > 0 && myScore >= topTeamScore && myScore < topOverallScore,
		kills: me.stats.kills ?? 0,
		deaths: me.stats.deaths ?? 0,
		assists: me.stats.assists ?? 0,
		score: myScore,
		damageDealt: myAgg.damageDealt,
		damageReceived: myAgg.damageReceived,
		headshots: myAgg.headshots,
		bodyshots: myAgg.bodyshots,
		legshots: myAgg.legshots,
		kastRounds: myAgg.kastRounds,
		firstBloods: myAgg.firstBloods,
		flawlessRounds: myFlawlessRounds,
		aces: myAgg.aces,
		scoreboard
	};
}

/**
 * Deduplicate and merge stored match records across snapshots/pages, backfilling `rrDelta`
 * when competitive updates supply it and sorting newest-first by `startedAt`.
 * Preserves records with a full 10-player `scoreboard` over summary-only records.
 */
export function mergeStoredMatches(
	existing: StoredMatchRecord[],
	incoming: StoredMatchRecord[],
	rrDeltaByMatchId?: ReadonlyMap<string, number>
): StoredMatchRecord[] {
	const byId = new Map<string, StoredMatchRecord>();

	const upsert = (m: StoredMatchRecord) => {
		if (!m?.matchId) return;
		const key = m.matchId.toLowerCase();
		const prev = byId.get(key);
		const rrDelta = m.rrDelta ?? rrDeltaByMatchId?.get(key) ?? prev?.rrDelta ?? null;
		const competitiveTier = m.competitiveTier || prev?.competitiveTier || 0;

		if (!prev) {
			byId.set(key, { ...m, rrDelta, competitiveTier });
			return;
		}

		const base =
			prev.scoreboard.length > 0 && m.scoreboard.length === 0
				? prev
				: {
						...prev,
						...m,
						durationSeconds: m.durationSeconds || prev.durationSeconds,
						scoreboard: m.scoreboard.length > 0 ? m.scoreboard : prev.scoreboard
					};
		byId.set(key, { ...base, rrDelta, competitiveTier });
	};

	for (const m of existing) upsert(m);
	for (const m of incoming) upsert(m);

	return Array.from(byId.values()).sort(
		(a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0)
	);
}

export function normalizeHenrikQueueId(rawQueueOrMode: string | null | undefined): string {
	const norm = (rawQueueOrMode ?? '').trim().toLowerCase();
	if (!norm || norm === 'standard' || norm === 'unrated') return 'unrated';
	if (norm === 'competitive') return 'competitive';
	if (norm === 'deathmatch') return 'deathmatch';
	if (norm === 'swiftplay') return 'swiftplay';
	if (norm === 'team deathmatch' || norm === 'hurm') return 'hurm';
	if (norm === 'custom game' || norm === 'custom') return 'custom';
	if (norm === 'spike rush' || norm === 'spikerush') return 'spikerush';
	if (norm === 'escalation' || norm === 'ggteam') return 'escalation';
	if (norm === 'replication' || norm === 'onefa') return 'replication';
	return norm.replace(/\s+/g, '_');
}

interface HenrikV4MatchPayload {
	metadata?: {
		match_id?: string;
		map?: { id?: string; name?: string };
		game_length_in_ms?: number;
		started_at?: string;
		queue?: { id?: string; name?: string };
		season?: { id?: string; short?: string };
	};
	players?: Array<{
		puuid: string;
		name?: string;
		tag?: string;
		team_id?: string;
		account_level?: number;
		agent?: { id?: string; name?: string };
		tier?: { id?: number; name?: string };
		customization?: { card?: string; title?: string };
		stats?: {
			score?: number;
			kills?: number;
			deaths?: number;
			assists?: number;
			headshots?: number;
			bodyshots?: number;
			legshots?: number;
			damage?: { dealt?: number; received?: number };
		} | null;
	}>;
	teams?: Array<{
		team_id: string;
		placement?: number | null;
		won?: boolean;
		rounds?: { won?: number; lost?: number };
	}>;
	rounds?: Array<{
		id: number;
		ceremony?: string;
		winning_team?: string;
		first_blood?: { puuid?: string } | null;
	}>;
	kills?: Array<{
		round?: number;
		time_in_round_in_ms?: number;
		killer?: { puuid?: string };
		victim?: { puuid?: string };
		assistants?: Array<{ puuid?: string }>;
	}>;
}

export function parseHenrikV4Match(
	raw: unknown,
	ownerPuuid: string,
	rrDeltaByMatchId?: ReadonlyMap<string, number>
): StoredMatchRecord | null {
	const data = raw as HenrikV4MatchPayload;
	const meta = data?.metadata;
	const players = data?.players;
	if (!meta?.match_id || !players || players.length === 0) return null;

	const targetPuuid = ownerPuuid.toLowerCase();
	const me = players.find((p) => p.puuid?.toLowerCase() === targetPuuid);
	if (!me || !me.stats) return null;

	const perPlayerAgg = new Map<string, { firstBloods: number; kastRounds: number; aces: number }>();
	for (const p of players) {
		if (p.puuid) {
			perPlayerAgg.set(p.puuid.toLowerCase(), { firstBloods: 0, kastRounds: 0, aces: 0 });
		}
	}

	const killsByRound = new Map<
		number,
		Array<{ killer: string; victim: string; roundTime: number; assistants: string[] }>
	>();
	for (const k of data.kills ?? []) {
		const rNum = typeof k.round === 'number' ? k.round : -1;
		const killer = k.killer?.puuid?.toLowerCase();
		const victim = k.victim?.puuid?.toLowerCase();
		if (rNum < 0 || !killer || !victim) continue;
		const arr = killsByRound.get(rNum) ?? [];
		arr.push({
			killer,
			victim,
			roundTime: k.time_in_round_in_ms ?? 0,
			assistants: (k.assistants ?? [])
				.map((a) => a.puuid?.toLowerCase() ?? '')
				.filter((id) => id.length > 0)
		});
		killsByRound.set(rNum, arr);
	}

	const rounds = data.rounds ?? [];
	let myFlawlessRounds = 0;

	for (const round of rounds) {
		const allKillsInRound = killsByRound.get(round.id) ?? [];
		const roundKillsCount = new Map<string, number>();
		for (const k of allKillsInRound) {
			roundKillsCount.set(k.killer, (roundKillsCount.get(k.killer) ?? 0) + 1);
		}

		const fbSubject = round.first_blood?.puuid?.toLowerCase();
		if (fbSubject && perPlayerAgg.has(fbSubject)) {
			perPlayerAgg.get(fbSubject)!.firstBloods += 1;
		} else if (allKillsInRound.length > 0) {
			const earliest = [...allKillsInRound].sort((a, b) => a.roundTime - b.roundTime)[0];
			const fbFallback = perPlayerAgg.get(earliest.killer);
			if (fbFallback) fbFallback.firstBloods += 1;
		}

		for (const p of players) {
			const subj = p.puuid?.toLowerCase();
			if (!subj) continue;
			const agg = perPlayerAgg.get(subj);
			if (!agg) continue;

			const killsThisRound = roundKillsCount.get(subj) ?? 0;
			if (killsThisRound >= 5) agg.aces += 1;

			const gotKill = killsThisRound > 0;
			const gotAssist = allKillsInRound.some((k) => k.assistants.includes(subj));
			const deathEvent = allKillsInRound.find((k) => k.victim === subj);
			const survived = !deathEvent;
			const traded = Boolean(
				deathEvent &&
				allKillsInRound.some(
					(k) =>
						k.victim === deathEvent.killer &&
						k.roundTime >= deathEvent.roundTime &&
						k.roundTime - deathEvent.roundTime <= 5000
				)
			);
			if (gotKill || gotAssist || survived || traded) {
				agg.kastRounds += 1;
			}
		}

		if (
			me.team_id &&
			round.winning_team?.toLowerCase() === me.team_id.toLowerCase() &&
			round.ceremony === 'CeremonyFlawless'
		) {
			myFlawlessRounds += 1;
		}
	}

	const queueId = normalizeHenrikQueueId(meta.queue?.id ?? meta.queue?.name);
	const teams = data.teams ?? [];
	const myTeamIdLower = (me.team_id ?? '').toLowerCase();
	const myTeamObj = teams.find((t) => t.team_id.toLowerCase() === myTeamIdLower);
	const enemyTeamObj = teams.find((t) => t.team_id.toLowerCase() !== myTeamIdLower);

	const roundsWon = myTeamObj?.rounds?.won ?? 0;
	const roundsLost = myTeamObj?.rounds?.lost ?? enemyTeamObj?.rounds?.won ?? 0;
	const roundsPlayed = Math.max(1, roundsWon + roundsLost || rounds.length || 1);

	let outcome: 'win' | 'loss' | 'draw' = 'draw';
	if (myTeamObj?.won === true) outcome = 'win';
	else if (queueId === 'deathmatch')
		outcome = myTeamObj?.placement === 1 || (me.stats.kills ?? 0) >= 40 ? 'win' : 'loss';
	else if (enemyTeamObj?.won === true || roundsLost > roundsWon || myTeamObj?.won === false)
		outcome = 'loss';
	else if (roundsWon > roundsLost) outcome = 'win';

	const scoreboard: ScoreboardPlayerEntry[] = players
		.map((p) => {
			const subj = p.puuid.toLowerCase();
			const agg = perPlayerAgg.get(subj) ?? { firstBloods: 0, kastRounds: 0, aces: 0 };
			const pScore = p.stats?.score ?? 0;
			const hs = p.stats?.headshots ?? 0;
			const bs = p.stats?.bodyshots ?? 0;
			const ls = p.stats?.legshots ?? 0;
			const totalShots = hs + bs + ls;
			const dmgDealt = p.stats?.damage?.dealt ?? 0;

			return {
				puuid: p.puuid,
				gameName: p.name?.trim() ?? '',
				tagLine: p.tag?.trim() ?? '',
				teamId: p.team_id ?? 'Neutral',
				characterId: (p.agent?.id ?? '').toLowerCase(),
				competitiveTier: p.tier?.id ?? 0,
				kills: p.stats?.kills ?? 0,
				deaths: p.stats?.deaths ?? 0,
				assists: p.stats?.assists ?? 0,
				score: pScore,
				acs: Math.round(pScore / roundsPlayed),
				adr: Math.round((dmgDealt / roundsPlayed) * 10) / 10,
				hsPercent: totalShots > 0 ? Math.round((hs / totalShots) * 1000) / 10 : 0,
				firstBloods: agg.firstBloods
			};
		})
		.sort((a, b) => b.acs - a.acs);

	const topOverallScore = Math.max(0, ...players.map((p) => p.stats?.score ?? 0));
	const teammates = players.filter((p) => (p.team_id ?? '').toLowerCase() === myTeamIdLower);
	const topTeamScore = Math.max(0, ...teammates.map((p) => p.stats?.score ?? 0));
	const myScore = me.stats.score ?? 0;
	const myAgg = perPlayerAgg.get(targetPuuid) ?? { firstBloods: 0, kastRounds: 0, aces: 0 };
	const matchIdLower = meta.match_id.toLowerCase();

	return {
		matchId: meta.match_id,
		mapUrl: (meta.map?.id ?? '').toLowerCase(),
		queueId,
		seasonId: (meta.season?.id ?? '').toLowerCase(),
		startedAt: meta.started_at ? new Date(meta.started_at).toISOString() : new Date().toISOString(),
		durationSeconds: Math.round((meta.game_length_in_ms ?? 0) / 1000),
		outcome,
		roundsWon,
		roundsLost,
		roundsPlayed,
		characterId: (me.agent?.id ?? '').toLowerCase(),
		competitiveTier: me.tier?.id ?? 0,
		rrDelta: rrDeltaByMatchId?.get(matchIdLower) ?? null,
		isMatchMvp: myScore > 0 && myScore >= topOverallScore,
		isTeamMvp: myScore > 0 && myScore >= topTeamScore && myScore < topOverallScore,
		kills: me.stats.kills ?? 0,
		deaths: me.stats.deaths ?? 0,
		assists: me.stats.assists ?? 0,
		score: myScore,
		damageDealt: me.stats.damage?.dealt ?? 0,
		damageReceived: me.stats.damage?.received ?? 0,
		headshots: me.stats.headshots ?? 0,
		bodyshots: me.stats.bodyshots ?? 0,
		legshots: me.stats.legshots ?? 0,
		kastRounds: rounds.length > 0 ? myAgg.kastRounds : Math.round(roundsPlayed * 0.72),
		firstBloods: myAgg.firstBloods,
		flawlessRounds: myFlawlessRounds,
		aces: myAgg.aces,
		scoreboard
	};
}

interface HenrikStoredMatchPayload {
	meta?: {
		id?: string;
		map?: { id?: string; name?: string };
		mode?: string;
		started_at?: string;
		season?: { id?: string; short?: string };
	};
	stats?: {
		puuid?: string;
		team?: string;
		character?: { id?: string; name?: string };
		tier?: number;
		score?: number;
		kills?: number;
		deaths?: number;
		assists?: number;
		shots?: { head?: number; body?: number; leg?: number };
		damage?: { made?: number; received?: number };
	};
	teams?: {
		red?: number;
		blue?: number;
	};
}

export function parseHenrikStoredMatch(
	raw: unknown,
	rrDeltaByMatchId?: ReadonlyMap<string, number>
): StoredMatchRecord | null {
	const item = raw as HenrikStoredMatchPayload;
	const meta = item?.meta;
	const stats = item?.stats;
	if (!meta?.id || !stats) return null;

	const queueId = normalizeHenrikQueueId(meta.mode);
	const teamLower = (stats.team ?? 'red').toLowerCase();
	const redRounds = item.teams?.red ?? 0;
	const blueRounds = item.teams?.blue ?? 0;
	const roundsWon = teamLower === 'blue' ? blueRounds : redRounds;
	const roundsLost = teamLower === 'blue' ? redRounds : blueRounds;
	const roundsPlayed = Math.max(1, redRounds + blueRounds || 1);

	let outcome: 'win' | 'loss' | 'draw' = 'draw';
	if (queueId === 'deathmatch') {
		outcome = (stats.kills ?? 0) >= 40 ? 'win' : 'loss';
	} else if (roundsWon > roundsLost) {
		outcome = 'win';
	} else if (roundsLost > roundsWon) {
		outcome = 'loss';
	}

	const matchIdLower = meta.id.toLowerCase();

	return {
		matchId: meta.id,
		mapUrl: (meta.map?.id ?? '').toLowerCase(),
		queueId,
		seasonId: (meta.season?.id ?? '').toLowerCase(),
		startedAt: meta.started_at ? new Date(meta.started_at).toISOString() : new Date().toISOString(),
		durationSeconds: 0,
		outcome,
		roundsWon,
		roundsLost,
		roundsPlayed,
		characterId: (stats.character?.id ?? '').toLowerCase(),
		competitiveTier: stats.tier ?? 0,
		rrDelta: rrDeltaByMatchId?.get(matchIdLower) ?? null,
		isMatchMvp: false,
		isTeamMvp: false,
		kills: stats.kills ?? 0,
		deaths: stats.deaths ?? 0,
		assists: stats.assists ?? 0,
		score: stats.score ?? 0,
		damageDealt: stats.damage?.made ?? 0,
		damageReceived: stats.damage?.received ?? 0,
		headshots: stats.shots?.head ?? 0,
		bodyshots: stats.shots?.body ?? 0,
		legshots: stats.shots?.leg ?? 0,
		kastRounds: Math.min(roundsPlayed, Math.round(roundsPlayed * 0.72)),
		firstBloods: 0,
		flawlessRounds: 0,
		aces: 0,
		scoreboard: []
	};
}

export function extractHenrikCareerProfile(params: {
	rawAccount: unknown | null;
	rawMmrV3: unknown | null;
	latestRankedMatchId: string | null;
	seasonsById: Map<string, SeasonMeta>;
	fallbackProfile?: StoredCareerProfile | null;
}): StoredCareerProfile | null {
	const { rawAccount, rawMmrV3, latestRankedMatchId, seasonsById, fallbackProfile } = params;
	const acc = rawAccount as {
		account_level?: number;
		card?: { id?: string };
		title?: { id?: string };
	} | null;
	const mmr = rawMmrV3 as {
		current?: { tier?: { id?: number }; rr?: number; last_change?: number };
		peak?: { tier?: { id?: number }; season?: { id?: string } };
		seasonal?: Array<{
			season?: { id?: string };
			wins?: number;
			games?: number;
			end_tier?: { id?: number };
			end_rr?: number;
			act_wins?: Array<{ id?: number }>;
		}>;
	} | null;

	if (!acc && !mmr && !fallbackProfile) return null;

	const actHistoryWithMs: Array<{ startMs: number; entry: StoredActHistoryEntry }> = [];
	let peakTier = mmr?.peak?.tier?.id ?? fallbackProfile?.peakTier ?? 0;
	let peakSeasonId = mmr?.peak?.season?.id?.toLowerCase() ?? fallbackProfile?.peakSeasonId ?? null;
	let peakStartMs = peakSeasonId
		? Date.parse(seasonsById.get(peakSeasonId)?.startTime ?? '') || 0
		: -1;

	for (const s of mmr?.seasonal ?? []) {
		const sid = s.season?.id?.toLowerCase();
		if (!sid) continue;
		const endTier = s.end_tier?.id ?? 0;
		const winTiers = (s.act_wins ?? []).map((w) => w.id ?? 0).filter((n) => n >= 3);
		const maxTier = Math.max(endTier, ...winTiers);
		const games = s.games ?? 0;
		const wins = s.wins ?? 0;
		const meta = seasonsById.get(sid);
		const startMs = meta ? Date.parse(meta.startTime) : 0;

		if (games > 0 || maxTier >= 3) {
			actHistoryWithMs.push({
				startMs,
				entry: {
					seasonId: sid,
					tier: endTier,
					peakTier: maxTier,
					rr: s.end_rr ?? 0,
					wins,
					games
				}
			});
		}

		if (maxTier >= 3 && (maxTier > peakTier || (maxTier === peakTier && startMs >= peakStartMs))) {
			peakTier = maxTier;
			peakSeasonId = sid;
			peakStartMs = startMs;
		}
	}

	const actHistory =
		actHistoryWithMs.length > 0
			? actHistoryWithMs.sort((a, b) => b.startMs - a.startMs).map((x) => x.entry)
			: (fallbackProfile?.actHistory ?? []);

	const latestAct = actHistory[0] ?? null;

	return {
		accountLevel:
			typeof acc?.account_level === 'number'
				? acc.account_level
				: (fallbackProfile?.accountLevel ?? null),
		accountXp: fallbackProfile?.accountXp ?? null,
		playerCardId: acc?.card?.id ?? fallbackProfile?.playerCardId ?? null,
		playerTitleId: acc?.title?.id ?? fallbackProfile?.playerTitleId ?? null,
		latestSeasonId: latestAct?.seasonId ?? fallbackProfile?.latestSeasonId ?? null,
		currentTier: mmr?.current?.tier?.id ?? fallbackProfile?.currentTier ?? 0,
		currentRr: mmr?.current?.rr ?? fallbackProfile?.currentRr ?? 0,
		lastRrDelta:
			typeof mmr?.current?.last_change === 'number'
				? mmr.current.last_change
				: (fallbackProfile?.lastRrDelta ?? null),
		lastRankedMatchId: latestRankedMatchId ?? fallbackProfile?.lastRankedMatchId ?? null,
		actWins: latestAct?.wins ?? fallbackProfile?.actWins ?? 0,
		actGames: latestAct?.games ?? fallbackProfile?.actGames ?? 0,
		peakTier,
		peakSeasonId,
		actHistory
	};
}

export interface HydratedMatchItem extends Omit<StoredMatchRecord, 'scoreboard'> {
	mapName: string;
	mapIcon: string | null;
	mapSplash: string | null;
	agentName: string;
	agentIcon: string | null;
	rankName: string;
	rankIcon: string | null;
	acs: number;
	adr: number;
	kd: number;
	hsPercent: number;
	kastPercent: number;
	ddDeltaPerRound: number;
	scoreboard: Array<
		ScoreboardPlayerEntry & {
			agentName: string;
			agentIcon: string | null;
			rankIcon: string | null;
			rankName: string;
		}
	>;
}

export function hydrateMatchesWithAssets(
	matches: StoredMatchRecord[],
	assets: ValorantAssetIndex,
	ownerIdentity?: { puuid: string; gameName: string; tagLine: string }
): HydratedMatchItem[] {
	const ownerPuuidLower = ownerIdentity?.puuid.toLowerCase();
	const ownerValidName =
		ownerIdentity?.gameName.trim() && ownerIdentity.gameName.trim() !== 'Unknown'
			? ownerIdentity.gameName.trim()
			: '';
	const ownerValidTag = ownerIdentity?.tagLine.trim() ?? '';

	return matches.map((m) => {
		const mapMeta = assets.mapsByUrl.get(m.mapUrl.toLowerCase());
		const agentMeta = assets.agentsById.get(m.characterId.toLowerCase());
		const rankMeta = assets.competitiveTiersById.get(m.competitiveTier);

		const rounds = Math.max(1, m.roundsPlayed);
		const totalShots = m.headshots + m.bodyshots + m.legshots;

		return {
			...m,
			mapName: mapMeta?.displayName ?? 'Unknown Map',
			mapIcon: mapMeta?.listViewIcon ?? null,
			mapSplash: mapMeta?.splash ?? null,
			agentName: agentMeta?.displayName ?? 'Agent',
			agentIcon: agentMeta?.displayIcon ?? null,
			rankName: rankMeta?.tierName ?? 'Unrated',
			rankIcon: rankMeta?.smallIcon ?? null,
			acs: Math.round((m.score / rounds) * 10) / 10,
			adr: Math.round((m.damageDealt / rounds) * 10) / 10,
			kd: Math.round((m.kills / Math.max(1, m.deaths)) * 100) / 100,
			hsPercent: totalShots > 0 ? Math.round((m.headshots / totalShots) * 1000) / 10 : 0,
			kastPercent: Math.round((m.kastRounds / rounds) * 1000) / 10,
			ddDeltaPerRound: Math.round((m.damageDealt - m.damageReceived) / rounds),
			scoreboard: m.scoreboard.map((sp) => {
				const spAgent = assets.agentsById.get(sp.characterId.toLowerCase());
				const spRank = assets.competitiveTiersById.get(sp.competitiveTier);
				const trimmedName = sp.gameName?.trim() ?? '';
				const trimmedTag = sp.tagLine?.trim() ?? '';
				const isLegacyPlaceholder = trimmedName === 'Player' && trimmedTag === '0000';
				const hasOwnName = Boolean(trimmedName && !isLegacyPlaceholder);
				const isOwner = Boolean(ownerPuuidLower && sp.puuid.toLowerCase() === ownerPuuidLower);

				const gameName = hasOwnName ? trimmedName : isOwner ? ownerValidName : '';
				const tagLine = hasOwnName ? trimmedTag : isOwner && ownerValidName ? ownerValidTag : '';

				return {
					...sp,
					gameName,
					tagLine,
					agentName: spAgent?.displayName ?? 'Agent',
					agentIcon: spAgent?.displayIcon ?? null,
					rankIcon: spRank?.smallIcon ?? null,
					rankName: spRank?.tierName ?? 'Unrated'
				};
			})
		};
	});
}
