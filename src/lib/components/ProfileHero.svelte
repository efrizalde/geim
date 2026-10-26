<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Activity,
		Backpack,
		Clock,
		RefreshCw,
		Share2,
		ShieldAlert,
		Store,
		Trash2,
		Trophy
	} from '@lucide/svelte';
	import type { HydratedProfileBanner } from '#lib/server/providers/valorant/service.js';

	export type ModuleKey = 'tracker' | 'shop' | 'inventory';

	interface Props {
		activeAccount: {
			id?: string;
			gameName: string;
			tagLine: string;
			shard: string;
			connectionStatus?: string;
		};
		profile: HydratedProfileBanner | null;
		currencyIcons: {
			vp: string;
			radianite: string;
			kingdomCredits: string;
		};
		wallet: {
			vp: number | null;
			radianite: number | null;
			kingdomCredits: number | null;
		} | null;
		activeModule: ModuleKey;
		onSelectModule: (mod: ModuleKey) => void;
		onOpenConnect?: () => void;
		onShare?: () => void;
		readOnly?: boolean;
		syncError?: string | null;
		ownedSkinCount?: number | null;
		matchSampleCount?: number | null;
		shopCountdown?: string | null;
		relativeSyncText: string;
	}

	let {
		activeAccount,
		profile,
		currencyIcons,
		wallet,
		activeModule,
		onSelectModule,
		onOpenConnect,
		onShare,
		readOnly = false,
		syncError = null,
		ownedSkinCount = null,
		matchSampleCount = null,
		shopCountdown = null,
		relativeSyncText
	}: Props = $props();

	let syncing = $state(false);
</script>

