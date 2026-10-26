<script lang="ts">
	import { Crosshair, Flame, Swords, Trophy } from '@lucide/svelte';
	import type { HydratedProfileBanner } from '#lib/server/providers/valorant/service.js';
	import type { SharedStats } from '#lib/server/sharing.js';

	let {
		stats,
		profile = null
	}: {
		stats: SharedStats;
		profile?: HydratedProfileBanner | null;
	} = $props();
	const gradientId = $props.id();
	const circumference = 2 * Math.PI * 32;
	const winArc = $derived((circumference * stats.wins) / Math.max(1, stats.wins + stats.losses));
	const primaryMetrics = $derived([
		{
			label: 'Damage/Round',
			value: stats.averageDamagePerRound.toFixed(1),
			detail: 'Average damage',
			icon: Crosshair,
			color: '#fda4af'
		},
		{
			label: 'K/D Ratio',
			value: stats.killDeathRatio.toFixed(2),
			detail: `${stats.kills}K / ${stats.deaths}D`,
			icon: Swords,
			color: '#fcd34d'
		},
		{
			label: 'Headshot %',
			value: `${stats.headshotPercent.toFixed(1)}%`,
			detail: 'Of recorded hits',
			icon: Flame,
			color: '#67e8f9'
		},
		{
			label: 'Combat Score',
			value: stats.averageCombatScore.toFixed(1),
			detail: 'Average per round',
			icon: Trophy,
			color: '#6ee7b7'
		}
	]);
	const secondaryMetrics = $derived([
		{ label: 'KAST', value: `${stats.kastPercent.toFixed(1)}%` },
		{ label: 'Kills', value: stats.kills },
		{ label: 'Deaths', value: stats.deaths },
		{ label: 'Assists', value: stats.assists },
		{
			label: 'KAD Ratio',
			value: ((stats.kills + stats.assists) / Math.max(1, stats.deaths)).toFixed(2)
		}
	]);
</script>

<section
	class="glass-neu relative isolate overflow-hidden rounded-2xl p-4 sm:p-6"
	aria-labelledby="shared-stats-title"
