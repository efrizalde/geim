<script lang="ts">
	import {
		ArrowUpDown,
		Check,
		ChevronDown,
		Film,
		Info,
		Lock,
		Rotate3d,
		Search,
		X
	} from '@lucide/svelte';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { resolveRaritySpec, type RarityVisualSpec } from '#lib/rarity.js';
	import type { HydratedOwnedSkin } from '#lib/server/providers/valorant/service.js';
	import RarityCardShell from './RarityCardShell.svelte';
	import RarityWeaponChamber from './RarityWeaponChamber.svelte';
	import type { SkinInspectorPayload } from './SkinInspectorModal.svelte';
	import StarLevelIndicator from './StarLevelIndicator.svelte';

	type InvFilter = 'all' | 'store' | 'battle_pass' | 'melee' | 'variants' | 'maxed';
	type TierFilterKey = Exclude<RarityVisualSpec['key'], 'standard'> | null;
	type InvSort =
		'price_desc' | 'price_asc' | 'levels_desc' | 'tier_desc' | 'name_asc' | 'weapon_asc';

	interface Props {
		inventory: {
			rawSkinLevelCount: number;
			rawChromaCount: number;
			buddyCount: number | null;
			ownedSkins: HydratedOwnedSkin[];
			valuation: {
				ownedBaseSkinCount: number;
				pricedBaseSkinCount: number;
				unpricedBaseSkinCount: number;
				isPartial: boolean;
				knownVpSubtotal: number;
				formattedEstimate: string | null;
				packBasisLabel: string;
				fxBasisLabel: string | null;
			};
		};
		vpIconUrl: string;
		onInspectSkin: (payload: SkinInspectorPayload) => void;
	}

	let { inventory, vpIconUrl, onInspectSkin }: Props = $props();

	let invSearch = $state('');
	let invFilter = $state<InvFilter>('all');
	let selectedTierKey = $state<TierFilterKey>(null);
	let invSort = $state<InvSort>('price_desc');
	let page = $state(1);
	const PAGE_SIZE = 12;
	let sortMenuOpen = $state(false);
	let selectedChromaBySkin = $state<
		Record<
			string,
			{
				render: string;
				name: string;
				unlocked: boolean;
				chromaUuid?: string;
				levelNumber?: number;
			}
		>
	>({});

	const val = $derived(inventory.valuation);

	const TIER_DEFINITIONS: Array<{
		key: Exclude<RarityVisualSpec['key'], 'standard'>;
		label: string;
		shortLabel: string;
		uuid: string;
		primaryHex: string;
		glowRgba: string;
	}> = [
		{
			key: 'select',
			label: 'Select',
			shortLabel: 'Select',
			uuid: '12683d76-48d7-84a3-4e09-6985794f0445',
			primaryHex: '#5a9fe2',
			glowRgba: 'rgba(90, 159, 226, 0.24)'
		},
		{
			key: 'deluxe',
			label: 'Deluxe',
			shortLabel: 'Deluxe',
			uuid: '0cebb8be-46d7-c12a-d306-e9907bfc5a25',
			primaryHex: '#18c9b5',
			glowRgba: 'rgba(24, 201, 181, 0.26)'
		},
		{
			key: 'premium',
			label: 'Premium',
			shortLabel: 'Premium',
			uuid: '60bca009-4182-7998-dee7-b8a2558dc369',
			primaryHex: '#eb6aa8',
			glowRgba: 'rgba(235, 106, 168, 0.3)'
		},
		{
			key: 'exclusive',
			label: 'Exclusive',
			shortLabel: 'Excl.',
			uuid: 'e046854e-406c-37f4-6607-19a9ba8426fc',
			primaryHex: '#ff9b54',
			glowRgba: 'rgba(255, 155, 84, 0.32)'
		},
		{
			key: 'ultra',
			label: 'Ultra',
			shortLabel: 'Ultra',
			uuid: '411e4a55-4e59-7757-41f0-86a53f101bb5',
			primaryHex: '#ffe066',
			glowRgba: 'rgba(255, 224, 102, 0.36)'
		}
	];

	const rarityBreakdown = $derived.by(() => {
		const counts: Record<RarityVisualSpec['key'], number> = {
			standard: 0,
			select: 0,
			deluxe: 0,
			premium: 0,
			exclusive: 0,
			ultra: 0
		};
		const observedIcons: Partial<Record<RarityVisualSpec['key'], string>> = {};

		for (const skin of inventory.ownedSkins) {
			const spec = resolveRaritySpec(skin.tier);
			counts[spec.key] += 1;
			if (skin.tier?.iconUrl && !observedIcons[spec.key]) {
				observedIcons[spec.key] = skin.tier.iconUrl;
			}
		}

		return {
			tiers: TIER_DEFINITIONS.map((def) => ({
				...def,
				count: counts[def.key],
				iconUrl:
					observedIcons[def.key] ??
					`https://media.valorant-api.com/contenttiers/${def.uuid}/displayicon.png`
			})),
			standardCount: counts.standard
		};
	});

	const pricedCoveragePct = $derived(
		val.ownedBaseSkinCount > 0
			? Math.min(100, Math.round((val.pricedBaseSkinCount / val.ownedBaseSkinCount) * 100))
			: 0
	);

	// True VALORANT ContentTier progression: Select (1) < Deluxe (2) < Premium (3) < Exclusive (4) < Ultra (5)
	const TIER_RANK: Record<string, number> = {
		Ultra: 5,
		Exclusive: 4,
		Premium: 3,
		Deluxe: 2,
		Select: 1
	};

	const collectionMix = $derived.by(() => {
		let storeCount = 0;
		let bpCount = 0;
		let meleeCount = 0;
		let crownSkin: HydratedOwnedSkin | null = null;

		for (const skin of inventory.ownedSkins) {
			if (skin.source === 'store') storeCount += 1;
			if (skin.source === 'battle_pass') bpCount += 1;
			if (skin.isMelee) meleeCount += 1;

			if (!crownSkin) {
				crownSkin = skin;
			} else {
				const curVp = skin.vpPrice ?? -1;
				const bestVp = crownSkin.vpPrice ?? -1;
				const curRank = skin.tier?.rank ?? TIER_RANK[skin.tier?.devName ?? ''] ?? 0;
				const bestRank = crownSkin.tier?.rank ?? TIER_RANK[crownSkin.tier?.devName ?? ''] ?? 0;
				if (curVp > bestVp || (curVp === bestVp && curRank > bestRank)) {
					crownSkin = skin;
				}
			}
		}

		return {
			storeCount,
			bpCount,
			meleeCount,
			crownSkin
		};
	});

	function toggleOriginFilter(target: 'store' | 'battle_pass' | 'melee') {
		invFilter = invFilter === target ? 'all' : target;
	}

	const filteredAndSortedSkins = $derived.by(() => {
		const q = invSearch.trim().toLowerCase();
		const filtered = inventory.ownedSkins.filter((skin) => {
			if (selectedTierKey && resolveRaritySpec(skin.tier).key !== selectedTierKey) return false;
			if (invFilter === 'store' && skin.source !== 'store') return false;
			if (invFilter === 'battle_pass' && skin.source !== 'battle_pass') return false;
			if (invFilter === 'melee' && !skin.isMelee) return false;
			if (invFilter === 'variants' && skin.totalChromas <= 1) return false;
			if (
				invFilter === 'maxed' &&
				!(skin.totalLevels > 1 && skin.unlockedLevels >= skin.totalLevels)
			) {
				return false;
			}
			if (
				q &&
				!skin.displayName.toLowerCase().includes(q) &&
				!skin.weaponName.toLowerCase().includes(q)
			) {
				return false;
			}
			return true;
		});

		return [...filtered].sort((a, b) => {
			if (invSort === 'price_desc') {
				const diff = (b.vpPrice ?? -1) - (a.vpPrice ?? -1);
				return diff !== 0 ? diff : a.displayName.localeCompare(b.displayName);
			}
			if (invSort === 'price_asc') {
				const aPrice = a.vpPrice ?? Number.MAX_SAFE_INTEGER;
				const bPrice = b.vpPrice ?? Number.MAX_SAFE_INTEGER;
				return aPrice !== bPrice ? aPrice - bPrice : a.displayName.localeCompare(b.displayName);
			}
			if (invSort === 'levels_desc') {
				if (b.unlockedLevels !== a.unlockedLevels) return b.unlockedLevels - a.unlockedLevels;
				if (b.totalLevels !== a.totalLevels) return b.totalLevels - a.totalLevels;
				return a.displayName.localeCompare(b.displayName);
			}
			if (invSort === 'tier_desc') {
				const tA = a.tier?.rank ?? TIER_RANK[a.tier?.devName ?? ''] ?? 0;
				const tB = b.tier?.rank ?? TIER_RANK[b.tier?.devName ?? ''] ?? 0;
				if (tB !== tA) return tB - tA;
				return (b.vpPrice ?? -1) - (a.vpPrice ?? -1);
			}
			if (invSort === 'weapon_asc') {
				const w = a.weaponName.localeCompare(b.weaponName);
				return w !== 0 ? w : a.displayName.localeCompare(b.displayName);
			}
			return a.displayName.localeCompare(b.displayName);
		});
	});

	const pageCount = $derived(Math.max(1, Math.ceil(filteredAndSortedSkins.length / PAGE_SIZE)));
	const currentPage = $derived(Math.min(page, pageCount));
	const visibleSkins = $derived(
		filteredAndSortedSkins.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
	);
	$effect(() => {
		invSearch;
		invFilter;
		selectedTierKey;
		invSort;
		page = 1;
	});

	const filterTabs: Array<{ id: InvFilter; label: string }> = [
		{ id: 'all', label: 'All' },
		{ id: 'store', label: 'Store' },
		{ id: 'battle_pass', label: 'Battle Pass' },
		{ id: 'melee', label: 'Melee' },
		{ id: 'variants', label: 'Has Variants' },
		{ id: 'maxed', label: 'Max Stars' }
	];

	const sortOptions: Array<{ id: InvSort; label: string }> = [
		{ id: 'price_desc', label: 'Price: High to Low' },
		{ id: 'price_asc', label: 'Price: Low to High' },
		{ id: 'levels_desc', label: 'Upgrade Stars' },
		{ id: 'tier_desc', label: 'Rarity Tier' },
		{ id: 'name_asc', label: 'Name: A to Z' },
		{ id: 'weapon_asc', label: 'Weapon: A to Z' }
	];

	const activeSortLabel = $derived(
		sortOptions.find((option) => option.id === invSort)?.label ?? 'Price: High to Low'
	);

	function toggleTierFilter(key: Exclude<RarityVisualSpec['key'], 'standard'>) {
		selectedTierKey = selectedTierKey === key ? null : key;
	}

	function openSkinModal(
		skin: HydratedOwnedSkin,
		opts: {
			initialView?: '360' | 'video';
			initialLevelNumber?: number;
			initialChromaUuid?: string;
		} = {}
	) {
		const active = selectedChromaBySkin[skin.skinUuid];
		onInspectSkin({
			skinName: skin.displayName,
			weaponName: skin.weaponName,
			mode: 'inventory',
			skinUuid: skin.skinUuid,
			defaultIcon: skin.displayIcon,
			levels: skin.levels,
			chromas: skin.chromas,
			tier: skin.tier,
			vpPrice: skin.vpPrice,
			fiatEstimate: skin.fiatEstimate,
			vpIconUrl,
			initialView: opts.initialView ?? '360',
			initialLevelNumber: opts.initialLevelNumber ?? active?.levelNumber,
			initialChromaUuid: opts.initialChromaUuid ?? active?.chromaUuid
		});
	}
