<script lang="ts">
	import {
		Calendar,
		Check,
		ChevronDown,
		Clock,
		Crosshair,
		Flame,
		Info,
		Shield,
		Sparkles,
		Swords,
		Trophy,
		Zap
	} from '@lucide/svelte';
	import { cubicOut } from 'svelte/easing';
	import { fade, fly, slide } from 'svelte/transition';
	import type {
		HydratedActOption,
		HydratedProfileBanner
	} from '#lib/server/providers/valorant/service.js';
	import type {
		HydratedMatchItem,
		TrackerScopeStats
	} from '#lib/server/providers/valorant/tracker.js';

	type QueueFilter = 'competitive' | 'unrated' | 'deathmatch' | 'swiftplay' | 'all';

	interface Props {
		ownerPuuid: string;
		ownerAccount?: {
			id?: string;
			gameName: string;
			tagLine: string;
			connectionStatus?: string;
		} | null;
		profile: HydratedProfileBanner | null;
		tracker: {
			latestSeasonId: string | null;
			latestSeasonLabel: string;
			hasFullActHistory: boolean;
			acts: HydratedActOption[];
			matches: HydratedMatchItem[];
			totalMatches?: number;
			queueTotals?: Record<string, number>;
			seasonCounts?: Record<string, Record<string, number>>;
			scopeStats?: Record<string, Record<string, TrackerScopeStats>>;
		} | null;
	}

	let { ownerPuuid, ownerAccount = null, profile, tracker }: Props = $props();

	// Older matches beyond the bounded first page are fetched on demand and appended here.
	let extraMatches = $state<HydratedMatchItem[]>([]);
	let loadingOlder = $state(false);
	let scoreboards = $state<Record<string, HydratedMatchItem['scoreboard']>>({});
	let scoreboardLoading = $state<string | null>(null);

	// Expanded scoreboards hydrate on demand and are grafted onto their match rows here.
	const allMatches = $derived(
		[...(tracker?.matches ?? []), ...extraMatches].map((m) =>
			scoreboards[m.matchId] ? { ...m, scoreboard: scoreboards[m.matchId] } : m
		)
	);
	const storedTotal = $derived(tracker?.totalMatches ?? allMatches.length);
	const queueTotals = $derived(tracker?.queueTotals ?? {});
	const seasonCounts = $derived(tracker?.seasonCounts ?? {});

	const queueBucket = (q: QueueFilter) => (q === 'all' ? 'all' : q === 'unrated' ? 'unrated' : q);

	async function loadOlderMatches() {
		if (!ownerAccount?.id || loadingOlder || allMatches.length >= storedTotal) return;
		loadingOlder = true;
		try {
			const res = await fetch(
				`/api/valorant/matches?account=${encodeURIComponent(ownerAccount.id)}&offset=${allMatches.length}&limit=40`
			);
			if (res.ok) {
				const data = (await res.json()) as { matches: HydratedMatchItem[]; total: number };
				const seen = new Set(allMatches.map((m) => m.matchId.toLowerCase()));
				extraMatches = [
					...extraMatches,
					...data.matches.filter((m) => !seen.has(m.matchId.toLowerCase()))
				];
			}
		} finally {
			loadingOlder = false;
		}
	}

	async function toggleMatch(match: HydratedMatchItem) {
		const matchId = match.matchId;
		if (expandedMatchId === matchId) {
			expandedMatchId = null;
			return;
		}
		expandedMatchId = matchId;
		if (!match.hasScoreboard || scoreboards[matchId] || match.scoreboard.length > 0) return;
		if (!ownerAccount?.id || scoreboardLoading === matchId) return;
		scoreboardLoading = matchId;
		try {
			const res = await fetch(
				`/api/valorant/matches?account=${encodeURIComponent(ownerAccount.id)}&match=${encodeURIComponent(matchId)}`
			);
			if (res.ok) {
				const data = (await res.json()) as { scoreboard: HydratedMatchItem['scoreboard'] };
				scoreboards[matchId] = data.scoreboard;
			}
		} finally {
			scoreboardLoading = null;
		}
	}

	const hasCompMatches = $derived(
		(queueTotals.competitive ?? 0) > 0 || allMatches.some((m) => m.queueId === 'competitive')
	);

	let userSelectedQueue = $state<QueueFilter | null>(null);
	// 'all' = All Recent Sample, otherwise a specific seasonId
	let userSelectedSeasonId = $state<string | null>(null);
	let userHistoryScope = $state<'act' | 'all_acts' | 'all_queues' | null>(null);
	let pageSize = $state<5 | 10 | 20>(5);
	let currentPage = $state(1);
	let actMenuOpen = $state(false);
	let expandedMatchId = $state<string | null>(null);

	const queueFilter = $derived<QueueFilter>(
		userSelectedQueue ?? (hasCompMatches ? 'competitive' : 'all')
	);

	const selectedSeasonId = $derived<string>(
		userSelectedSeasonId ?? tracker?.latestSeasonId ?? 'all'
	);

	const selectedActMeta = $derived<HydratedActOption | null>(
		selectedSeasonId === 'all'
			? null
			: (tracker?.acts.find((a) => a.seasonId === selectedSeasonId) ?? null)
	);

	const actLabelBySeasonId = $derived<Record<string, string>>(
		Object.fromEntries((tracker?.acts ?? []).map((a) => [a.seasonId.toLowerCase(), a.label]))
	);

	const queueTabs: Array<{ id: QueueFilter; label: string; shortLabel: string }> = [
		{ id: 'competitive', label: 'Competitive', shortLabel: 'Competitive' },
		{ id: 'unrated', label: 'Unrated', shortLabel: 'Unrated' },
		{ id: 'deathmatch', label: 'Deathmatch', shortLabel: 'Deathmatch' },
		{ id: 'swiftplay', label: 'Swiftplay', shortLabel: 'Swiftplay' },
		{ id: 'all', label: 'All Queues', shortLabel: 'All Queues' }
	];

	function matchesQueue(m: HydratedMatchItem, q: QueueFilter): boolean {
		if (q === 'all') return true;
		if (q === 'unrated') return m.queueId === 'unrated' || m.queueId === 'standard';
		return m.queueId === q;
	}

	const queueMatches = $derived.by(() => allMatches.filter((m) => matchesQueue(m, queueFilter)));

	const filteredMatches = $derived.by(() => {
		if (selectedSeasonId === 'all') return queueMatches;
		return queueMatches.filter((m) => m.seasonId === selectedSeasonId);
	});

	// Default match feed scope: show all indexed acts when on the default season and older acts have additional matches
	const effectiveHistoryScope = $derived<'act' | 'all_acts' | 'all_queues'>(
		userHistoryScope ??
			(selectedSeasonId === 'all'
				? 'all_acts'
				: userSelectedSeasonId === null &&
					  filteredMatches.length < 5 &&
					  queueMatches.length > filteredMatches.length
					? 'all_acts'
					: 'act')
	);

	const historyMatches = $derived.by(() => {
		if (effectiveHistoryScope === 'all_queues') return allMatches;
		if (effectiveHistoryScope === 'all_acts' || selectedSeasonId === 'all') return queueMatches;
		return filteredMatches;
	});

	const totalPages = $derived(Math.max(1, Math.ceil(historyMatches.length / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));
	const pageStartIndex = $derived((safePage - 1) * pageSize);
	const paginatedMatches = $derived(
		historyMatches.slice(pageStartIndex, pageStartIndex + pageSize)
	);
	const pageNumbers = $derived(Array.from({ length: totalPages }, (_, i) => i + 1));

	// Server-derived totals over the full stored set; loaded rows only cover the newest page.
	const queueTotal = $derived(queueTotals[queueBucket(queueFilter)] ?? queueMatches.length);
	const allTotal = $derived(queueTotals.all ?? allMatches.length);
	const filteredTotal = $derived(
		selectedSeasonId === 'all'
			? queueTotal
			: (seasonCounts[queueBucket(queueFilter)]?.[selectedSeasonId] ?? filteredMatches.length)
	);
	const actQueueMatchCountFor = (seasonId: string) =>
		seasonCounts[queueBucket(queueFilter)]?.[seasonId] ?? 0;
	const historyTotal = $derived(
		effectiveHistoryScope === 'all_queues'
			? allTotal
			: effectiveHistoryScope === 'all_acts' || selectedSeasonId === 'all'
				? queueTotal
				: filteredTotal
	);

	// Displayed Rating dynamically reflects the selected Act when viewing a specific Act
	const displayedRating = $derived.by(() => {
		if (selectedActMeta && selectedActMeta.tier >= 3) {
			const isLatest = selectedActMeta.seasonId === tracker?.latestSeasonId;
			return {
				name: selectedActMeta.rankName,
				iconUrl: selectedActMeta.rankIcon,
				colorHex: selectedActMeta.rankColorHex,
				rr: selectedActMeta.rr,
				lastRrDelta: isLatest ? (profile?.currentRank.lastRrDelta ?? null) : null,
				subLabel: selectedActMeta.label,
				showRrBar: isLatest || selectedActMeta.rr > 0
			};
		}
		return {
			name: profile?.currentRank.name ?? 'Unrated',
			iconUrl: profile?.currentRank.iconUrl ?? null,
			colorHex: profile?.currentRank.colorHex ?? '#94a3b8',
			rr: profile?.currentRank.rr ?? 0,
			lastRrDelta: profile?.currentRank.lastRrDelta ?? null,
			subLabel: profile?.currentRank.actLabel ?? 'Current Act',
			showRrBar: (profile?.currentRank.tier ?? 0) >= 3
		};
	});

	// Aggregated performance metrics across the filtered match sample (+ MMR Act fallback)
	const overview = $derived.by(() => {
		const list = filteredMatches;
		let wins = 0;
		let losses = 0;
		let draws = 0;
		let kills = 0;
		let deaths = 0;
		let assists = 0;
		let score = 0;
		let rounds = 0;
		let damageDealt = 0;
		let damageReceived = 0;
		let headshots = 0;
		let bodyshots = 0;
		let legshots = 0;
		let kastRounds = 0;
		let firstBloods = 0;
		let flawlessRounds = 0;
		let aces = 0;
		let durationSeconds = 0;

		for (const m of list) {
			if (m.outcome === 'win') wins += 1;
			else if (m.outcome === 'loss') losses += 1;
			else draws += 1;

			kills += m.kills;
			deaths += m.deaths;
			assists += m.assists;
			score += m.score;
			rounds += Math.max(1, m.roundsPlayed);
			damageDealt += m.damageDealt;
			damageReceived += m.damageReceived;
			headshots += m.headshots;
			bodyshots += m.bodyshots;
			legshots += m.legshots;
			kastRounds += m.kastRounds;
			firstBloods += m.firstBloods;
			flawlessRounds += m.flawlessRounds;
			aces += m.aces;
			durationSeconds += m.durationSeconds;
		}

		const fullStats = tracker?.scopeStats?.[queueBucket(queueFilter)]?.[selectedSeasonId];
		if (fullStats) {
			({
				wins,
				losses,
				draws,
				kills,
				deaths,
				assists,
				score,
				rounds,
				damageDealt,
				damageReceived,
				headshots,
				bodyshots,
				legshots,
				kastRounds,
				firstBloods,
				flawlessRounds,
				aces,
				durationSeconds
			} = fullStats);
		}
		const sampleCount = fullStats?.count ?? list.length;
		const hasSample = sampleCount > 0;
		const useActMmrRecord =
			queueFilter === 'competitive' &&
			selectedActMeta !== null &&
			selectedActMeta.games > sampleCount;

		const displayWins = useActMmrRecord ? selectedActMeta!.wins : wins;
		const displayLosses = useActMmrRecord ? selectedActMeta!.losses : losses;
		const displayGames = useActMmrRecord ? selectedActMeta!.games : sampleCount;

		const safeRounds = Math.max(1, rounds);
		const safeDeaths = Math.max(1, deaths);
		const totalHits = headshots + bodyshots + legshots;
		const decidedMatches = displayWins + displayLosses;

		const adr = hasSample ? damageDealt / safeRounds : 0;
		const kd = hasSample ? kills / safeDeaths : 0;
		const kad = hasSample ? (kills + assists) / safeDeaths : 0;
		const hsPercent = totalHits > 0 ? (headshots / totalHits) * 100 : 0;
		const winPercent = decidedMatches > 0 ? (displayWins / decidedMatches) * 100 : 0;
		const kastPercent = hasSample ? (kastRounds / safeRounds) * 100 : 0;
		const ddDelta = hasSample ? Math.round((damageDealt - damageReceived) / safeRounds) : 0;
		const acs = hasSample ? score / safeRounds : 0;
		const killsPerRound = hasSample ? kills / safeRounds : 0;
		const playtimeHours = durationSeconds / 3600;

		return {
			hasSample,
			useActMmrRecord,
			sampleCount,
			displayGames,
			wins: displayWins,
			losses: displayLosses,
			draws,
			kills,
			deaths,
			assists,
			damageDealt,
			headshots,
			totalHits,
			adr,
			kd,
			kad,
			hsPercent,
			winPercent,
			kastPercent,
			ddDelta,
			acs,
			killsPerRound,
			firstBloods,
			flawlessRounds,
			aces,
			playtimeHours
		};
	});

	// Top played agents summary (falls back to all recent matches if current filter has 0 sample)
	const topAgents = $derived.by(() => {
		const sourceList = filteredMatches.length > 0 ? filteredMatches : (tracker?.matches ?? []);
		const byAgent: Record<
			string,
			{
				id: string;
				name: string;
				icon: string | null;
				matches: number;
				wins: number;
				kills: number;
				deaths: number;
				score: number;
				rounds: number;
			}
		> = {};

		for (const m of sourceList) {
			const key = m.characterId || m.agentName;
			const cur = byAgent[key] ?? {
				id: key,
				name: m.agentName,
				icon: m.agentIcon,
				matches: 0,
				wins: 0,
				kills: 0,
				deaths: 0,
				score: 0,
				rounds: 0
			};
			cur.matches += 1;
			if (m.outcome === 'win') cur.wins += 1;
			cur.kills += m.kills;
			cur.deaths += m.deaths;
			cur.score += m.score;
			cur.rounds += Math.max(1, m.roundsPlayed);
			byAgent[key] = cur;
		}

		return Object.values(byAgent)
			.sort((a, b) => b.matches - a.matches || b.score / b.rounds - a.score / a.rounds)
			.slice(0, 4)
			.map((a) => ({
				...a,
				winPct: Math.round((a.wins / Math.max(1, a.matches)) * 100),
				kd: (a.kills / Math.max(1, a.deaths)).toFixed(2),
				acs: Math.round(a.score / Math.max(1, a.rounds))
			}));
	});

	// Hero SVG Donut Ring geometry (r = 32 => circumference ≈ 201.06)
	const RING_R = 32;
	const RING_CIRC = 2 * Math.PI * RING_R;
	const winArcLength = $derived.by(() => {
		const total = overview.wins + overview.losses;
		if (total <= 0) return 0;
		return (overview.wins / total) * RING_CIRC;
	});

	const overviewBackdropSplash = $derived(
		filteredMatches[0]?.mapSplash ?? profile?.wideBannerUrl ?? null
	);

	function clampGauge(pct: number): number {
		return Math.max(6, Math.min(100, Math.round(pct)));
	}

	function formatDuration(sec: number): string {
		if (!sec || sec <= 0) return '—';
		const mins = Math.floor(sec / 60);
		const rem = sec % 60;
		return `${mins}m ${String(rem).padStart(2, '0')}s`;
	}

	function formatMatchDate(iso: string): string {
		const d = new Date(iso);
		return d.toLocaleDateString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatQueueBadge(q: string): string {
		if (q === 'standard') return 'Unrated';
		if (q === 'hurm') return 'TDM';
		if (q === 'custom') return 'Custom';
		if (q === 'spikerush') return 'Spike Rush';
		return q.charAt(0).toUpperCase() + q.slice(1);
	}

	/**
	 * Resolve full `username#tag` when available; if Riot omitted/anonymized the player's
	 * Riot ID (e.g. Streamer / Hide Name privacy mode), fall back cleanly to Agent Name.
	 */
	function resolveScoreboardPlayerLabel(
		player: HydratedMatchItem['scoreboard'][number],
		isMe: boolean
	): {
		primary: string;
		tag: string | null;
		isAgentFallback: boolean;
	} {
		const rawName = player.gameName?.trim() ?? '';
		const rawTag = player.tagLine?.trim() ?? '';
		const isPlaceholder = rawName === 'Player' && rawTag === '0000';

		if (rawName && !isPlaceholder) {
			return {
				primary: rawName,
				tag: rawTag || null,
				isAgentFallback: false
			};
		}

		const ownerName = ownerAccount?.gameName?.trim() ?? '';
		const ownerTag = ownerAccount?.tagLine?.trim() ?? '';
		if (isMe && ownerName && ownerName !== 'Unknown') {
			return {
				primary: ownerName,
				tag: ownerTag || null,
				isAgentFallback: false
			};
		}

		return {
			primary: player.agentName?.trim() || 'Unknown Agent',
			tag: null,
			isAgentFallback: true
		};
	}

	const activeQueueLabel = $derived(
		queueTabs.find((t) => t.id === queueFilter)?.label.toUpperCase() ?? 'OVERVIEW'
	);

	const activeSeasonHeading = $derived(
		selectedSeasonId === 'all'
			? 'ALL RECENT'
			: (selectedActMeta?.label ?? tracker?.latestSeasonLabel ?? 'CURRENT ACT')
	);
</script>

<svelte:window
	onclick={(e) => {
		const target = e.target as HTMLElement | null;
		if (actMenuOpen && target && !target.closest('[data-act-dropdown]')) {
			actMenuOpen = false;
		}
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && actMenuOpen) {
			actMenuOpen = false;
		}
	}}
/>

<div class="flex flex-col gap-4">
	<!-- ==================== COMPACT FILTER & ACT DROPDOWN TOOLBAR ==================== -->
	<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
		<!-- Queue Segmented Pills (Swipeable single-line frosted well on mobile) -->
		<div
			role="tablist"
			aria-label="Queue filter"
			class="neu-well no-scrollbar flex w-full items-center gap-1 overflow-x-auto rounded-xl p-1 sm:w-auto"
		>
			{#each queueTabs as tab (tab.id)}
				<button
					type="button"
					role="tab"
					aria-selected={queueFilter === tab.id}
					onclick={() => {
						userSelectedQueue = tab.id;
						currentPage = 1;
					}}
					data-active={queueFilter === tab.id}
					class="seg-tab shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-bold tracking-wide whitespace-nowrap"
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<!-- Frosted Glass Act Selector Dropdown -->
		<div class="relative w-full sm:w-auto" data-act-dropdown>
			<button
				type="button"
				onclick={() => (actMenuOpen = !actMenuOpen)}
				aria-label="Competitive act"
				aria-expanded={actMenuOpen}
				aria-haspopup="listbox"
				class="neu-btn flex min-h-11 w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl px-3.5 py-2 text-xs font-bold text-white sm:w-auto"
			>
				<span class="flex min-w-0 items-center gap-2">
					{#if selectedActMeta?.rankIcon}
						<img
							src={selectedActMeta.rankIcon}
							alt={selectedActMeta.rankName}
							class="h-4 w-4 shrink-0 object-contain"
						/>
					{:else}
						<Calendar class="h-3.5 w-3.5 shrink-0 text-neu-accent" />
					{/if}
					<span class="truncate font-mono">{activeSeasonHeading}</span>
				</span>
				<ChevronDown
					class="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform {actMenuOpen
						? 'rotate-180'
						: ''}"
				/>
			</button>

			{#if actMenuOpen}
				<div
					role="listbox"
					aria-label="Competitive act options"
					class="glass-neu absolute right-0 left-0 z-40 mt-2 overflow-hidden rounded-2xl p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.88)] sm:left-auto sm:w-76"
				>
					<button
						type="button"
						role="option"
						aria-selected={selectedSeasonId === 'all'}
						onclick={() => {
							userSelectedSeasonId = 'all';
							userHistoryScope = 'all_acts';
							currentPage = 1;
							actMenuOpen = false;
						}}
						class="flex w-full cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition hover:bg-white/[0.06] {selectedSeasonId ===
						'all'
							? 'bg-neu-accent/15 text-white'
							: 'text-slate-300'}"
					>
						<div>
							<p class="font-bold">All Recent Matches</p>
							<p class="font-mono text-[10px] text-slate-400">
								Full indexed PD window ({queueTotal}
								{activeQueueLabel.toLowerCase()} / {allTotal} total)
							</p>
						</div>
						{#if selectedSeasonId === 'all'}
							<Check class="h-4 w-4 text-neu-accent" />
						{/if}
					</button>

					{#if (tracker?.acts.length ?? 0) > 0}
						<div class="my-1 border-t border-white/8"></div>
						<p
							class="px-3 py-1 font-mono text-[9px] font-bold tracking-widest text-slate-400 uppercase"
						>
							Competitive Acts
						</p>
						<div class="neu-dropdown-scroll max-h-64 overflow-y-auto pr-0.5">
							{#each tracker?.acts ?? [] as act (act.seasonId)}
								{@const isSelected = selectedSeasonId === act.seasonId}
								{@const actQueueMatchCount = actQueueMatchCountFor(act.seasonId) ?? 0}
								<button
									type="button"
									role="option"
									aria-selected={isSelected}
									onclick={() => {
										userSelectedSeasonId = act.seasonId;
										userHistoryScope = 'act';
										currentPage = 1;
										actMenuOpen = false;
									}}
									class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition hover:bg-white/[0.06] {isSelected
										? 'bg-neu-accent/15 text-white'
										: 'text-slate-300'}"
								>
									<div class="flex min-w-0 items-center gap-2.5">
										{#if act.rankIcon}
											<img
												src={act.rankIcon}
												alt={act.rankName}
												class="h-5 w-5 shrink-0 object-contain"
											/>
										{:else}
											<Shield class="h-4 w-4 shrink-0 text-slate-400" />
										{/if}
										<div class="min-w-0">
											<p class="truncate font-mono text-xs font-bold">{act.label}</p>
											<p class="truncate text-[10px] text-slate-400">
												{act.rankName}
												{#if act.games > 0}
													· {act.wins}W-{act.losses}L ({act.games}G)
												{/if}
											</p>
										</div>
									</div>

									<div class="flex shrink-0 items-center gap-2">
										{#if actQueueMatchCount > 0}
											<span
												class="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[9px] text-neu-cyan tabular-nums"
												title="{actQueueMatchCount} detailed matches in PD sample"
											>
												{actQueueMatchCount}M
											</span>
										{:else if act.matchSampleCount > 0}
											<span
												class="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9px] text-slate-400 tabular-nums"
												title="{act.matchSampleCount} matches in other queues"
											>
												{act.matchSampleCount}M
											</span>
										{/if}
										{#if isSelected}
											<Check class="h-3.5 w-3.5 text-neu-accent" />
										{/if}
									</div>
								</button>
							{/each}
						</div>
					{/if}

					{#if tracker && !tracker.hasFullActHistory}
						<div class="mt-1 rounded-xl bg-white/[0.03] px-3 py-2 text-[10px] text-slate-400">
							Sync with an active Riot session to index every historical Episode &amp; Act from MMR.
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- ==================== EQUAL-HEIGHT SYMMETRIC BENTO GRID ==================== -->
	<div class="grid gap-4 lg:grid-cols-12 lg:items-stretch">
		<!-- LEFT COLUMN (4 cols): Compact Rating/Peak + Stretched Top Agents -->
		<aside class="flex flex-col gap-4 lg:col-span-4">
			<!-- Card 1: Rating & Peak Side-by-Side with Rank Gradient Atmosphere -->
			<div class="glass-neu relative flex flex-col gap-3 overflow-hidden rounded-2xl p-4">
				<div
					class="pointer-events-none absolute inset-0"
					style="background: radial-gradient(circle at 18% 0%, {displayedRating.colorHex}24 0%, transparent 58%), radial-gradient(circle at 88% 0%, {profile
						?.peakRank?.colorHex ?? '#fbbf24'}1f 0%, transparent 58%);"
				></div>

				<div class="relative z-10 flex items-center justify-between gap-2">
					<h3 class="font-display text-[11px] font-bold tracking-widest text-slate-300 uppercase">
						Competitive Rating
					</h3>
					<span class="truncate font-mono text-[10px] text-slate-400">
						{displayedRating.subLabel}
					</span>
				</div>

				<!-- 2-Column Equal Sub-Tiles: Current/Act Rating | Peak Rating -->
				<div class="relative z-10 grid grid-cols-2 gap-2.5">
					<div
						class="neu-well-sm flex items-center gap-2.5 rounded-xl p-2.5 sm:p-3"
						style="background: radial-gradient(circle at 15% 50%, {displayedRating.colorHex}20 0%, rgba(8, 11, 19, 0.82) 78%);"
					>
						{#if displayedRating.iconUrl}
							<img
								src={displayedRating.iconUrl}
								alt={displayedRating.name}
								class="h-9 w-9 shrink-0 object-contain drop-shadow-[0_6px_12px_rgba(0,0,0,0.75)] sm:h-10 sm:w-10"
							/>
						{:else}
							<Shield class="h-8 w-8 shrink-0 text-slate-500" />
						{/if}
						<div class="min-w-0">
							<p class="text-[10px] font-medium text-slate-400">Rating</p>
							<p
								class="truncate bg-clip-text font-display text-sm font-extrabold text-transparent sm:text-base"
								style="background-image: linear-gradient(90deg, #ffffff 15%, {displayedRating.colorHex} 135%);"
							>
								{displayedRating.name}
							</p>
						</div>
					</div>

					<div
						class="neu-well-sm flex items-center gap-2.5 rounded-xl p-2.5 sm:p-3"
						style="background: radial-gradient(circle at 15% 50%, {profile?.peakRank?.colorHex ??
							'#fbbf24'}20 0%, rgba(8, 11, 19, 0.82) 78%);"
					>
						{#if profile?.peakRank?.iconUrl}
							<img
								src={profile.peakRank.iconUrl}
								alt={profile.peakRank.name}
								class="h-9 w-9 shrink-0 object-contain drop-shadow-[0_6px_12px_rgba(0,0,0,0.75)] sm:h-10 sm:w-10"
							/>
						{:else}
							<Trophy class="h-7 w-7 shrink-0 text-amber-400/70" />
						{/if}
						<div class="min-w-0">
							<p class="truncate text-[10px] font-medium text-slate-400">
								Peak{profile?.peakRank
									? ` · ${profile.peakRank.actLabel.replace('ACT ', 'A')}`
									: ''}
							</p>
							<p
								class="truncate bg-clip-text font-display text-sm font-extrabold text-transparent sm:text-base"
								style="background-image: linear-gradient(90deg, #ffffff 15%, {profile?.peakRank
									?.colorHex ?? '#fbbf24'} 135%);"
							>
								{profile?.peakRank?.name ?? '—'}
							</p>
						</div>
					</div>
				</div>

				<!-- Compact RR Progress Strip -->
				{#if displayedRating.showRrBar}
					<div class="neu-well-sm relative z-10 flex flex-col gap-1.5 rounded-xl px-3 py-2">
						<div class="flex items-center justify-between font-mono text-[11px] tabular-nums">
							<span class="font-semibold text-slate-300">{displayedRating.rr} / 100 RR</span>
							{#if displayedRating.lastRrDelta !== null}
								<span
									class="font-bold {displayedRating.lastRrDelta >= 0
										? 'text-emerald-400'
										: 'text-rose-400'}"
								>
									{displayedRating.lastRrDelta >= 0
										? `+${displayedRating.lastRrDelta}`
										: displayedRating.lastRrDelta} RR last
								</span>
							{/if}
						</div>
						<div class="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
							<div
								class="h-full rounded-full transition-all duration-500"
								style="width: {Math.min(
									100,
									Math.max(4, displayedRating.rr)
								)}%; background: linear-gradient(90deg, {displayedRating.colorHex}, #ff4655);"
							></div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Card 2: Top Agents (flex-1 stretches flush with Right Overview Card bottom!) -->
			<div class="glass-neu flex flex-1 flex-col rounded-2xl p-4">
				<div
					class="mb-2.5 grid grid-cols-[minmax(0,1fr)_38px_40px_38px] items-center gap-2 px-1 text-[10px] font-bold tracking-wider text-slate-400 uppercase sm:grid-cols-[minmax(0,1fr)_42px_44px_42px]"
				>
					<span class="font-display text-[11px] text-slate-300">Top Agents</span>
					<span class="text-right font-mono">WR</span>
					<span class="text-right font-mono">K/D</span>
					<span class="text-right font-mono">ACS</span>
				</div>

				{#if topAgents.length === 0}
					<div
						class="neu-well-sm flex flex-1 items-center justify-center rounded-xl p-4 text-xs text-slate-500"
					>
						No agent sample indexed yet.
					</div>
				{:else}
					<div class="flex flex-1 flex-col gap-2">
						{#each topAgents as agent (agent.id)}
							<div
								class="neu-well-sm grid grid-cols-[minmax(0,1fr)_38px_40px_38px] items-center gap-2 rounded-xl px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_42px_44px_42px]"
							>
								<div class="flex min-w-0 items-center gap-2.5">
									{#if agent.icon}
										<img
											src={agent.icon}
											alt={agent.name}
											class="h-8 w-8 shrink-0 rounded-lg border border-white/10 bg-slate-900 object-cover"
										/>
									{/if}
									<div class="min-w-0">
										<p class="truncate text-xs font-bold text-white">{agent.name}</p>
										<p class="font-mono text-[10px] text-slate-400 tabular-nums">
											{agent.matches}
											{agent.matches === 1 ? 'Match' : 'Matches'}
										</p>
									</div>
								</div>

								<span
									class="text-right font-mono text-[11px] font-semibold tabular-nums {agent.winPct >=
									50
										? 'text-emerald-400'
										: 'text-slate-300'}"
								>
									{agent.winPct}%
								</span>
								<span class="text-right font-mono text-[11px] font-bold text-white tabular-nums">
									{agent.kd}
								</span>
								<span class="text-right font-mono text-[11px] text-neu-cyan tabular-nums">
									{agent.acs}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</aside>

		<!-- RIGHT COLUMN (8 cols): Unified Competitive Overview Telemetry Matrix -->
		<div
			class="glass-neu relative flex flex-col justify-between gap-4 overflow-hidden rounded-2xl p-4 sm:p-6 lg:col-span-8"
		>
			<!-- ==================== ATMOSPHERIC BACKGROUND ASSET & MULTI-STOP GRADIENT ==================== -->
			<div class="pointer-events-none absolute inset-0 overflow-hidden">
				{#if overviewBackdropSplash}
					<img
						src={overviewBackdropSplash}
						alt=""
						class="h-full w-full scale-105 object-cover object-center opacity-16 blur-[1px]"
					/>
				{/if}

				<!-- Multi-stop frosted dark vignette + Rank & Winrate radial color washes -->
				<div
					class="absolute inset-0 bg-gradient-to-r from-[#090d17]/95 via-[#0b101d]/86 to-[#090d17]/88"
				></div>
				<div
					class="absolute inset-0 bg-gradient-to-b from-transparent via-[#090d16]/45 to-[#080b12]/96"
				></div>
				<div
					class="absolute inset-0"
					style="background: radial-gradient(circle at 12% 16%, {displayedRating.colorHex}2b 0%, transparent 46%), radial-gradient(circle at 58% 22%, {overview.winPercent >=
					50
						? 'rgba(16, 185, 129, 0.20)'
						: 'rgba(244, 63, 94, 0.16)'} 0%, transparent 48%), radial-gradient(circle at 88% 12%, rgba(34, 211, 238, 0.14) 0%, transparent 42%);"
				></div>

				{#if profile?.heroAgentPortraitUrl}
					<picture>
						<source media="(min-width: 1280px)" srcset={profile.heroAgentPortraitUrl} />
						<img
							alt=""
							class="absolute -top-6 -right-4 hidden h-64 w-64 object-contain opacity-18 drop-shadow-[0_12px_28px_rgba(0,0,0,0.85)] xl:block"
						/>
					</picture>
				{/if}

				<!-- Oversized Gradient Rank Watermark Typography -->
				{#if displayedRating.name}
					<div
						aria-hidden="true"
						class="pointer-events-none absolute top-3 right-5 hidden bg-clip-text font-display text-6xl font-black tracking-widest text-transparent uppercase select-none md:block xl:text-7xl"
						style="background-image: linear-gradient(180deg, rgba(255,255,255,0.11) 0%, {displayedRating.colorHex}26 58%, rgba(255,255,255,0.01) 100%);"
					>
						{displayedRating.name}
					</div>
				{/if}
			</div>

			<!-- Header Row: Title + Playtime/Matches -->
			<div
				class="relative z-10 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3"
			>
				<div class="flex flex-wrap items-baseline gap-2">
					<h2
						class="font-display text-xs font-bold tracking-wider text-white uppercase sm:text-base"
					>
						{activeSeasonHeading} · {activeQueueLabel}
					</h2>
					<span class="font-mono text-[11px] text-slate-400 tabular-nums sm:text-xs">
						{#if overview.useActMmrRecord && overview.hasSample}
							Official Act // {overview.displayGames} Games ({overview.sampleCount} Detailed)
						{:else if overview.hasSample}
							{overview.playtimeHours.toFixed(1)}h // {overview.sampleCount}
							{overview.sampleCount === 1 ? 'Match' : 'Matches'}
						{:else if overview.useActMmrRecord}
							Official Act // {overview.displayGames} Games
						{/if}
					</span>
				</div>

				<span
					class="rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-0.5 font-mono text-[10px] text-slate-300 tabular-nums backdrop-blur-md"
				>
					{overview.useActMmrRecord && overview.hasSample
						? `MMR Record + ${overview.sampleCount} PD`
						: overview.hasSample
							? `PD Sample (${overview.sampleCount})`
							: overview.useActMmrRecord
								? 'MMR Season Record'
								: '0 Matches'}
				</span>
			</div>

			{#if !overview.hasSample && !overview.useActMmrRecord}
				<div
					class="neu-well relative z-10 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl p-6 text-center"
				>
					<p class="text-xs text-slate-400">
						No {activeQueueLabel.toLowerCase()} matches found in
						<span class="font-mono text-white">{activeSeasonHeading}</span> within your recent PD match
						window.
					</p>
					<button
						type="button"
						onclick={() => {
							userSelectedSeasonId = 'all';
							userSelectedQueue = 'all';
						}}
						class="neu-btn cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white"
					>
						View All Recent Matches
					</button>
				</div>
			{:else}
				<!-- ==================== HERO RATING + LEVEL + BIG GLOWING WINRATE BANNER ==================== -->
				<div
					class="relative z-10 flex flex-col gap-3.5 rounded-2xl border border-white/[0.08] px-4 py-3.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-6 sm:px-5"
					style="background: linear-gradient(125deg, {displayedRating.colorHex}1c 0%, rgba(10, 15, 26, 0.78) 44%, {overview.winPercent >=
					50
						? 'rgba(16, 185, 129, 0.16)'
						: 'rgba(244, 63, 94, 0.15)'} 100%); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10);"
				>
					<!-- Left Group: Rank Emblem + Rating + Account Level -->
					<div class="flex items-center justify-between gap-4 sm:justify-start sm:gap-6">
						<div class="flex min-w-0 items-center gap-3">
							{#if displayedRating.iconUrl}
								<img
									src={displayedRating.iconUrl}
									alt={displayedRating.name}
									class="h-12 w-12 shrink-0 object-contain sm:h-16 sm:w-16"
									style="filter: drop-shadow(0 8px 18px rgba(0,0,0,0.75)) drop-shadow(0 0 14px {displayedRating.colorHex}55);"
								/>
							{/if}
							<div class="min-w-0">
								<p
									class="text-[10px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[11px]"
								>
									Rating
								</p>
								<p
									class="truncate bg-clip-text font-display text-xl font-extrabold tracking-tight text-transparent sm:text-3xl"
									style="background-image: linear-gradient(90deg, #ffffff 10%, {displayedRating.colorHex} 125%);"
								>
									{displayedRating.name}
								</p>
							</div>
						</div>

						{#if profile?.accountLevel !== null && profile?.accountLevel !== undefined}
							<div class="hidden h-10 w-px bg-white/10 sm:block"></div>
							<div class="text-right sm:text-left">
								<p
									class="text-[10px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[11px]"
								>
									Level
								</p>
								<p
									class="bg-gradient-to-b from-white via-slate-100 to-slate-400 bg-clip-text font-display text-xl font-extrabold text-transparent tabular-nums sm:text-3xl"
								>
									{profile.accountLevel}
								</p>
							</div>
						{/if}
					</div>

					<!-- Right Group: BIG Glowing SVG Win/Loss Donut Ring + Big Gradient Winrate Headline -->
					<div
						class="flex items-center gap-4 border-t border-white/[0.07] pt-3 sm:gap-5 sm:border-t-0 sm:pt-0"
					>
						<div
							class="relative flex h-17 w-17 shrink-0 items-center justify-center sm:h-21 sm:w-21"
						>
							<svg
								class="h-full w-full -rotate-90"
								viewBox="0 0 80 80"
								style="filter: drop-shadow(0 0 12px {overview.winPercent >= 50
									? 'rgba(16, 185, 129, 0.38)'
									: 'rgba(244, 63, 94, 0.32)'});"
							>
								<defs>
									<linearGradient id="geim-win-grad" x1="0%" y1="0%" x2="100%" y2="100%">
										<stop offset="0%" stop-color="#34d399" />
										<stop offset="55%" stop-color="#2dd4bf" />
										<stop offset="100%" stop-color="#22d3ee" />
									</linearGradient>
								</defs>

								<!-- Background / Loss Ring -->
								<circle
									cx="40"
									cy="40"
									r={RING_R}
									fill="rgba(7, 10, 18, 0.65)"
									stroke={overview.losses > 0
										? 'rgba(244, 63, 94, 0.62)'
										: 'rgba(255, 255, 255, 0.10)'}
									stroke-width="6.5"
								/>

								<!-- Foreground Gradient Win Arc -->
								{#if overview.wins > 0}
									<circle
										cx="40"
										cy="40"
										r={RING_R}
										fill="none"
										stroke="url(#geim-win-grad)"
										stroke-width="6.5"
										stroke-linecap="round"
										stroke-dasharray="{winArcLength} {RING_CIRC}"
									/>
								{/if}
							</svg>

							<!-- Crisp Stacked W / L Inside the Big Ring -->
							<div
								class="absolute flex flex-col items-center justify-center font-mono text-[11px] leading-tight font-extrabold tabular-nums sm:text-xs"
							>
								<span class="text-emerald-300">{overview.wins}W</span>
								<span class="text-rose-400">{overview.losses}L</span>
							</div>
						</div>

						<!-- Big Hero Gradient Winrate Percentage -->
						<div>
							<p
								class="font-mono text-[10px] font-bold tracking-widest uppercase {overview.winPercent >=
								50
									? 'text-emerald-300/90'
									: 'text-rose-300/90'}"
							>
								Win Rate
							</p>
							<p
								class="bg-clip-text font-display text-2xl leading-none font-black tracking-tight text-transparent tabular-nums sm:text-4xl {overview.winPercent >=
								50
									? 'bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-300 drop-shadow-[0_4px_18px_rgba(16,185,129,0.30)]'
									: 'bg-gradient-to-r from-amber-200 via-orange-300 to-rose-400 drop-shadow-[0_4px_18px_rgba(244,63,94,0.28)]'}"
							>
								{overview.winPercent.toFixed(1)}%
							</p>
							<p class="mt-1 font-mono text-[11px] font-semibold text-slate-300 tabular-nums">
								<span class="text-emerald-400">{overview.wins}W</span>
								<span class="text-slate-500"> · </span>
								<span class="text-rose-400">{overview.losses}L</span>
								{#if overview.draws > 0}
									<span class="text-slate-500"> · </span>
									<span class="text-amber-300">{overview.draws}D</span>
								{/if}
							</p>
						</div>
					</div>
				</div>

				<!-- 4 Symmetric Primary KPI Tiles with Vertical Accent Bars & Gradient Highlights -->
				<div class="relative z-10 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
					<!-- 1. Damage / Round -->
					<div
						class="neu-well relative flex items-stretch gap-2.5 overflow-hidden rounded-xl px-3 py-2.5 sm:gap-3 sm:px-3.5 sm:py-3"
						style="background: radial-gradient(circle at 100% 0%, rgba(255, 70, 85, 0.14) 0%, rgba(7, 10, 17, 0.84) 70%);"
					>
						<div
							class="flex w-1 shrink-0 flex-col justify-end overflow-hidden rounded-full bg-white/10"
						>
							<div
								class="w-full rounded-full bg-gradient-to-t from-rose-500 to-amber-300"
								style="height: {overview.hasSample ? clampGauge((overview.adr / 200) * 100) : 0}%"
							></div>
						</div>
						<div class="flex min-w-0 flex-1 flex-col justify-between gap-1">
							<div class="flex items-center justify-between gap-1">
								<span class="truncate text-[10px] font-semibold text-slate-400 sm:text-[11px]">
									Dmg/Round
								</span>
								<Crosshair class="h-3.5 w-3.5 shrink-0 text-neu-accent/85" />
							</div>
							<div>
								<p class="font-display text-xl font-extrabold text-white tabular-nums sm:text-2xl">
									{overview.hasSample ? overview.adr.toFixed(1) : '—'}
								</p>
								<p class="mt-0.5 truncate font-mono text-[10px] text-slate-400 tabular-nums">
									{overview.hasSample
										? `${overview.damageDealt.toLocaleString()} Dmg`
										: 'Recent sample'}
								</p>
							</div>
						</div>
					</div>

					<!-- 2. K/D Ratio -->
					<div
						class="neu-well relative flex items-stretch gap-2.5 overflow-hidden rounded-xl px-3 py-2.5 sm:gap-3 sm:px-3.5 sm:py-3"
						style="background: radial-gradient(circle at 100% 0%, rgba(251, 191, 36, 0.15) 0%, rgba(7, 10, 17, 0.84) 70%);"
					>
						<div
							class="flex w-1 shrink-0 flex-col justify-end overflow-hidden rounded-full bg-white/10"
						>
							<div
								class="w-full rounded-full bg-gradient-to-t from-amber-500 to-yellow-200"
								style="height: {overview.hasSample ? clampGauge((overview.kd / 1.8) * 100) : 0}%"
							></div>
						</div>
						<div class="flex min-w-0 flex-1 flex-col justify-between gap-1">
							<div class="flex items-center justify-between gap-1">
								<span class="truncate text-[10px] font-semibold text-slate-400 sm:text-[11px]">
									K/D Ratio
								</span>
								<Swords class="h-3.5 w-3.5 shrink-0 text-amber-300/85" />
							</div>
							<div>
								<p
									class="bg-gradient-to-r from-white via-amber-100 to-amber-300 bg-clip-text font-display text-xl font-extrabold text-transparent tabular-nums sm:text-2xl"
								>
									{overview.hasSample ? overview.kd.toFixed(2) : '—'}
								</p>
								<p class="mt-0.5 truncate font-mono text-[10px] text-amber-300/90 tabular-nums">
									{overview.hasSample
										? `${overview.kills}K / ${overview.deaths}D`
										: 'Recent sample'}
								</p>
							</div>
						</div>
					</div>

					<!-- 3. Headshot % -->
					<div
						class="neu-well relative flex items-stretch gap-2.5 overflow-hidden rounded-xl px-3 py-2.5 sm:gap-3 sm:px-3.5 sm:py-3"
						style="background: radial-gradient(circle at 100% 0%, rgba(34, 211, 238, 0.15) 0%, rgba(7, 10, 17, 0.84) 70%);"
					>
						<div
							class="flex w-1 shrink-0 flex-col justify-end overflow-hidden rounded-full bg-white/10"
						>
							<div
								class="w-full rounded-full bg-gradient-to-t from-cyan-500 to-sky-200"
								style="height: {overview.hasSample
									? clampGauge((overview.hsPercent / 38) * 100)
									: 0}%"
							></div>
						</div>
						<div class="flex min-w-0 flex-1 flex-col justify-between gap-1">
							<div class="flex items-center justify-between gap-1">
								<span class="truncate text-[10px] font-semibold text-slate-400 sm:text-[11px]">
									Headshot %
								</span>
								<Flame class="h-3.5 w-3.5 shrink-0 text-neu-cyan/85" />
							</div>
							<div>
								<p
									class="bg-gradient-to-r from-white via-cyan-100 to-cyan-300 bg-clip-text font-display text-xl font-extrabold text-transparent tabular-nums sm:text-2xl"
								>
									{overview.hasSample ? `${overview.hsPercent.toFixed(1)}%` : '—'}
								</p>
								<p class="mt-0.5 truncate font-mono text-[10px] text-slate-400 tabular-nums">
									{overview.hasSample
										? `${overview.headshots}/${overview.totalHits} Hits`
										: 'Recent sample'}
								</p>
							</div>
						</div>
					</div>

					<!-- 4. Win % -->
					<div
						class="neu-well relative flex items-stretch gap-2.5 overflow-hidden rounded-xl px-3 py-2.5 sm:gap-3 sm:px-3.5 sm:py-3"
						style="background: radial-gradient(circle at 100% 0%, {overview.winPercent >= 50
							? 'rgba(16, 185, 129, 0.22)'
							: 'rgba(244, 63, 94, 0.18)'} 0%, rgba(7, 10, 17, 0.84) 72%);"
					>
						<div
							class="flex w-1 shrink-0 flex-col justify-end overflow-hidden rounded-full bg-white/10"
						>
							<div
								class="w-full rounded-full {overview.winPercent >= 50
									? 'bg-gradient-to-t from-emerald-500 to-cyan-300'
									: 'bg-gradient-to-t from-rose-500 to-amber-300'}"
								style="height: {clampGauge(overview.winPercent)}%"
							></div>
						</div>
						<div class="flex min-w-0 flex-1 flex-col justify-between gap-1">
							<div class="flex items-center justify-between gap-1">
								<span class="truncate text-[10px] font-semibold text-slate-300 sm:text-[11px]">
									Win %
								</span>
								<Trophy class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
							</div>
							<div>
								<p
									class="bg-clip-text font-display text-xl font-extrabold text-transparent tabular-nums sm:text-2xl {overview.winPercent >=
									50
										? 'bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-300'
										: 'bg-gradient-to-r from-amber-200 via-orange-300 to-rose-400'}"
								>
									{overview.winPercent.toFixed(1)}%
								</p>
								<p class="mt-0.5 truncate font-mono text-[10px] text-emerald-400 tabular-nums">
									{overview.wins}W - {overview.losses}L{overview.draws > 0
										? ` - ${overview.draws}D`
										: ''}
								</p>
							</div>
						</div>
					</div>
				</div>

				<!-- 12-Metric Uniform Tactical Matrix (3 cols on mobile, 6 cols on desktop) -->
				<div class="relative z-10 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Wins
						</p>
						<p
							class="mt-0.5 font-display text-sm font-bold text-emerald-400 tabular-nums sm:text-base"
						>
							{overview.wins}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							KAST
						</p>
						<p class="mt-0.5 font-display text-sm font-bold text-white tabular-nums sm:text-base">
							{overview.hasSample ? `${overview.kastPercent.toFixed(1)}%` : '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							DDΔ/Rnd
						</p>
						<p
							class="mt-0.5 font-display text-sm font-bold tabular-nums sm:text-base {overview.hasSample &&
							overview.ddDelta > 0
								? 'text-emerald-400'
								: overview.hasSample && overview.ddDelta < 0
									? 'text-rose-400'
									: 'text-white'}"
						>
							{overview.hasSample
								? overview.ddDelta > 0
									? `+${overview.ddDelta}`
									: overview.ddDelta
								: '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Kills
						</p>
						<p class="mt-0.5 font-display text-sm font-bold text-white tabular-nums sm:text-base">
							{overview.hasSample ? overview.kills : '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Deaths
						</p>
						<p class="mt-0.5 font-display text-sm font-bold text-white tabular-nums sm:text-base">
							{overview.hasSample ? overview.deaths : '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Assists
						</p>
						<p class="mt-0.5 font-display text-sm font-bold text-white tabular-nums sm:text-base">
							{overview.hasSample ? overview.assists : '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							ACS
						</p>
						<p
							class="mt-0.5 font-display text-sm font-bold text-neu-cyan tabular-nums sm:text-base"
						>
							{overview.hasSample ? overview.acs.toFixed(1) : '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							KAD
						</p>
						<p class="mt-0.5 font-display text-sm font-bold text-white tabular-nums sm:text-base">
							{overview.hasSample ? overview.kad.toFixed(2) : '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Kills/Rnd
						</p>
						<p class="mt-0.5 font-display text-sm font-bold text-white tabular-nums sm:text-base">
							{overview.hasSample ? overview.killsPerRound.toFixed(2) : '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							1st Bloods
						</p>
						<p class="mt-0.5 font-display text-sm font-bold text-white tabular-nums sm:text-base">
							{overview.hasSample ? overview.firstBloods : '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Flawless
						</p>
						<p class="mt-0.5 font-display text-sm font-bold text-white tabular-nums sm:text-base">
							{overview.hasSample ? overview.flawlessRounds : '—'}
						</p>
					</div>

					<div class="neu-well-sm rounded-xl px-2.5 py-2 sm:px-3 sm:py-2.5">
						<p
							class="truncate text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Aces
						</p>
						<p
							class="mt-0.5 font-display text-sm font-bold text-amber-300 tabular-nums sm:text-base"
						>
							{overview.hasSample ? overview.aces : '—'}
						</p>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- ==================== REVAMPED MATCH HISTORY FEED WITH SCOPE & PAGINATION ==================== -->
	<section class="mt-2 flex flex-col gap-3" data-match-history>
		<div
			class="flex flex-col gap-2.5 px-0.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
		>
			<div class="flex flex-wrap items-center gap-2">
				<h3 class="font-display text-xs font-bold tracking-widest text-white uppercase sm:text-sm">
					Match History
				</h3>
				<span
					class="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 font-mono text-[10px] font-bold text-slate-300 tabular-nums"
				>
					{historyTotal}
				</span>

				{#if allTotal > 0}
					<div
						role="group"
						aria-label="Match history scope"
						class="neu-well-sm flex max-w-full flex-wrap items-center gap-1 rounded-xl p-0.5"
					>
						{#if selectedSeasonId !== 'all'}
							<button
								type="button"
								onclick={() => {
									userHistoryScope = 'act';
									currentPage = 1;
								}}
								data-active={effectiveHistoryScope === 'act'}
								class="seg-tab cursor-pointer rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold whitespace-nowrap"
							>
								{activeSeasonHeading} ({filteredTotal})
							</button>
						{/if}
						<button
							type="button"
							onclick={() => {
								userHistoryScope = 'all_acts';
								currentPage = 1;
							}}
							data-active={effectiveHistoryScope === 'all_acts'}
							class="seg-tab cursor-pointer rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold whitespace-nowrap"
						>
							All Acts · {queueTabs.find((t) => t.id === queueFilter)?.shortLabel ?? 'Queue'} ({queueTotal})
						</button>
						{#if queueFilter !== 'all' && allTotal > queueTotal}
							<button
								type="button"
								onclick={() => {
									userHistoryScope = 'all_queues';
									currentPage = 1;
								}}
								data-active={effectiveHistoryScope === 'all_queues'}
								class="seg-tab cursor-pointer rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold whitespace-nowrap"
							>
								All Queues ({allTotal})
							</button>
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex flex-wrap items-center justify-between gap-2 sm:justify-end">
				<span class="font-mono text-[10px] text-slate-400 sm:text-[11px]">
					Tap any match for 5v5 scoreboard
				</span>

				{#if ownerAccount?.id}
					<form method="POST" action="?/refreshAccount" class="inline-flex">
						<input type="hidden" name="accountId" value={ownerAccount.id} />
						<input type="hidden" name="deepHistory" value="1" />
						<button
							type="submit"
							class="neu-btn cursor-pointer rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold text-neu-cyan transition hover:text-white"
							title="Scan deeper Riot PD match-history & competitive-updates pages"
						>
							Fetch Deep History
						</button>
					</form>
				{/if}
			</div>
		</div>

		{#if selectedSeasonId !== 'all' && selectedActMeta && selectedActMeta.games > filteredTotal}
			<div
				class="glass-neu flex flex-col gap-2.5 rounded-xl border border-white/10 px-3.5 py-3 text-xs text-slate-300 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="flex items-start gap-2.5">
					<Info class="mt-0.5 h-4 w-4 shrink-0 text-neu-cyan" />
					<p class="leading-relaxed">
						{#if filteredTotal === 0}
							Riot's PD API only retains full match details &amp; scoreboards for recent matches.
							<strong class="font-mono text-white">{activeSeasonHeading}</strong>'s official record
							(<strong class="font-mono text-white"
								>{selectedActMeta.wins}W-{selectedActMeta.losses}L · {selectedActMeta.games} Games</strong
							>) comes from Riot's career MMR summary above.
						{:else}
							<strong class="font-mono text-white"
								>{filteredTotal} of {selectedActMeta.games}</strong
							>
							competitive games from
							<strong class="font-mono text-white">{activeSeasonHeading}</strong> are inside Riot's
							recent PD match-details retention window ({selectedActMeta.wins}W-{selectedActMeta.losses}L
							full Act record above).
						{/if}
					</p>
				</div>

				{#if effectiveHistoryScope === 'act' && queueTotal > filteredTotal}
					<button
						type="button"
						onclick={() => {
							userHistoryScope = 'all_acts';
							currentPage = 1;
						}}
						class="neu-btn shrink-0 cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[10px] font-bold text-white"
					>
						Show All Indexed Acts ({queueTotal})
					</button>
				{/if}
			</div>
		{/if}

		{#if historyMatches.length === 0}
			<div
				class="glass-neu flex flex-col items-center justify-center gap-3 rounded-2xl p-6 text-center"
			>
				<p class="text-xs text-slate-400">
					{historyTotal > 0 ? 'No loaded' : 'No indexed'}
					{activeQueueLabel.toLowerCase()} match details found for
					<span class="font-mono text-white">{activeSeasonHeading}</span>.
				</p>
				{#if allTotal > 0}
					<div class="flex flex-wrap items-center justify-center gap-2">
						{#if queueTotal > 0}
							<button
								type="button"
								onclick={() => {
									userHistoryScope = 'all_acts';
									currentPage = 1;
								}}
								class="neu-btn cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white"
							>
								View All {queueTabs.find((t) => t.id === queueFilter)?.shortLabel} Matches ({queueTotal})
							</button>
						{/if}
						<button
							type="button"
							onclick={() => {
								userHistoryScope = 'all_queues';
								currentPage = 1;
							}}
							class="neu-btn cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-semibold text-slate-200"
						>
							View All Indexed Matches ({allTotal})
						</button>
					</div>
				{/if}
			</div>
		{:else}
			{#key `${queueFilter}-${selectedSeasonId}-${effectiveHistoryScope}-${safePage}-${pageSize}`}
				<div class="flex flex-col gap-3">
					{#each paginatedMatches as match, idx (match.matchId)}
						{@const isExpanded = expandedMatchId === match.matchId}
						{@const isDeathmatch = match.queueId === 'deathmatch'}
						{@const outcomeGlowRgba =
							match.outcome === 'win'
								? 'rgba(16, 185, 129, 0.16)'
								: match.outcome === 'loss'
									? 'rgba(244, 63, 94, 0.16)'
									: 'rgba(251, 191, 36, 0.14)'}
						{@const outcomeAccentBar =
							match.outcome === 'win'
								? 'from-emerald-400 via-teal-400 to-emerald-500 shadow-[0_0_16px_rgba(16,185,129,0.55)]'
								: match.outcome === 'loss'
									? 'from-rose-500 via-red-500 to-rose-600 shadow-[0_0_16px_rgba(244,63,94,0.55)]'
									: 'from-amber-300 via-amber-400 to-orange-400 shadow-[0_0_14px_rgba(251,191,36,0.45)]'}
						{@const outcomeBadgeClass =
							match.outcome === 'win'
								? 'border-emerald-400/35 bg-emerald-400/14 text-emerald-300'
								: match.outcome === 'loss'
									? 'border-rose-400/35 bg-rose-400/14 text-rose-300'
									: 'border-amber-400/35 bg-amber-400/14 text-amber-300'}

						<article
							in:fly={{
								y: 16,
								duration: 300,
								delay: Math.min(idx * 42, 340),
								easing: cubicOut
							}}
							class="glass-card group relative overflow-hidden rounded-2xl transition-all duration-200 {isExpanded
								? 'border-white/18 shadow-[0_22px_48px_-12px_rgba(0,0,0,0.88)]'
								: 'hover:-translate-y-0.5 hover:border-white/16'}"
						>
							<!-- Luminous Left Outcome Bar -->
							<div
								aria-hidden="true"
								class="pointer-events-none absolute inset-y-0 left-0 z-20 w-1 bg-gradient-to-b {outcomeAccentBar}"
							></div>

							<button
								type="button"
								aria-expanded={isExpanded}
								onclick={() => toggleMatch(match)}
								class="relative flex w-full cursor-pointer flex-col gap-3 px-4 py-3.5 text-left transition sm:px-5 lg:grid lg:grid-cols-[245px_215px_1fr_32px] lg:items-center lg:gap-4"
								style="background: radial-gradient(circle at 0% 50%, {outcomeGlowRgba} 0%, transparent 45%);"
							>
								<!-- Atmospheric Map Splash Backdrop -->
								{#if match.mapSplash}
									<div
										class="pointer-events-none absolute inset-y-0 left-0 w-full overflow-hidden opacity-20 sm:w-80"
									>
										<img
											src={match.mapSplash}
											alt=""
											loading="lazy"
											class="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
										/>
										<div
											class="absolute inset-0 bg-gradient-to-r from-[#0a0f1a]/35 via-[#0c1220]/82 to-[#0e1422]"
										></div>
									</div>
								{/if}

								<!-- Top Row on Mobile / Col 1 + Col 2 on Desktop -->
								<div class="relative z-10 flex items-center justify-between gap-2.5 lg:contents">
									<!-- Col 1: Agent Portrait + Rank + Map + Timestamp -->
									<div class="flex min-w-0 items-center gap-3">
										<div class="relative shrink-0">
											{#if match.agentIcon}
												<img
													src={match.agentIcon}
													alt={match.agentName}
													class="h-12 w-12 rounded-xl border border-white/18 bg-slate-900/90 object-cover shadow-[0_6px_16px_rgba(0,0,0,0.65)] transition-transform duration-200 group-hover:scale-[1.03]"
												/>
											{:else}
												<div class="neu-well-sm h-12 w-12 rounded-xl"></div>
											{/if}
											{#if match.rankIcon && match.competitiveTier >= 3}
												<img
													src={match.rankIcon}
													alt={match.rankName}
													title={match.rankName}
													class="absolute -right-1.5 -bottom-1.5 h-5 w-5 rounded-full border border-white/15 bg-[#080c15] p-0.5 shadow-md"
												/>
											{/if}
										</div>

										<div class="min-w-0">
											<div class="flex flex-wrap items-center gap-1.5">
												<p
													class="truncate font-display text-sm font-extrabold text-white sm:text-base"
												>
													{match.mapName}
												</p>
												<span
													class="rounded-md border border-white/10 bg-white/[0.07] px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wide text-slate-200 uppercase"
												>
													{formatQueueBadge(match.queueId)}
												</span>
												{#if actLabelBySeasonId[match.seasonId]}
													<span
														class="rounded-md border border-white/8 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9px] font-medium text-slate-400"
													>
														{actLabelBySeasonId[match.seasonId]}
													</span>
												{/if}
											</div>
											<p
												class="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-slate-400 tabular-nums"
											>
												<span class="font-semibold text-slate-300">{match.agentName}</span>
												<span class="text-white/20">·</span>
												<span>{formatMatchDate(match.startedAt)}</span>
												<span class="hidden text-white/20 sm:inline">·</span>
												<span class="hidden sm:inline">{formatDuration(match.durationSeconds)}</span
												>
											</p>
										</div>
									</div>

									<!-- Col 2: Scoreline + Outcome + RR Delta + Ribbons -->
									<div
										class="flex shrink-0 flex-col items-end gap-1 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2"
									>
										<div class="flex items-center gap-2">
											{#if !isDeathmatch}
												<span
													class="neu-well-sm inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-display text-sm font-extrabold text-white tabular-nums sm:text-base"
												>
													<span class="text-emerald-400">{match.roundsWon}</span>
													<span class="text-slate-500">:</span>
													<span class="text-rose-400">{match.roundsLost}</span>
												</span>
											{/if}

											<span
												class="rounded-full border px-2 py-0.5 font-mono text-[9px] font-extrabold tracking-wider uppercase sm:text-[10px] {outcomeBadgeClass}"
											>
												{match.outcome === 'win'
													? 'Victory'
													: match.outcome === 'loss'
														? 'Defeat'
														: 'Draw'}
											</span>
										</div>

										<div class="flex flex-wrap items-center justify-end gap-1.5">
											{#if match.rrDelta !== null}
												<span
													class="rounded-md bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums {match.rrDelta >=
													0
														? 'text-emerald-400'
														: 'text-rose-400'}"
												>
													{match.rrDelta >= 0 ? `+${match.rrDelta}` : match.rrDelta} RR
												</span>
											{/if}

											{#if match.isMatchMvp}
												<span
													class="inline-flex items-center gap-1 rounded-md border border-amber-400/45 bg-amber-400/15 px-1.5 py-0.5 font-mono text-[9px] font-extrabold text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.2)]"
												>
													<Sparkles class="h-2.5 w-2.5 text-amber-300" />
													MVP
												</span>
											{:else if match.isTeamMvp}
												<span
													class="rounded-md border border-cyan-400/35 bg-cyan-400/12 px-1.5 py-0.5 font-mono text-[9px] font-bold text-cyan-200"
												>
													TEAM MVP
												</span>
											{/if}

											{#if match.aces > 0}
												<span
													class="rounded-md border border-rose-400/40 bg-rose-500/15 px-1.5 py-0.5 font-mono text-[9px] font-extrabold text-rose-200"
												>
													ACE{match.aces > 1 ? ` ×${match.aces}` : ''}
												</span>
											{/if}
										</div>
									</div>
								</div>

								<!-- Col 3: Telemetry Pod (Carved 2x3 pod on mobile, crisp 6-col strip on desktop) -->
								<div
									class="relative z-10 flex items-center gap-2.5 rounded-xl border border-white/[0.05] bg-[#070a12]/65 px-3 py-2 sm:border-0 sm:bg-transparent sm:p-0 lg:contents"
								>
									<div class="grid flex-1 grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6 sm:gap-3">
										<div>
											<p class="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
												K / D / A
											</p>
											<p class="font-mono text-xs font-bold text-white tabular-nums">
												{match.kills}<span class="text-slate-500">/</span>{match.deaths}<span
													class="text-slate-500">/</span
												>{match.assists}
											</p>
										</div>
										<div>
											<p class="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
												K/D
											</p>
											<p
												class="font-mono text-xs font-extrabold tabular-nums {match.kd >= 1.2
													? 'text-emerald-300'
													: match.kd >= 1
														? 'text-emerald-400'
														: 'text-slate-300'}"
											>
												{match.kd.toFixed(2)}
											</p>
										</div>
										<div>
											<p class="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
												ACS
											</p>
											<p class="font-mono text-xs font-bold text-white tabular-nums">
												{Math.round(match.acs)}
											</p>
										</div>
										<div>
											<p class="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
												ADR
											</p>
											<p class="font-mono text-xs font-bold text-slate-200 tabular-nums">
												{match.adr.toFixed(1)}
											</p>
										</div>
										<div>
											<p class="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
												HS%
											</p>
											<p class="font-mono text-xs font-bold text-neu-cyan tabular-nums">
												{match.hsPercent.toFixed(1)}%
											</p>
										</div>
										<div>
											<p class="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">
												KAST
											</p>
											<p class="font-mono text-xs font-bold text-slate-200 tabular-nums">
												{Math.round(match.kastPercent)}%
											</p>
										</div>
									</div>

									<!-- Mobile Expand Chevron Pill -->
									<div
										class="neu-well-sm flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 lg:hidden"
									>
										<ChevronDown
											class="h-3.5 w-3.5 transition-transform duration-250 {isExpanded
												? 'rotate-180 text-white'
												: ''}"
										/>
									</div>
								</div>

								<!-- Col 4: Desktop Expand Chevron -->
								<div
									class="neu-well-sm relative z-10 hidden h-8 w-8 items-center justify-center justify-self-end rounded-lg text-slate-400 transition group-hover:text-white lg:flex"
								>
									<ChevronDown
										class="h-4 w-4 transition-transform duration-250 {isExpanded
											? 'rotate-180 text-white'
											: ''}"
									/>
								</div>
							</button>

							<!-- Smooth Animated 10-Player Match Scoreboard Drawer -->
							{#if isExpanded}
								{#if match.scoreboard.length === 0}
									<div
										class="border-t border-white/10 bg-[#060911]/88 px-4 py-6 text-center text-xs text-slate-400"
									>
										{scoreboardLoading === match.matchId
											? 'Loading scoreboard…'
											: 'No stored scoreboard for this match.'}
									</div>
								{:else}
									{@const meEntry = match.scoreboard.find(
										(p) => p.puuid.toLowerCase() === ownerPuuid.toLowerCase()
									)}
									{@const myTeamId = meEntry?.teamId ?? 'Blue'}
									{@const allies = isDeathmatch
										? match.scoreboard
										: match.scoreboard.filter((p) => p.teamId === myTeamId)}
									{@const enemies = isDeathmatch
										? []
										: match.scoreboard.filter((p) => p.teamId !== myTeamId)}
									{@const topLobbyAcs = Math.max(0, ...match.scoreboard.map((p) => p.acs))}

									<div
										transition:slide={{ duration: 260, easing: cubicOut }}
										class="border-t border-white/10 bg-[#060911]/88"
									>
										<div in:fade={{ duration: 180 }} class="flex flex-col gap-3 p-3.5 sm:p-4">
											<!-- Match Micro-Highlights Strip -->
											<div class="flex flex-wrap items-center justify-between gap-2 text-[11px]">
												<div class="flex flex-wrap items-center gap-2 font-mono text-slate-400">
													<span
														class="inline-flex items-center gap-1 rounded-lg bg-white/[0.04] px-2.5 py-1"
													>
														<Clock class="h-3 w-3 text-slate-400" />
														{formatDuration(match.durationSeconds)} · {match.roundsPlayed} Rounds
													</span>
													<span
														class="inline-flex items-center gap-1 rounded-lg bg-white/[0.04] px-2.5 py-1"
													>
														<Zap class="h-3 w-3 text-amber-300" />
														{match.firstBloods} First {match.firstBloods === 1 ? 'Blood' : 'Bloods'}
													</span>
													<span
														class="inline-flex items-center gap-1 rounded-lg bg-white/[0.04] px-2.5 py-1 {match.ddDeltaPerRound >=
														0
															? 'text-emerald-300'
															: 'text-rose-300'}"
													>
														DDΔ {match.ddDeltaPerRound >= 0
															? `+${match.ddDeltaPerRound}`
															: match.ddDeltaPerRound}/rnd
													</span>
												</div>
											</div>

											{#snippet teamScoreboardTable(
												title: string,
												roundsCount: number | null,
												accentClass: string,
												players: HydratedMatchItem['scoreboard']
											)}
												<div class="neu-well overflow-x-auto rounded-xl p-2.5 sm:p-3">
													<div class="mb-2 flex items-center justify-between px-2">
														<p
															class="font-mono text-[10px] font-bold tracking-wider uppercase {accentClass}"
														>
															{title}
														</p>
														{#if roundsCount !== null}
															<span
																class="font-mono text-[10px] font-bold text-slate-400 tabular-nums"
															>
																{roundsCount}
																{roundsCount === 1 ? 'Round' : 'Rounds'} Won
															</span>
														{/if}
													</div>

													<table class="w-full min-w-[430px] text-left text-xs">
														<thead>
															<tr
																class="border-b border-white/8 text-[10px] text-slate-400 uppercase"
															>
																<th class="px-2 py-1.5 font-semibold">Player</th>
																<th class="px-2 py-1.5 text-right font-semibold">ACS</th>
																<th class="px-2 py-1.5 text-right font-semibold">K/D/A</th>
																<th class="px-2 py-1.5 text-right font-semibold">ADR</th>
																<th class="px-2 py-1.5 text-right font-semibold">HS%</th>
																<th class="px-2 py-1.5 text-right font-semibold">FB</th>
															</tr>
														</thead>
														<tbody
															class="divide-y divide-white/5 font-mono text-[11px] tabular-nums"
														>
															{#each players as p (p.puuid)}
																{@const isMe = p.puuid.toLowerCase() === ownerPuuid.toLowerCase()}
																{@const label = resolveScoreboardPlayerLabel(p, isMe)}
																{@const isLobbyMvp = topLobbyAcs > 0 && p.acs === topLobbyAcs}
																<tr
																	class="transition-colors hover:bg-white/[0.03] {isMe
																		? 'bg-neu-accent/14 text-white'
																		: 'text-slate-300'}"
																>
																	<td class="px-2 py-2 font-sans">
																		<div class="flex min-w-0 items-center gap-2">
																			{#if p.agentIcon}
																				<img
																					src={p.agentIcon}
																					alt={p.agentName}
																					title={p.agentName}
																					class="h-6 w-6 shrink-0 rounded-md border border-white/10 bg-slate-900 object-cover"
																				/>
																			{/if}
																			{#if p.rankIcon && p.competitiveTier >= 3}
																				<img
																					src={p.rankIcon}
																					alt={p.rankName}
																					title={p.rankName}
																					class="h-4 w-4 shrink-0 object-contain"
																				/>
																			{/if}
																			<div class="flex min-w-0 items-center gap-1.5">
																				<span
																					class="max-w-36 truncate text-xs font-semibold sm:max-w-44 {isMe
																						? 'text-white'
																						: label.isAgentFallback
																							? 'text-slate-200'
																							: 'text-slate-100'}"
																					title={label.tag
																						? `${label.primary}#${label.tag}`
																						: label.primary}
																				>
																					{label.primary}{#if label.tag}<span
																							class="font-mono text-[10px] font-normal text-slate-400"
																							>#{label.tag}</span
																						>{/if}
																				</span>
																				{#if isMe}
																					<span
																						class="shrink-0 rounded bg-neu-accent/25 px-1 py-0.5 font-mono text-[8px] font-extrabold text-rose-200 uppercase"
																					>
																						YOU
																					</span>
																				{:else if label.isAgentFallback}
																					<span
																						class="shrink-0 rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[8px] font-semibold text-slate-400 uppercase"
																						title="Riot ID hidden (Streamer Mode)"
																					>
																						Agent
																					</span>
																				{/if}
																				{#if isLobbyMvp}
																					<span
																						class="shrink-0 rounded border border-amber-400/35 bg-amber-400/12 px-1 py-0.5 font-mono text-[8px] font-bold text-amber-300"
																					>
																						MVP
																					</span>
																				{/if}
																			</div>
																		</div>
																	</td>
																	<td class="px-2 py-2 text-right font-bold text-white">{p.acs}</td>
																	<td class="px-2 py-2 text-right">
																		{p.kills}/{p.deaths}/{p.assists}
																	</td>
																	<td class="px-2 py-2 text-right">{p.adr.toFixed(0)}</td>
																	<td class="px-2 py-2 text-right text-neu-cyan">
																		{p.hsPercent.toFixed(0)}%
																	</td>
																	<td class="px-2 py-2 text-right">{p.firstBloods}</td>
																</tr>
															{/each}
														</tbody>
													</table>
												</div>
											{/snippet}

											<div class="grid gap-3.5 {enemies.length > 0 ? 'xl:grid-cols-2' : ''}">
												{@render teamScoreboardTable(
													isDeathmatch ? 'Lobby Standings' : 'Allied Team',
													isDeathmatch ? null : match.roundsWon,
													'text-emerald-400',
													allies
												)}

												{#if enemies.length > 0}
													{@render teamScoreboardTable(
														'Enemy Team',
														match.roundsLost,
														'text-rose-400',
														enemies
													)}
												{/if}
											</div>
										</div>
									</div>
								{/if}
							{/if}
						</article>
					{/each}
				</div>
			{/key}

			<!-- ==================== MATCH HISTORY PAGINATION BAR ==================== -->
			<nav
				aria-label="Match history pagination"
				data-match-pagination
				class="glass-neu flex flex-col gap-2.5 rounded-2xl px-3.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4"
			>
				<div class="flex flex-wrap items-center justify-between gap-2 sm:justify-start">
					<span class="font-mono text-[11px] text-slate-300 tabular-nums">
						Showing <strong class="text-white">{pageStartIndex + 1}</strong>–<strong
							class="text-white"
							>{Math.min(pageStartIndex + paginatedMatches.length, historyMatches.length)}</strong
						>
						of <strong class="text-white">{historyMatches.length}</strong> matches
					</span>

					<div
						role="group"
						aria-label="Matches per page"
						class="neu-well-sm flex items-center gap-0.5 rounded-lg p-0.5"
					>
						{#each [5, 10, 20] as const as size (size)}
							<button
								type="button"
								onclick={() => {
									pageSize = size;
									currentPage = 1;
								}}
								data-active={pageSize === size}
								class="seg-tab cursor-pointer rounded-md px-2 py-0.5 font-mono text-[10px] font-bold tabular-nums"
							>
								{size}/pg
							</button>
						{/each}
					</div>
				</div>

				{#if totalPages > 1}
					<div class="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
						<button
							type="button"
							disabled={safePage <= 1}
							onclick={() => (currentPage = Math.max(1, safePage - 1))}
							aria-label="Previous page"
							class="neu-btn inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2.5 font-mono text-[11px] font-bold text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<ChevronDown class="h-3.5 w-3.5 rotate-90" />
							<span>Prev</span>
						</button>

						{#each pageNumbers as p (p)}
							<button
								type="button"
								onclick={() => (currentPage = p)}
								aria-current={safePage === p ? 'page' : undefined}
								class="h-8 min-w-8 cursor-pointer rounded-lg px-2 font-mono text-[11px] font-bold tabular-nums transition {safePage ===
								p
									? 'neu-btn-accent text-white'
									: 'neu-btn text-slate-300 hover:text-white'}"
							>
								{p}
							</button>
						{/each}

						<button
							type="button"
							disabled={safePage >= totalPages}
							onclick={() => (currentPage = Math.min(totalPages, safePage + 1))}
							aria-label="Next page"
							class="neu-btn inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg px-2.5 font-mono text-[11px] font-bold text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
						>
							<span>Next</span>
							<ChevronDown class="h-3.5 w-3.5 -rotate-90" />
						</button>
					</div>
				{/if}
			</nav>
		{/if}
		{#if allMatches.length < storedTotal}
			<div class="flex justify-center">
				<button
					type="button"
					disabled={loadingOlder}
					onclick={loadOlderMatches}
					class="neu-btn cursor-pointer rounded-xl px-4 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50"
				>
					{loadingOlder
						? 'Loading older matches…'
						: `Load older matches — ${allMatches.length} of ${storedTotal} indexed`}
				</button>
			</div>
		{/if}
	</section>
</div>