>
	<div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
		{#if profile?.wideBannerUrl}
			<img
				src={profile.wideBannerUrl}
				alt=""
				class="h-full w-full object-cover opacity-15 blur-[1px]"
			/>
		{/if}
		<div
			class="absolute inset-0 bg-gradient-to-r from-[#090d17]/95 via-[#0b101d]/90 to-[#090d17]/90"
		></div>
		<div
			class="absolute inset-0"
			style="background: radial-gradient(circle at 12% 16%, {profile?.currentRank.colorHex ??
				'#94a3b8'}24 0%, transparent 46%), radial-gradient(circle at 75% 18%, rgba(16,185,129,0.16) 0%, transparent 45%);"
		></div>
		{#if profile?.heroAgentPortraitUrl}
			<img
				src={profile.heroAgentPortraitUrl}
				alt=""
				class="absolute -top-6 right-20 hidden h-72 w-72 object-contain opacity-15 lg:block"
			/>
		{/if}
	</div>

	<div class="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/10 pb-4">
		<h2
			id="shared-stats-title"
			class="font-display text-sm font-bold tracking-wider text-white uppercase"
		>
			Performance Overview
		</h2>
		<p class="font-mono text-xs text-slate-300">
			{stats.sampleCount}
			{stats.sampleCount === 1 ? 'match' : 'matches'} / All queues
		</p>
	</div>

	{#if stats.sampleCount > 0}
		<div
			class="mt-4 flex flex-wrap items-center justify-between gap-6 rounded-2xl border border-white/10 px-4 py-5 sm:px-5"
			style="background: linear-gradient(125deg, {profile?.currentRank.colorHex ??
				'#94a3b8'}18 0%, rgba(10,15,26,0.78) 44%, rgba(16,185,129,0.12) 100%);"
		>
			<div class="flex items-center gap-4">
				{#if profile?.currentRank.iconUrl}
					<img
						src={profile.currentRank.iconUrl}
						alt=""
						class="h-16 w-16 object-contain drop-shadow-lg"
					/>
				{/if}
				<div>
					<p class="text-xs font-semibold text-slate-300">Current Rating</p>
					<p class="mt-1 font-display text-2xl font-bold text-white sm:text-3xl">
						{profile?.currentRank.name ?? 'Unrated'}
					</p>
					{#if profile}
						<p class="mt-1 font-mono text-xs text-slate-300">
							{profile.currentRank.rr} RR
							{#if profile.accountLevel !== null}
								/ Level {profile.accountLevel}{/if}
						</p>
					{/if}
				</div>
			</div>
			<div class="flex items-center gap-4 sm:gap-5">
				<svg
					viewBox="0 0 80 80"
					class="h-20 w-20 shrink-0 -rotate-90"
					role="img"
					aria-label={`${stats.wins} wins, ${stats.losses} losses`}
				>
					<defs>
						<linearGradient id={gradientId}>
							<stop offset="0%" stop-color="#34d399" />
							<stop offset="100%" stop-color="#22d3ee" />
						</linearGradient>
					</defs>
					<circle
						cx="40"
						cy="40"
						r="32"
						fill="#080d16"
						stroke="#fb7185"
						stroke-opacity={stats.losses ? 0.7 : 0.15}
						stroke-width="6"
					/>
					{#if stats.wins > 0}
						<circle
							cx="40"
							cy="40"
							r="32"
							fill="none"
							stroke={`url(#${gradientId})`}
							stroke-width="6"
							stroke-linecap="round"
							stroke-dasharray={`${winArc} ${circumference}`}
						/>
					{/if}
				</svg>
				<div>
					<p class="text-xs font-semibold text-slate-300">Win Rate</p>
					<p class="mt-1 font-display text-4xl font-bold text-emerald-300 tabular-nums">
						{stats.winPercent.toFixed(1)}%
					</p>
					<p class="mt-1 font-mono text-xs text-slate-300 tabular-nums">
						<span class="text-emerald-300">{stats.wins}W</span> /
						<span class="text-rose-300">{stats.losses}L</span>
						{#if stats.draws > 0}
							/ {stats.draws}D{/if}
					</p>
				</div>
			</div>
		</div>

		<dl class="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
			{#each primaryMetrics as metric (metric.label)}
				<div
					class="neu-well rounded-xl p-3.5 sm:p-4"
					style="background: radial-gradient(circle at 100% 0%, {metric.color}16 0%, rgba(7,10,17,0.85) 80%);"
				>
					<dt class="flex items-center justify-between gap-2 text-xs font-semibold text-slate-300">
						{metric.label}
						<metric.icon
							class="hidden h-4 w-4 shrink-0 sm:block"
							style={`color: ${metric.color}`}
						/>
					</dt>
					<dd class="mt-2 font-display text-2xl font-bold text-white tabular-nums sm:text-3xl">
						{metric.value}
					</dd>
					<dd class="mt-1 font-mono text-[11px] text-slate-300">{metric.detail}</dd>
				</div>
			{/each}
		</dl>
		<dl class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
			{#each secondaryMetrics as metric (metric.label)}
				<div class="neu-well-sm rounded-xl px-3.5 py-3">
					<dt class="text-xs font-semibold text-slate-300">{metric.label}</dt>
					<dd class="mt-1 font-display text-lg font-bold text-white tabular-nums">
						{metric.value}
					</dd>
				</div>
			{/each}
		</dl>
		<p class="mt-4 text-xs leading-relaxed text-slate-400">
			From the last saved sync. Individual matches and scoreboards stay private.
		</p>
	{:else}
		<p class="neu-well mt-4 rounded-xl p-6 text-sm text-slate-300">
			No performance stats were available when this profile was published. Rank and level are shown
			above when available.
		</p>
	{/if}
</section>
