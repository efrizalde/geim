<script lang="ts">
	import { Clock } from '@lucide/svelte';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import InventorySection from '#lib/components/InventorySection.svelte';
	import MobileFloatingNav from '#lib/components/MobileFloatingNav.svelte';
	import ProfileHero, { type ModuleKey } from '#lib/components/ProfileHero.svelte';
	import SkinInspectorModal, {
		type SkinInspectorPayload
	} from '#lib/components/SkinInspectorModal.svelte';
	import SharedStatsSection from '#lib/components/SharedStatsSection.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let activeModule = $state<ModuleKey>('inventory');
	let tabDirection = $state<1 | -1>(1);
	let inspectorTarget = $state<SkinInspectorPayload | null>(null);
	const snapshot = $derived(data.snapshot);

	function selectModule(mod: ModuleKey) {
		if (mod !== activeModule) {
			tabDirection = mod === 'tracker' ? 1 : -1;
			activeModule = mod;
		}
	}
</script>

<svelte:head>
	<title>{snapshot.account.gameName}#{snapshot.account.tagLine} | geim Shared Profile</title>
	<meta name="robots" content="noindex, nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<header class="sticky top-0 z-40 border-b border-white/[0.07] bg-[#070a11]/84 backdrop-blur-2xl">
	<div
		class="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8"
	>
		<BrandLogo size="sm" subtitle="VALORANT Deck" />
		<h1
			class="neu-well-sm inline-flex items-center gap-2 rounded-full px-3 py-1 font-display text-xs font-bold tracking-wider text-white uppercase sm:text-sm"
		>
			<span class="h-1.5 w-1.5 rounded-full bg-neu-cyan shadow-[0_0_8px_#22d3ee]"></span>
			<span>Shared Profile</span>
		</h1>
	</div>
</header>

<main class="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
	<div
		class="glass-card flex flex-wrap items-center justify-between gap-2 rounded-2xl px-4 py-3 text-xs leading-relaxed text-slate-300"
	>
		<span class="inline-flex items-center gap-2">
			<Clock class="h-3.5 w-3.5 shrink-0 text-neu-cyan" />
			<span>
				Read-only snapshot · Last Riot sync:
				<time datetime={snapshot.account.lastSyncedAt} class="font-mono font-semibold text-white">
					{snapshot.account.lastSyncedAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}
				</time>
			</span>
		</span>
		<span class="text-[11px] text-slate-400">
			Opening this link never syncs live Riot data. Only the owner can publish an update.
		</span>
	</div>

	<ProfileHero
		activeAccount={snapshot.account}
		profile={snapshot.profile}
		currencyIcons={{ vp: snapshot.vpIconUrl, radianite: '', kingdomCredits: '' }}
		wallet={null}
		{activeModule}
		onSelectModule={selectModule}
		readOnly
		relativeSyncText={snapshot.account.lastSyncedAt.replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}
		ownedSkinCount={snapshot.inventory?.valuation.ownedBaseSkinCount ?? null}
	/>

	{#key activeModule}
		<div
			in:fly={{
				x: tabDirection * 22,
				y: 8,
				duration: 280,
				easing: cubicOut
			}}
			class="will-change-transform"
		>
			{#if activeModule === 'tracker'}
				<SharedStatsSection stats={snapshot.stats} profile={snapshot.profile} />
			{:else if snapshot.inventory}
				<InventorySection
					inventory={snapshot.inventory}
					vpIconUrl={snapshot.vpIconUrl}
					onInspectSkin={(payload) => (inspectorTarget = payload)}
				/>
			{:else}
				<p class="glass-neu rounded-2xl p-6 text-xs text-slate-300">
					No inventory was available when this profile was published.
				</p>
			{/if}
		</div>
	{/key}
</main>

<MobileFloatingNav
	{activeModule}
	onSelectModule={selectModule}
	readOnly
	ownedSkinCount={snapshot.inventory?.valuation.ownedBaseSkinCount ?? null}
/>

{#if inspectorTarget}
	<SkinInspectorModal target={inspectorTarget} onClose={() => (inspectorTarget = null)} />
{/if}
