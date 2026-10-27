<script lang="ts">
	import { Clock, Film, Rotate3d, Sparkles } from '@lucide/svelte';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import type { HydratedShopCard } from '#lib/server/providers/valorant/service.js';
	import RarityCardShell from './RarityCardShell.svelte';
	import RarityWeaponChamber from './RarityWeaponChamber.svelte';
	import type { SkinInspectorPayload } from './SkinInspectorModal.svelte';
	import StarLevelIndicator from './StarLevelIndicator.svelte';

	interface Props {
		store: {
			fetchedAt: string;
			isStale: boolean;
			dailyCards: HydratedShopCard[];
			nightMarket: {
				active: boolean;
				cards: HydratedShopCard[];
			};
		};
		vpIconUrl: string;
		shopCountdown: string;
		nightMarketCountdown: string;
		onInspectSkin: (payload: SkinInspectorPayload) => void;
	}

	let { store, vpIconUrl, shopCountdown, nightMarketCountdown, onInspectSkin }: Props = $props();

	let selectedByOffer = $state<
		Record<string, { render: string; chromaUuid?: string; levelNumber?: number }>
	>({});

	function openCardInspector(
		card: HydratedShopCard,
		opts: {
			initialView?: '360' | 'video';
			initialLevelNumber?: number;
			initialChromaUuid?: string;
		} = {}
	) {
		const active = selectedByOffer[card.offerId];
		onInspectSkin({
			skinName: card.displayName,
			weaponName: card.weaponName,
			mode: 'shop',
			defaultIcon: card.displayIcon,
			levels: card.levels,
			chromas: card.chromas,
			tier: card.tier,
			vpPrice: card.vpPrice,
			fiatEstimate: card.fiatEstimate,
			vpIconUrl,
			initialView: opts.initialView ?? '360',
			initialLevelNumber: opts.initialLevelNumber ?? active?.levelNumber,
			initialChromaUuid: opts.initialChromaUuid ?? active?.chromaUuid
		});
	}
</script>