<section class="glass-neu relative overflow-hidden rounded-2xl">
	<!-- Atmospheric Wide Player Card Banner + Hero Agent Portrait -->
	<div class="pointer-events-none absolute inset-0 overflow-hidden">
		{#if profile?.wideBannerUrl}
			<img
				src={profile.wideBannerUrl}
				alt=""
				class="h-full w-full scale-105 object-cover object-center opacity-35 blur-[1px]"
			/>
		{/if}
		<!-- Multi-stop dark frosted vignette so typography is always razor-sharp -->
		<div
			class="absolute inset-0 bg-gradient-to-r from-[#090d16]/95 via-[#0c111d]/82 to-[#090d16]/90"
		></div>
		<div
			class="absolute inset-0 bg-gradient-to-t from-[#080b12] via-transparent to-[#080b12]/40"
		></div>

		{#if profile?.heroAgentPortraitUrl}
			<img
				src={profile.heroAgentPortraitUrl}
				alt=""
				class="absolute -top-10 right-6 hidden h-72 w-72 object-contain opacity-28 drop-shadow-[0_12px_28px_rgba(0,0,0,0.85)] lg:block"
			/>
		{/if}
	</div>

	<!-- Foreground Hero Identity + Wallet & Sync Controls -->
	<div
		class="relative z-10 flex flex-col justify-between gap-4 px-4 pt-5 pb-4 sm:gap-5 sm:px-7 sm:pt-7 sm:pb-5 lg:flex-row lg:items-center"
	>
		<!-- Left: Avatar + Riot ID + Rank Badges (Side-by-side even on mobile!) -->
		<div class="flex flex-col gap-3">
			<div class="flex items-center gap-3.5 sm:gap-5">
				<!-- Circular Player Card Avatar with Level Pill -->
				<div class="relative shrink-0">
					<div
						class="relative h-16 w-16 overflow-hidden rounded-full border-2 border-white/90 bg-slate-900 shadow-[0_0_28px_rgba(255,70,85,0.28)] sm:h-22 sm:w-22"
					>
						{#if profile?.avatarUrl}
							<img
								src={profile.avatarUrl}
								alt="{activeAccount.gameName} player card"
								class="h-full w-full object-cover"
							/>
						{:else}
							<div
								class="flex h-full w-full items-center justify-center bg-gradient-to-br from-rose-500/30 to-cyan-500/20 font-display text-xl font-bold text-white sm:text-2xl"
							>
								{activeAccount.gameName.slice(0, 2).toUpperCase()}
							</div>
						{/if}
					</div>

					{#if profile?.accountLevel !== null && profile?.accountLevel !== undefined}
						<span
							class="neu-well-sm absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border border-amber-400/35 bg-[#0b0f19]/95 px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider whitespace-nowrap text-amber-300 shadow-md sm:px-2.5 sm:text-[10px]"
						>
							LVL {profile.accountLevel}
						</span>
					{/if}
				</div>

				<!-- Riot ID, Title, Region & Desktop Rank Mini-Badges -->
				<div class="flex min-w-0 flex-1 flex-col gap-1.5 sm:gap-2">
					<div class="flex flex-wrap items-center gap-1.5 text-[10px] sm:gap-2 sm:text-[11px]">
						<span
							class="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 font-mono font-medium text-slate-300 sm:px-2.5"
						>
							<span
								class="h-1.5 w-1.5 rounded-full {!readOnly &&
								activeAccount.connectionStatus === 'connected'
									? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
									: 'bg-amber-400'}"
							></span>
							<span class="uppercase">{activeAccount.shard}</span>
						</span>

						{#if profile?.playerTitleText}
							<span
								class="max-w-40 truncate rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-0.5 font-medium text-cyan-200 sm:max-w-none sm:px-2.5"
							>
								{profile.playerTitleText}
							</span>
						{/if}

						<span class="font-mono text-slate-400">
							Synced {relativeSyncText}
						</span>
					</div>

					<div class="flex flex-wrap items-center gap-2 sm:gap-2.5">
						<h2
							class="truncate font-display text-xl font-bold tracking-tight text-white drop-shadow-sm sm:text-3xl"
						>
							{activeAccount.gameName}
						</h2>
						<span
							class="neu-well-sm shrink-0 rounded-lg px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-300 sm:px-2.5 sm:py-1 sm:text-xs"
						>
							#{activeAccount.tagLine}
						</span>

						<!-- Desktop / Tablet Inline Rank Capsule -->
						{#if profile && (profile.currentRank.iconUrl || profile.peakRank?.iconUrl)}
							<div class="neu-well-sm hidden items-center gap-2 rounded-xl px-2.5 py-1 sm:flex">
								{#if profile.currentRank.iconUrl}
									<div
										class="flex items-center gap-1.5"
										title="Current Rating: {profile.currentRank.name} ({profile.currentRank.rr} RR)"
									>
										<img
											src={profile.currentRank.iconUrl}
											alt={profile.currentRank.name}
											class="h-5 w-5 object-contain"
										/>
										<span class="text-xs font-semibold text-white">
											{profile.currentRank.name}
										</span>
										<span class="font-mono text-[11px] text-slate-400 tabular-nums">
											{profile.currentRank.rr}RR
										</span>
									</div>
								{/if}

								{#if profile.peakRank?.iconUrl}
									<span class="h-3.5 w-px bg-white/10"></span>
									<div
										class="flex items-center gap-1.5"
										title="Peak Rating: {profile.peakRank.name} ({profile.peakRank.actLabel})"
									>
										<Trophy class="h-3 w-3 text-amber-400" />
										<img
											src={profile.peakRank.iconUrl}
											alt={profile.peakRank.name}
											class="h-5 w-5 object-contain"
										/>
										<span class="text-xs font-medium text-slate-300">
											{profile.peakRank.name}
										</span>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</div>

			<!-- Mobile Full-Width Rank & Peak Strip -->
			{#if profile && (profile.currentRank.iconUrl || profile.peakRank?.iconUrl)}
				<div
					class="neu-well-sm flex items-center justify-between gap-2 rounded-xl px-3 py-2 sm:hidden"
				>
					{#if profile.currentRank.iconUrl}
						<div class="flex min-w-0 items-center gap-2">
							<img
								src={profile.currentRank.iconUrl}
								alt={profile.currentRank.name}
								class="h-5 w-5 shrink-0 object-contain"
							/>
							<span class="truncate text-xs font-bold text-white">
								{profile.currentRank.name}
							</span>
							<span class="font-mono text-[11px] text-slate-400 tabular-nums">
								{profile.currentRank.rr}RR
							</span>
						</div>
					{/if}

					{#if profile.peakRank?.iconUrl}
						<div class="flex shrink-0 items-center gap-1.5 border-l border-white/10 pl-2.5">
							<Trophy class="h-3 w-3 text-amber-400" />
							<img
								src={profile.peakRank.iconUrl}
								alt={profile.peakRank.name}
								class="h-4.5 w-4.5 object-contain"
							/>
							<span class="text-[11px] font-semibold text-slate-300">
								{profile.peakRank.name}
							</span>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Right: Tactile Neumorphic Wallet Capsule + Uniform Sync Actions -->
		{#if !readOnly}
			<div class="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center lg:justify-end">
				<!-- Wallet Balances Well -->
				<div
					class="neu-well grid grid-cols-3 gap-1 rounded-xl p-1.5 sm:flex sm:items-center sm:gap-2"
				>
					<div
						class="flex min-w-0 items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5 sm:gap-2 sm:px-2.5"
					>
						<img
							src={currencyIcons.vp}
							alt="VP"
							class="h-3.5 w-3.5 shrink-0 object-contain opacity-90 sm:h-4 sm:w-4"
						/>
						<div class="min-w-0 leading-tight">
							<p class="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">VP</p>
							<p
								class="truncate font-mono text-[11px] font-bold text-white tabular-nums sm:text-xs"
							>
								{wallet?.vp !== null && wallet?.vp !== undefined ? wallet.vp.toLocaleString() : '—'}
							</p>
						</div>
					</div>

					<div
						class="flex min-w-0 items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5 sm:gap-2 sm:px-2.5"
					>
						<img
							src={currencyIcons.radianite}
							alt="Radianite"
							class="h-3.5 w-3.5 shrink-0 object-contain opacity-90 sm:h-4 sm:w-4"
						/>
						<div class="min-w-0 leading-tight">
							<p class="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">RP</p>
							<p
								class="truncate font-mono text-[11px] font-bold text-white tabular-nums sm:text-xs"
							>
								{wallet?.radianite !== null && wallet?.radianite !== undefined
									? wallet.radianite.toLocaleString()
									: '—'}
							</p>
						</div>
					</div>

					<div
						class="flex min-w-0 items-center gap-1.5 rounded-lg bg-white/[0.03] px-2 py-1.5 sm:gap-2 sm:px-2.5"
					>
						<img
							src={currencyIcons.kingdomCredits}
							alt="Kingdom Credits"
							class="h-3.5 w-3.5 shrink-0 object-contain opacity-90 sm:h-4 sm:w-4"
						/>
						<div class="min-w-0 leading-tight">
							<p class="text-[9px] font-semibold tracking-wider text-slate-400 uppercase">KC</p>
							<p
								class="truncate font-mono text-[11px] font-bold text-white tabular-nums sm:text-xs"
							>
								{wallet?.kingdomCredits !== null && wallet?.kingdomCredits !== undefined
									? wallet.kingdomCredits.toLocaleString()
									: '—'}
							</p>
						</div>
					</div>
				</div>

				<!-- Sync / Share / Reconnect / Disconnect Controls (Uniform Height) -->
				<div class="flex flex-wrap items-center gap-2">
					{#if syncError}
						<button
							type="button"
							onclick={onOpenConnect}
							class="neu-well flex min-h-10 w-full cursor-pointer items-center gap-1.5 rounded-xl border border-amber-400/35 px-3 py-2 text-xs font-medium text-amber-300 hover:text-white sm:w-auto"
						>
							<ShieldAlert class="h-3.5 w-3.5 shrink-0" />
							<span class="truncate sm:max-w-48">{syncError}</span>
						</button>
					{/if}

					{#if activeAccount.connectionStatus === 'reconnect_required'}
						<button
							type="button"
							onclick={onOpenConnect}
							class="neu-btn-accent min-h-10 flex-1 cursor-pointer rounded-xl px-3.5 py-2 text-xs font-semibold sm:flex-none"
						>
							Reconnect
						</button>
					{/if}

					{#if onShare}
						<button
							type="button"
							onclick={onShare}
							class="neu-btn flex min-h-10 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white sm:flex-none"
						>
							<Share2 class="h-3.5 w-3.5 shrink-0 text-neu-cyan" />
							<span>Share Profile</span>
						</button>
					{/if}

					<form
						method="POST"
						action="?/refreshAccount"
						class="flex flex-1 sm:flex-none"
						use:enhance={() => {
							syncing = true;
							return async ({ update }) => {
								syncing = false;
								await update();
							};
						}}
					>
						<input type="hidden" name="accountId" value={activeAccount.id} />
						<button
							type="submit"
							disabled={syncing}
							class="neu-btn flex min-h-10 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-60"
						>
							<RefreshCw
								class="h-3.5 w-3.5 shrink-0 text-neu-cyan {syncing ? 'animate-spin' : ''}"
							/>
							<span>{syncing ? 'Syncing…' : 'Sync'}</span>
						</button>
					</form>

					<form method="POST" action="?/disconnectAccount" use:enhance>
						<input type="hidden" name="accountId" value={activeAccount.id} />
						<button
							type="submit"
							class="neu-btn flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-slate-400 hover:text-rose-400"
							title="Disconnect account and wipe local encrypted session"
							aria-label="Disconnect account"
						>
							<Trash2 class="h-3.5 w-3.5" />
						</button>
					</form>
				</div>
			</div>
		{/if}
	</div>

	<!-- Desktop/Tablet Horizontal Frosted Glass Tab Strip (Hidden on mobile where MobileFloatingNav is active) -->
	<nav
		aria-label="Account Modules"
		class="relative z-10 hidden items-center gap-1 overflow-x-auto border-t border-white/10 bg-[#080b13]/75 px-4 backdrop-blur-xl sm:gap-2 sm:px-7 md:flex"
	>
		{#snippet collectionTab()}
			<button
				type="button"
				onclick={() => onSelectModule('inventory')}
				data-active={activeModule === 'inventory'}
				class="hero-tab cursor-pointer"
			>
				<Backpack
					class="h-4 w-4 transition-transform duration-200 {activeModule === 'inventory'
						? 'scale-110 text-neu-accent'
						: 'text-slate-400'}"
				/>
				<span>Collection</span>
				{#if ownedSkinCount !== null}
					<span
						class="rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-300 tabular-nums"
					>
						{ownedSkinCount}
					</span>
				{/if}
			</button>
		{/snippet}
		{#if readOnly}
			{@render collectionTab()}
		{/if}
		<button
			type="button"
			onclick={() => onSelectModule('tracker')}
			data-active={activeModule === 'tracker'}
			class="hero-tab cursor-pointer"
		>
			<Activity
				class="h-4 w-4 transition-transform duration-200 {activeModule === 'tracker'
					? 'scale-110 text-neu-accent'
					: 'text-slate-400'}"
			/>
			<span>{readOnly ? 'Stats' : 'Overview & Tracker'}</span>
			{#if !readOnly && matchSampleCount !== null && matchSampleCount > 0}
				<span
					class="rounded-full bg-white/[0.07] px-2 py-0.5 font-mono text-[10px] font-semibold text-slate-300 tabular-nums"
				>
					{matchSampleCount}
				</span>
			{/if}
		</button>

		{#if !readOnly}
			<button
				type="button"
				onclick={() => onSelectModule('shop')}
				data-active={activeModule === 'shop'}
				class="hero-tab cursor-pointer"
			>
				<Store
					class="h-4 w-4 transition-transform duration-200 {activeModule === 'shop'
						? 'scale-110 text-neu-accent'
						: 'text-slate-400'}"
				/>
				<span>Daily Shop</span>
				{#if shopCountdown}
					<span
						class="hidden items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-slate-300 tabular-nums sm:inline-flex"
					>
						<Clock class="h-2.5 w-2.5 text-neu-accent" />
						{shopCountdown}
					</span>
				{/if}
			</button>
		{/if}

		{#if !readOnly}
			{@render collectionTab()}
		{/if}
	</nav>
</section>
