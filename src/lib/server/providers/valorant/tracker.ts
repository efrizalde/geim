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
	resolvedNamesByPuuid?: ReadonlyMap<string, { gameName: string; tagLine: string }>
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
	const rrDelta =
		lastRankedUpdate?.matchId &&
		lastRankedUpdate.matchId.toLowerCase() === info.matchId.toLowerCase()
			? lastRankedUpdate.rrDelta
			: null;

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