<section class="flex flex-col gap-5">
	<!-- Section Header + Tactile Countdown Clock -->
	<div class="flex flex-col gap-3 px-0.5 sm:flex-row sm:items-center sm:justify-between">
		<div>
			<div class="flex flex-wrap items-center gap-2">
				<h2 class="font-display text-sm font-bold tracking-wider text-white uppercase sm:text-lg">
					Daily Featured Storefront
				</h2>
				{#if store.isStale}
					<span
						class="rounded-full border border-amber-400/35 bg-amber-400/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-amber-300"
					>
						Expired · Sync Needed
					</span>
				{/if}
			</div>
			<p class="mt-0.5 text-xs text-slate-400">
				Captured {new Date(store.fetchedAt).toLocaleString()} · Tap any weapon for 360° studio
			</p>
		</div>

		<div
			class="neu-well flex items-center justify-between gap-2.5 rounded-xl px-3.5 py-2 sm:justify-start"
		>
			<span class="inline-flex items-center gap-2 text-xs font-medium text-slate-400">
				<Clock class="h-4 w-4 text-neu-accent" />
				<span>Resets in</span>
			</span>
			<span class="font-mono text-sm font-bold text-white tabular-nums">
				{shopCountdown}
			</span>
		</div>
	</div>

	<!-- 4-Card Progressive Rarity Daily Offers Grid -->
	<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
		{#each store.dailyCards as card, idx (card.offerId)}
			{@const activeSel = selectedByOffer[card.offerId]}
			{@const activeRender = activeSel?.render ?? card.chromas[0]?.render ?? card.displayIcon}
			<div in:fly={{ y: 14, duration: 280, delay: idx * 45, easing: cubicOut }}>
				<RarityCardShell tier={card.tier} class="h-full gap-3.5 p-4 sm:p-5">
					{#snippet children(spec)}
						<!-- Top Tier Badge & Quick Inspector Buttons -->
						<div class="relative z-10 flex items-center justify-between gap-2">
							<div class="flex items-center gap-2">
								{#if card.tier?.iconUrl}
									<img
										src={card.tier.iconUrl}
										alt={card.tier.name}
										class="h-4.5 w-4.5 object-contain drop-shadow-sm"
									/>
								{/if}
								<span
									class="font-mono text-[11px] font-bold tracking-wider uppercase"
									style="color: {spec.primaryHex}"
								>
									{card.tier?.devName ?? card.weaponName}
								</span>
							</div>

							<div class="flex items-center gap-1.5">
								<button
									type="button"
									onclick={() => openCardInspector(card, { initialView: '360' })}
									class="neu-btn flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold"
									title="Open 360° Interactive Weapon Preview"
								>
									<Rotate3d class="h-3.5 w-3.5" style="color: {spec.primaryHex}" />
									<span>360°</span>
								</button>

								{#if card.previewVideoUrl || card.levels.length > 1}
									<button
										type="button"
										onclick={() => openCardInspector(card, { initialView: 'video' })}
										class="neu-btn flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-semibold"
										title="Inspect Skin Levels & Finisher Video"
									>
										<Film class="h-3.5 w-3.5 text-neu-cyan" />
										<span>VFX</span>
									</button>
								{/if}
							</div>
						</div>

						<!-- Progressive Rarity Weapon Showcase Chamber (Click to open 360° Studio!) -->
						<RarityWeaponChamber
							{spec}
							imageUrl={activeRender}
							alt={card.displayName}
							heightClass="h-44"
							imageMaxHeightClass="max-h-30"
							onOpen360={() => openCardInspector(card, { initialView: '360' })}
						/>

						<!-- Weapon Title, Interactive Level Stars & Variant Swatches -->
						<div class="relative z-20 flex flex-col gap-2.5">
							<div>
								<p
									class="font-mono text-[10px] font-semibold tracking-wider text-slate-400 uppercase"
								>
									{card.weaponName}
								</p>
								<h3
									class="mt-0.5 line-clamp-1 font-display text-base font-bold text-white"
									title={card.displayName}
								>
									{card.displayName}
								</h3>
							</div>

							<div class="flex min-h-6 flex-wrap items-center justify-between gap-2">
								<StarLevelIndicator
									levels={card.levels}
									mode="shop"
									size="sm"
									onSelectLevel={(lvl) => {
										if (lvl.displayIcon) {
											selectedByOffer[card.offerId] = {
												render: lvl.displayIcon,
												levelNumber: lvl.levelNumber
											};
										}
										openCardInspector(card, {
											initialView: lvl.streamedVideo ? 'video' : '360',
											initialLevelNumber: lvl.levelNumber
										});
									}}
								/>

								{#if card.chromas.length > 1}
									<div class="flex items-center gap-1.5">
										{#each card.chromas as chroma (chroma.uuid)}
											{#if chroma.swatch && chroma.render}
												<button
													type="button"
													onclick={() =>
														(selectedByOffer[card.offerId] = {
															render: chroma.render!,
															chromaUuid: chroma.uuid
														})}
													title={chroma.name}
													class="h-7 w-7 cursor-pointer overflow-hidden rounded-md border transition focus-visible:ring-2 focus-visible:ring-neu-cyan {activeRender ===
													chroma.render
														? 'scale-110 border-white shadow-[0_0_8px_rgba(255,255,255,0.45)]'
														: 'border-white/20 opacity-75 hover:opacity-100'}"
												>
													<img
														src={chroma.swatch}
														alt={chroma.name}
														class="h-full w-full object-cover"
													/>
												</button>
											{/if}
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<!-- Sunken Neumorphic Price & Fiat Estimate Footer -->
						<div
							class="neu-well-sm relative z-10 mt-auto flex items-center justify-between rounded-xl px-3.5 py-2.5"
						>
							<div class="flex items-center gap-2">
								<img src={vpIconUrl} alt="VP" class="h-4 w-4 object-contain" />
								<span class="font-mono text-sm font-bold text-white tabular-nums">
									{card.vpPrice !== null ? card.vpPrice.toLocaleString() : '—'}
								</span>
								<span class="font-mono text-[10px] font-semibold text-slate-400 uppercase">VP</span>
							</div>
							{#if card.fiatEstimate}
								<span class="font-mono text-xs font-semibold text-neu-cyan tabular-nums">
									~{card.fiatEstimate}
								</span>
							{/if}
						</div>
					{/snippet}
				</RarityCardShell>
			</div>
		{/each}
	</div>

	<!-- Night Market (BonusStore) Frosted Glass Panel -->
	<div class="glass-neu flex flex-col gap-4 rounded-2xl p-5 sm:p-6">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<div class="flex items-center gap-3">
				<div class="neu-well-sm rounded-xl p-2.5 text-neu-violet">
					<Sparkles class="h-5 w-5" />
				</div>
				<div>
					<h3
						class="font-display text-sm font-bold tracking-wider text-white uppercase sm:text-base"
					>
						Night Market
					</h3>
					<p class="text-xs text-slate-400">
						Conditional <code class="font-mono text-slate-300">BonusStore</code> rotational discounts
					</p>
				</div>
			</div>

			{#if store.nightMarket.active}
				<div class="neu-well rounded-xl px-3.5 py-1.5 font-mono text-xs text-neu-cyan tabular-nums">
					Ends in {nightMarketCountdown}
				</div>
			{/if}
		</div>

		{#if store.nightMarket.active}
			<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{#each store.nightMarket.cards as nm (nm.offerId)}
					<RarityCardShell tier={nm.tier} class="gap-3.5 p-4">
						{#snippet children(spec)}
							<div class="relative z-10 flex items-center justify-between">
								<div class="flex items-center gap-1.5">
									{#if nm.tier?.iconUrl}
										<img src={nm.tier.iconUrl} alt={nm.tier.name} class="h-4 w-4 object-contain" />
									{/if}
									<span
										class="font-mono text-xs font-bold uppercase"
										style="color: {spec.primaryHex}"
									>
										{nm.tier?.devName ?? nm.weaponName}
									</span>
								</div>
								{#if nm.discountPercent}
									<span
										class="rounded-full border border-emerald-400/30 bg-emerald-400/12 px-2.5 py-0.5 font-mono text-xs font-bold text-emerald-300 tabular-nums"
									>
										-{nm.discountPercent}%
									</span>
								{/if}
							</div>

							<RarityWeaponChamber
								{spec}
								imageUrl={nm.chromas[0]?.render ?? nm.displayIcon}
								alt={nm.displayName}
								heightClass="h-34"
								imageMaxHeightClass="max-h-24"
								onOpen360={() => openCardInspector(nm, { initialView: '360' })}
							/>

							<div class="relative z-20 flex items-center justify-between gap-2">
								<h4 class="line-clamp-1 font-display text-sm font-bold text-white">
									{nm.displayName}
								</h4>
								<StarLevelIndicator
									levels={nm.levels}
									mode="shop"
									size="xs"
									onSelectLevel={(lvl) =>
										openCardInspector(nm, {
											initialView: lvl.streamedVideo ? 'video' : '360',
											initialLevelNumber: lvl.levelNumber
										})}
								/>
							</div>

							<div
								class="neu-well-sm relative z-10 flex items-center justify-between rounded-xl px-3 py-2 text-xs"
							>
								<div class="flex items-center gap-2">
									<img src={vpIconUrl} alt="VP" class="h-3.5 w-3.5 object-contain" />
									<span class="font-mono font-bold text-white tabular-nums">
										{nm.vpPrice?.toLocaleString() ?? '—'}
									</span>
									{#if nm.baseVpPrice}
										<span class="font-mono text-slate-500 tabular-nums line-through">
											{nm.baseVpPrice.toLocaleString()}
										</span>
									{/if}
								</div>
								{#if nm.fiatEstimate}
									<span class="font-mono font-semibold text-neu-cyan tabular-nums">
										~{nm.fiatEstimate}
									</span>
								{/if}
							</div>
						{/snippet}
					</RarityCardShell>
				{/each}
			</div>
		{:else}
			<div class="neu-well rounded-xl px-4 py-3 text-xs text-slate-400">
				No active Night Market right now (<code class="font-mono text-slate-300">BonusStore</code> is
				absent in the current storefront snapshot).
			</div>
		{/if}
	</div>
</section>