</script>

<svelte:window
	onclick={(e) => {
		const target = e.target as HTMLElement | null;
		if (sortMenuOpen && target && !target.closest('[data-sort-dropdown]')) {
			sortMenuOpen = false;
		}
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape' && sortMenuOpen) {
			sortMenuOpen = false;
		}
	}}
/>

<section class="flex flex-col gap-5">
	<!-- Frosted Glass × Neumorphic Valuation & Collection Telemetry Deck -->
	<div
		class="glass-neu grid gap-3 rounded-2xl p-3.5 sm:gap-4 sm:p-5 lg:grid-cols-12 lg:items-stretch"
	>
		<!-- Left (5 cols): Framed Atmospheric Valuation Vault + Origin Mix + Basis -->
		<div
			class="neu-well relative flex flex-col justify-between gap-3.5 overflow-hidden rounded-xl p-4 sm:p-5 lg:col-span-5"
			style="background: radial-gradient(circle at 88% 14%, rgba(34, 211, 238, 0.12) 0%, transparent 52%), radial-gradient(circle at 10% 0%, rgba(16, 185, 129, 0.08) 0%, transparent 45%), rgba(7, 10, 17, 0.82);"
		>
			<div
				class="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/45 to-transparent"
			></div>

			{#if collectionMix.crownSkin?.displayIcon}
				<img
					src={collectionMix.crownSkin.displayIcon}
					alt=""
					aria-hidden="true"
					class="pointer-events-none absolute -top-2 -right-5 h-24 w-44 -rotate-6 object-contain opacity-[0.09] select-none sm:h-28 sm:w-52"
				/>
			{/if}

			<!-- 1. Estimate Header & Hero Valuation -->
			<div class="relative z-10">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-cyan-200 uppercase"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_6px_#22d3ee]"></span>
						{val.isPartial ? 'Partial Catalog Estimate' : 'Full Catalog Estimate'}
					</span>

					<span
						class="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] font-medium text-slate-300"
						title="Tap any weapon skin card below to inspect in interactive 360° Studio"
					>
						<Rotate3d class="h-3 w-3 text-neu-cyan" />
						<span>360° Studio</span>
					</span>
				</div>

				<div class="mt-2.5 flex flex-wrap items-baseline gap-2.5">
					<h2
						class="font-display text-2xl font-extrabold tracking-tight text-white tabular-nums sm:text-3xl"
					>
						{val.formattedEstimate ?? `${val.knownVpSubtotal.toLocaleString()} VP`}
					</h2>
					<div
						class="neu-well-sm inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.06] px-2.5 py-1 font-mono text-xs font-bold text-cyan-100 tabular-nums"
					>
						<img src={vpIconUrl} alt="VP" class="h-3.5 w-3.5 object-contain" />
						<span>{val.knownVpSubtotal.toLocaleString()} VP</span>
					</div>
				</div>
			</div>

			<!-- 2. Interactive Collection Origin Breakdown (Quick Filter Shortcuts) -->
			<div class="relative z-10 grid grid-cols-3 gap-2">
				{#each [{ id: 'store' as const, label: 'Store', count: collectionMix.storeCount }, { id: 'battle_pass' as const, label: 'Battle Pass', count: collectionMix.bpCount }, { id: 'melee' as const, label: 'Melee', count: collectionMix.meleeCount }] as origin (origin.id)}
					{@const isOriginActive = invFilter === origin.id}
					<button
						type="button"
						onclick={() => toggleOriginFilter(origin.id)}
						aria-pressed={isOriginActive}
						title="Filter collection by {origin.label} ({origin.count})"
						class="neu-well-sm flex cursor-pointer flex-col items-start justify-center rounded-lg px-2.5 py-2 text-left transition-all duration-150 hover:-translate-y-0.5 {isOriginActive
							? 'border-cyan-400/50 bg-cyan-400/12 shadow-[0_0_14px_-4px_rgba(34,211,238,0.35)]'
							: 'hover:border-white/15'}"
					>
						<span
							class="truncate font-mono text-[9px] font-semibold tracking-wider uppercase sm:text-[10px] {isOriginActive
								? 'text-cyan-200'
								: 'text-slate-400'}"
						>
							{origin.label}
						</span>
						<span
							class="mt-0.5 font-display text-sm font-extrabold text-white tabular-nums sm:text-base"
						>
							{origin.count}
						</span>
					</button>
				{/each}
			</div>

			<!-- 3. Integrated Valuation Basis Strip -->
			<div
				class="relative z-10 flex items-start gap-2 border-t border-white/[0.07] pt-3 text-[11px] text-slate-400"
			>
				<Info class="mt-0.5 h-3.5 w-3.5 shrink-0 text-neu-cyan" />
				<div class="min-w-0 leading-relaxed">
					<p class="font-medium text-slate-200">
						{val.packBasisLabel}{#if val.fxBasisLabel}
							<span class="text-slate-400"> · FX: {val.fxBasisLabel}</span>
						{/if}
					</p>
					<p class="mt-0.5 text-[10px] leading-snug text-slate-400/90">
						Proportional catalog estimate (not actual spend or resale). Verified Store VP + 1,000 VP
						Act Pass melees; Agent Gear unlocks at 0 VP.
					</p>
				</div>
			</div>
		</div>

		<!-- Right (7 cols): 2-Row Bento — [Owned Skins + Unlocks Pod] over [Rarity Tier Gems] -->
		<div class="flex flex-col justify-between gap-3 lg:col-span-7">
			<!-- Row 1: Unified Owned Skins (Priced/Unpriced) + Compact Unlocks Telemetry Pod -->
			<div class="grid grid-cols-1 gap-3 sm:grid-cols-12">
				<!-- 1A. Unified Owned Skins Section (Total + Priced & Unpriced in One Section) -->
				<div
					class="neu-well flex flex-col justify-between gap-2.5 rounded-xl p-3.5 sm:col-span-7 sm:px-4"
				>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<div class="flex items-baseline gap-2.5">
							<span
								class="font-display text-2xl leading-none font-extrabold text-white tabular-nums sm:text-[28px]"
							>
								{val.ownedBaseSkinCount}
							</span>
							<div>
								<p class="text-xs leading-tight font-bold text-slate-200">Owned Skins</p>
								<p class="font-mono text-[10px] text-slate-400 tabular-nums">
									{pricedCoveragePct}% catalog priced
								</p>
							</div>
						</div>

						<!-- Combined Priced / Unpriced Pills -->
						<div class="flex flex-wrap items-center gap-1.5">
							<div
								class="neu-well-sm inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 px-2 py-0.5"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]"
								></span>
								<span class="font-mono text-[10px] font-semibold text-slate-300 uppercase">
									Priced
								</span>
								<span class="font-mono text-[11px] font-extrabold text-emerald-300 tabular-nums">
									{val.pricedBaseSkinCount}
								</span>
							</div>

							<div
								class="neu-well-sm inline-flex items-center gap-1.5 rounded-lg border border-amber-400/25 px-2 py-0.5"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
								<span class="font-mono text-[10px] font-semibold text-slate-300 uppercase">
									Unpriced
								</span>
								<span class="font-mono text-[11px] font-extrabold text-amber-300 tabular-nums">
									{val.unpricedBaseSkinCount}
								</span>
							</div>
						</div>
					</div>

					<!-- Proportional Priced vs Unpriced Segmented Coverage Bar -->
					<div class="flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
						{#if val.pricedBaseSkinCount > 0}
							<div
								class="h-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-all duration-500"
								style="width: {(val.pricedBaseSkinCount / Math.max(1, val.ownedBaseSkinCount)) *
									100}%"
							></div>
						{/if}
						{#if val.unpricedBaseSkinCount > 0}
							<div
								class="h-full bg-amber-400/75 transition-all duration-500"
								style="width: {(val.unpricedBaseSkinCount / Math.max(1, val.ownedBaseSkinCount)) *
									100}%"
							></div>
						{/if}
					</div>
				</div>

				<!-- 1B. Divided Unlocks & Buddies Telemetry Pod -->
				<div
					class="neu-well grid grid-cols-3 divide-x divide-white/[0.06] rounded-xl py-3 sm:col-span-5"
				>
					<div
						class="flex flex-col items-center justify-center px-1.5 text-center"
						title="Level Unlocks"
					>
						<span
							class="font-display text-lg leading-tight font-extrabold text-white tabular-nums sm:text-xl"
						>
							{inventory.rawSkinLevelCount}
						</span>
						<span
							class="mt-0.5 font-mono text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Levels
						</span>
					</div>
					<div
						class="flex flex-col items-center justify-center px-1.5 text-center"
						title="Chroma Unlocks"
					>
						<span
							class="font-display text-lg leading-tight font-extrabold text-white tabular-nums sm:text-xl"
						>
							{inventory.rawChromaCount}
						</span>
						<span
							class="mt-0.5 font-mono text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Chromas
						</span>
					</div>
					<div
						class="flex flex-col items-center justify-center px-1.5 text-center"
						title="Gun Buddies"
					>
						<span
							class="font-display text-lg leading-tight font-extrabold text-white tabular-nums sm:text-xl"
						>
							{inventory.buddyCount ?? '—'}
						</span>
						<span
							class="mt-0.5 font-mono text-[9px] font-semibold tracking-wider text-slate-400 uppercase sm:text-[10px]"
						>
							Buddies
						</span>
					</div>
				</div>
			</div>

			<!-- Row 2: Rarity Tier Totals (Official Tier Logo on Top + Total Count Below) -->
			<div class="neu-well flex flex-1 flex-col justify-between gap-2.5 rounded-xl p-3.5 sm:p-4">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="flex items-center gap-2">
						<span class="text-[11px] font-bold tracking-wider text-slate-300 uppercase">
							Owned by Rarity Tier
						</span>
						{#if rarityBreakdown.standardCount > 0}
							<span
								class="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] font-semibold text-slate-400 tabular-nums"
							>
								+{rarityBreakdown.standardCount} Special/BP
							</span>
						{/if}
					</div>

					{#if selectedTierKey}
						<button
							type="button"
							onclick={() => (selectedTierKey = null)}
							class="inline-flex cursor-pointer items-center gap-1 rounded-full border border-white/15 bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-semibold text-white transition hover:bg-white/12"
						>
							<span class="capitalize">{selectedTierKey}</span>
							<X class="h-2.5 w-2.5 text-neu-accent" />
						</button>
					{:else}
						<span class="font-mono text-[10px] text-slate-500">Tap tier to filter</span>
					{/if}
				</div>

				<div class="grid grid-cols-5 gap-1.5 sm:gap-2.5">
					{#each rarityBreakdown.tiers as tier (tier.key)}
						{@const isSelected = selectedTierKey === tier.key}
						<button
							type="button"
							onclick={() => toggleTierFilter(tier.key)}
							aria-pressed={isSelected}
							aria-label="{tier.label} Edition: {tier.count} owned"
							title="{tier.label} Edition ({tier.count} owned) — click to filter"
							class="neu-well-sm group relative flex cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl px-1.5 py-2.5 transition-all duration-180 hover:-translate-y-0.5 sm:py-3 {tier.count ===
								0 && !isSelected
								? 'opacity-50 hover:opacity-85'
								: ''}"
							style="border-color: {isSelected
								? tier.primaryHex
								: 'rgba(255, 255, 255, 0.06)'}; background: radial-gradient(circle at 50% 18%, {tier.glowRgba} 0%, rgba(8, 11, 19, 0.86) 76%); {isSelected
								? `box-shadow: 0 0 18px -3px ${tier.glowRgba}, inset 0 1px 0 rgba(255,255,255,0.22);`
								: ''}"
						>
							<img
								src={tier.iconUrl}
								alt={tier.label}
								class="h-6 w-6 object-contain transition-transform duration-200 group-hover:scale-110 sm:h-7 sm:w-7"
								style="filter: drop-shadow(0 2px 8px {tier.glowRgba});"
							/>
							<span
								class="font-display text-base leading-none font-extrabold text-white tabular-nums sm:text-xl"
							>
								{tier.count}
							</span>
							<span
								class="truncate font-mono text-[9px] font-bold tracking-wider uppercase sm:text-[10px]"
								style="color: {tier.primaryHex}"
							>
								<span class="sm:hidden">{tier.shortLabel}</span>
								<span class="hidden sm:inline">{tier.label}</span>
							</span>
						</button>
					{/each}
				</div>
			</div>
		</div>
	</div>

	<!-- Search, Sort & Horizontal Scrollable Filter Pills Toolbar -->
	<div class="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
		<div class="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
			<!-- Search Input -->
			<div class="neu-well flex items-center rounded-xl px-3.5 py-1 sm:w-72">
				<Search class="mr-2 h-4 w-4 shrink-0 text-slate-400" />
				<input
					type="search"
					aria-label="Search collection"
					bind:value={invSearch}
					placeholder="Search skin or weapon…"
					class="w-full bg-transparent py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none"
				/>
			</div>

			<!-- Sort Selector -->
			<div class="relative" data-sort-dropdown>
				<button
					id="inv-sort"
					type="button"
					onclick={() => (sortMenuOpen = !sortMenuOpen)}
					aria-label="Sort collection"
					aria-expanded={sortMenuOpen}
					aria-haspopup="listbox"
					class="neu-btn flex min-h-11 w-full cursor-pointer items-center justify-between gap-2.5 rounded-xl px-3.5 py-2 text-xs font-semibold text-white sm:w-auto"
				>
					<span class="flex items-center gap-2">
						<ArrowUpDown class="h-3.5 w-3.5 shrink-0 text-neu-cyan" />
						<span class="font-mono text-[10px] font-semibold text-slate-400 uppercase">Sort</span>
						<span>{activeSortLabel}</span>
					</span>
					<ChevronDown
						class="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform {sortMenuOpen
							? 'rotate-180'
							: ''}"
					/>
				</button>

				{#if sortMenuOpen}
					<div
						role="listbox"
						aria-label="Sort collection options"
						class="glass-neu absolute left-0 z-40 mt-2 w-full overflow-hidden rounded-2xl p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.88)] sm:w-60"
					>
						{#each sortOptions as option (option.id)}
							{@const isSelected = invSort === option.id}
							<button
								type="button"
								role="option"
								aria-selected={isSelected}
								onclick={() => {
									invSort = option.id;
									sortMenuOpen = false;
								}}
								class="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition hover:bg-white/[0.06] {isSelected
									? 'bg-neu-accent/15 font-bold text-white'
									: 'text-slate-300'}"
							>
								<span>{option.label}</span>
								{#if isSelected}
									<Check class="h-3.5 w-3.5 shrink-0 text-neu-accent" />
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Segmented Filter Pills (Single-line swipeable on mobile) -->
		<div class="neu-well no-scrollbar flex items-center gap-1 overflow-x-auto rounded-xl p-1">
			{#each filterTabs as tab (tab.id)}
				<button
					type="button"
					onclick={() => (invFilter = tab.id)}
					data-active={invFilter === tab.id}
					class="seg-tab shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap"
				>
					{tab.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Owned Skins Progressive Rarity Collection Grid -->
	{#if filteredAndSortedSkins.length === 0}
		<div
			class="neu-well flex flex-col items-center gap-3 rounded-2xl p-8 text-center text-xs text-slate-400"
		>
			<p>No owned skins match your current search or filter.</p>
			{#if invSearch || invFilter !== 'all' || selectedTierKey}
				<button
					type="button"
					onclick={() => {
						invSearch = '';
						invFilter = 'all';
						selectedTierKey = null;
					}}
					class="neu-btn cursor-pointer rounded-xl px-3.5 py-1.5 text-xs font-semibold text-white"
				>
					Reset Filters
				</button>
			{/if}
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
			{#each visibleSkins as skin, idx (skin.skinUuid)}
				{@const activeChroma = selectedChromaBySkin[skin.skinUuid]}
				{@const activeRender = activeChroma?.render ?? skin.chromas[0]?.render ?? skin.displayIcon}
				<div
					style="--idle-float-delay: -{(idx % 5) * 0.7}s"
					in:fly={{ y: 12, duration: 240, delay: Math.min(idx * 24, 240), easing: cubicOut }}
				>
					<RarityCardShell tier={skin.tier} class="inventory-card h-full gap-3 p-4">
						{#snippet children(spec)}
							<!-- Top Tier & Quick 360 / VFX Inspector Controls -->
							<div class="relative z-10 flex items-center justify-between gap-2">
								<div class="flex min-w-0 items-center gap-1.5">
									{#if skin.tier?.iconUrl}
										<img
											src={skin.tier.iconUrl}
											alt={skin.tier.name}
											class="h-4 w-4 shrink-0 object-contain"
										/>
									{/if}
									<span
										class="truncate font-mono text-[10px] font-bold tracking-wider uppercase"
										style="color: {spec.primaryHex}"
									>
										{skin.tier?.devName ?? 'Battle Pass / Contract'}
									</span>
									{#if skin.source === 'battle_pass'}
										<span
											class="shrink-0 rounded border border-white/12 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] font-semibold text-slate-300"
											title="Battle Pass Skin"
										>
											BP
										</span>
									{:else if skin.source === 'agent_gear'}
										<span
											class="shrink-0 rounded border border-emerald-400/25 bg-emerald-400/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-emerald-300"
											title="Agent Contract Gear"
										>
											GEAR
										</span>
									{/if}
								</div>

								<div class="flex shrink-0 items-center gap-1">
									<button
										type="button"
										onclick={() => openSkinModal(skin, { initialView: '360' })}
										class="neu-btn cursor-pointer rounded-lg p-1.5"
										style="color: {spec.primaryHex}"
										title="Inspect in 360° Studio"
										aria-label="Inspect {skin.displayName} in 360 degrees"
									>
										<Rotate3d class="h-3.5 w-3.5" />
									</button>

									{#if skin.previewVideoUrl || skin.levels.length > 1}
										<button
											type="button"
											onclick={() => openSkinModal(skin, { initialView: 'video' })}
											class="neu-btn cursor-pointer rounded-lg p-1.5 text-neu-cyan"
											title="Watch Upgrade Levels & VFX"
											aria-label="Watch {skin.displayName} level videos"
										>
											<Film class="h-3.5 w-3.5" />
										</button>
									{/if}
								</div>
							</div>

							<!-- Progressive Rarity Weapon Showcase Chamber (Click to open 360° Studio!) -->
							<RarityWeaponChamber
								{spec}
								imageUrl={activeRender}
								alt={activeChroma?.name ?? skin.displayName}
								heightClass="h-36"
								imageMaxHeightClass="max-h-25"
								onOpen360={() => openSkinModal(skin, { initialView: '360' })}
							>
								{#snippet overlay()}
									{#if activeChroma && !activeChroma.unlocked}
										<span
											class="pointer-events-none absolute right-2 bottom-2 z-20 inline-flex items-center gap-1 rounded-md border border-white/10 bg-[#080b12]/90 px-1.5 py-0.5 font-mono text-[9px] text-slate-400"
										>
											<Lock class="h-2.5 w-2.5" />
											Locked Variant
										</span>
									{/if}
								{/snippet}
							</RarityWeaponChamber>

							<!-- Weapon & Skin Name (+ Active Variant Pill if selected) -->
							<div class="relative z-10">
								<div class="flex items-center justify-between gap-2">
									<p
										class="font-mono text-[10px] font-semibold tracking-wider text-slate-400 uppercase"
									>
										{skin.weaponName}
									</p>
									{#if activeChroma}
										<span class="max-w-30 truncate font-mono text-[9px] text-slate-400">
											{activeChroma.name.replace(skin.displayName, '').trim() || 'Base'}
										</span>
									{/if}
								</div>
								<h3
									class="mt-1 line-clamp-1 font-display text-[15px] leading-snug font-bold text-white"
									title={skin.displayName}
								>
									{skin.displayName}
								</h3>
							</div>

							<!-- Interactive Stars + Variant Swatches + BOTH VP Cost & Fiat Estimate -->
							<div
								class="relative z-20 mt-auto flex flex-col gap-2 border-t border-white/10 pt-2"
							>
								<div class="flex min-h-7 flex-wrap items-center justify-between gap-2">
									<StarLevelIndicator
										levels={skin.levels}
										mode="inventory"
										size="xs"
										onSelectLevel={(lvl) => {
											if (lvl.displayIcon) {
												selectedChromaBySkin[skin.skinUuid] = {
													render: lvl.displayIcon,
													name: lvl.displayName,
													unlocked: lvl.unlocked,
													levelNumber: lvl.levelNumber
												};
											}
											openSkinModal(skin, {
												initialView: lvl.hasVideo || lvl.streamedVideo ? 'video' : '360',
												initialLevelNumber: lvl.levelNumber
											});
										}}
									/>

									<!-- Interactive Variant Swatches right on Inventory Card -->
									{#if skin.chromas.length > 1}
										<div class="flex items-center">
											{#each skin.chromas as chroma (chroma.uuid)}
												{#if chroma.swatch && chroma.render}
													<button
														type="button"
														onclick={() =>
															(selectedChromaBySkin[skin.skinUuid] = {
																render: chroma.render!,
																name: chroma.name,
																unlocked: chroma.unlocked,
																chromaUuid: chroma.uuid
															})}
														title="{chroma.name} ({chroma.unlocked ? 'Owned' : 'Locked'})"
														class="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-md transition focus-visible:ring-2 focus-visible:ring-neu-cyan {activeRender ===
														chroma.render
															? 'opacity-100'
															: chroma.unlocked
																? 'opacity-80 hover:opacity-100'
																: 'opacity-40 hover:opacity-85'}"
													>
														<img
															src={chroma.swatch}
															alt={chroma.name}
															class="h-4 w-4 rounded-sm border object-cover {activeRender ===
															chroma.render
																? 'border-white ring-1 ring-white/60'
																: 'border-white/30'}"
														/>
													</button>
												{/if}
											{/each}
										</div>
									{/if}
								</div>

								<!-- Dual VP Price + Estimated Fiat Readout -->
								<div
									class="flex items-center justify-between gap-2 border-t border-white/8 pt-2 text-[11px]"
								>
									{#if skin.vpPrice !== null && skin.vpPrice > 0}
										<div class="flex items-center gap-1.5">
											<img
												src={vpIconUrl}
												alt="VP"
												class="h-3.5 w-3.5 shrink-0 object-contain opacity-95"
											/>
											<span class="font-mono text-xs font-bold text-white tabular-nums">
												{skin.vpPrice.toLocaleString()}
											</span>
											<span class="font-mono text-[9px] font-semibold text-slate-400 uppercase">
												VP
											</span>
										</div>
										{#if skin.fiatEstimate}
											<span
												class="shrink-0 font-mono text-[11px] font-bold text-neu-cyan tabular-nums"
											>
												~{skin.fiatEstimate}
											</span>
										{/if}
									{:else if skin.vpPrice === 0}
										<div class="flex items-center gap-1.5">
											<img
												src={vpIconUrl}
												alt="VP"
												class="h-3.5 w-3.5 shrink-0 object-contain opacity-65"
											/>
											<span class="font-mono text-xs font-bold text-slate-200 tabular-nums">0</span>
											<span class="font-mono text-[9px] font-semibold text-slate-400 uppercase">
												VP
											</span>
										</div>
										<span class="shrink-0 font-mono text-[10px] font-semibold text-emerald-300/90">
											{skin.source === 'agent_gear' ? 'Free · Agent Gear' : 'Free · Event'}
										</span>
									{:else}
										<span class="truncate pr-2 font-mono text-[10px] text-slate-500">
											Special / Event
										</span>
										<span class="shrink-0 font-mono text-[11px] text-slate-500">Unpriced</span>
									{/if}
								</div>
							</div>
						{/snippet}
					</RarityCardShell>
				</div>
			{/each}
		</div>
		{#if pageCount > 1}
			<nav
				aria-label="Collection pagination"
				class="flex flex-wrap items-center justify-center gap-3 pt-4"
			>
				<button
					type="button"
					class="neu-btn min-h-11 rounded-xl px-4 text-sm disabled:opacity-40"
					disabled={currentPage === 1}
					onclick={() => (page = currentPage - 1)}>Previous</button
				>
				<span class="text-sm text-slate-300" aria-live="polite"
					>Page {currentPage} of {pageCount} · {filteredAndSortedSkins.length} skins</span
				>
				<button
					type="button"
					class="neu-btn min-h-11 rounded-xl px-4 text-sm disabled:opacity-40"
					disabled={currentPage === pageCount}
					onclick={() => (page = currentPage + 1)}>Next</button
				>
			</nav>
		{/if}
	{/if}
</section>
