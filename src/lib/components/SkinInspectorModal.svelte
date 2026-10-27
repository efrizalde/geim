<script lang="ts">
	import { Film, Lock, Play, Rotate3d, Sparkles, Star, X } from '@lucide/svelte';
	import gsap from 'gsap';
	import type { TierMetadata } from '#lib/server/providers/valorant/assets.js';
	import type {
		HydratedChromaItem,
		HydratedSkinLevelItem
	} from '#lib/server/providers/valorant/service.js';
	import { resolveRaritySpec } from '#lib/rarity.js';
	import Weapon360Stage from './Weapon360Stage.svelte';

	export interface SkinInspectorPayload {
		skinName: string;
		weaponName: string;
		mode: 'shop' | 'inventory';
		/** Inventory skins omit level/chroma media in the list payload; owner fetches on open. */
		skinUuid?: string;
		defaultIcon: string | null;
		levels: HydratedSkinLevelItem[];
		chromas: HydratedChromaItem[];
		tier?: TierMetadata | null;
		vpPrice?: number | null;
		fiatEstimate?: string | null;
		vpIconUrl?: string;
		initialView?: '360' | 'video';
		initialLevelNumber?: number;
		initialChromaUuid?: string;
	}

	interface Props {
		target: SkinInspectorPayload;
		onClose: () => void;
	}

	// skinUuid is consumed by the parent while fetching inventory details.
	// eslint-disable-next-line svelte/no-unused-props
	let { target, onClose }: Props = $props();

	let modalPanelEl = $state<HTMLDivElement | null>(null);

	type ActiveSelection =
		{ kind: 'level'; levelNumber: number } | { kind: 'chroma'; chromaUuid: string };

	let userSelection = $state<ActiveSelection | null>(null);
	let userStageMode = $state<'360' | 'video' | null>(null);

	const spec = $derived(resolveRaritySpec(target.tier));

	const selection = $derived<ActiveSelection>(
		userSelection ??
			(target.initialChromaUuid
				? { kind: 'chroma', chromaUuid: target.initialChromaUuid }
				: {
						kind: 'level',
						levelNumber:
							target.initialLevelNumber ??
							(target.initialView === '360'
								? (target.levels[0]?.levelNumber ?? 1)
								: (target.levels[target.levels.length - 1]?.levelNumber ?? 1))
					})
	);

	// Prefer highest-res fullRender from base chroma when inspecting Level 1 in 360° mode
	const baseHighResRender = $derived(
		target.chromas[0]?.render ?? target.defaultIcon ?? target.levels[0]?.displayIcon ?? null
	);

	const activeMedia = $derived.by(() => {
		if (selection.kind === 'chroma') {
			const c = target.chromas.find((x) => x.uuid === selection.chromaUuid);
			if (c) {
				return {
					label: c.name,
					badge:
						target.mode === 'inventory'
							? c.unlocked
								? 'Owned Variant'
								: 'Locked Variant'
							: 'Variant',
					videoUrl: c.streamedVideo,
					imageUrl: c.render ?? baseHighResRender
				};
			}
		}

		const lvlNum = selection.kind === 'level' ? selection.levelNumber : 1;
		const lvl = target.levels.find((x) => x.levelNumber === lvlNum) ?? target.levels[0];
		if (!lvl) {
			return {
				label: target.skinName,
				badge: 'Base Model',
				videoUrl: null,
				imageUrl: baseHighResRender
			};
		}

		const levelImg =
			lvl.levelNumber === 1
				? (baseHighResRender ?? lvl.displayIcon)
				: (lvl.displayIcon ?? baseHighResRender);

		return {
			label: `Level ${lvl.levelNumber} · ${lvl.effectLabel}`,
			badge:
				target.mode === 'inventory'
					? lvl.unlocked
						? 'Unlocked'
						: 'Locked'
					: lvl.levelNumber === 1
						? 'Included Base'
						: 'Radianite Upgrade',
			videoUrl: lvl.streamedVideo,
			imageUrl: levelImg
		};
	});

	const stageMode = $derived<'360' | 'video'>(
		userStageMode ?? (target.initialView === 'video' && activeMedia.videoUrl ? 'video' : '360')
	);

	// Smooth GSAP entrance for the big showcase modal
	$effect(() => {
		const el = modalPanelEl;
		if (!el || typeof window === 'undefined') return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		gsap.fromTo(
			el,
			{ opacity: 0, y: 18, scale: 0.96 },
			{ opacity: 1, y: 0, scale: 1, duration: 0.32, ease: 'power3.out' }
		);
	});
</script>

<div
	bind:this={modalPanelEl}
	class="glass-neu relative my-auto flex w-full max-w-4xl flex-col gap-4 rounded-2xl p-4 sm:p-6"
	style="border-color: {spec.borderBaseRgba}; box-shadow: 0 28px 64px -12px rgba(0,0,0,0.92), 0 0 42px -8px {spec.glowRgba};"
>
	<!-- Top Specular Rarity Line -->
	<div
		class="pointer-events-none absolute inset-x-6 top-0 h-[1.5px]"
		style="background: linear-gradient(90deg, transparent, {spec.primaryHex}, transparent);"
	></div>

	<!-- Header: Tier Badge + Title + Price Pill + 360/Video Mode Switcher + Close -->
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<div class="flex flex-wrap items-center gap-2">
				{#if target.tier?.iconUrl}
					<img src={target.tier.iconUrl} alt={target.tier.name} class="h-4 w-4 object-contain" />
				{/if}
				<span
					class="font-mono text-[10px] font-bold tracking-widest uppercase"
					style="color: {spec.primaryHex}"
				>
					{target.tier?.devName ?? 'Battle Pass / Event'}
				</span>
				<span class="text-white/20">·</span>
				<span class="font-mono text-[10px] font-semibold tracking-widest text-slate-400 uppercase">
					{target.weaponName}
				</span>
			</div>
			<h3 class="mt-0.5 font-display text-xl font-bold text-white sm:text-2xl">
				{target.skinName}
			</h3>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<!-- VP & Fiat Price Readout if available -->
			{#if target.vpPrice !== undefined && target.vpPrice !== null}
				<div class="neu-well-sm flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs">
					{#if target.vpIconUrl}
						<img src={target.vpIconUrl} alt="VP" class="h-3.5 w-3.5 object-contain" />
					{/if}
					<span class="font-mono font-bold text-white tabular-nums">
						{target.vpPrice.toLocaleString()} VP
					</span>
					{#if target.fiatEstimate}
						<span class="text-white/20">·</span>
						<span class="font-mono font-semibold text-neu-cyan tabular-nums">
							~{target.fiatEstimate}
						</span>
					{/if}
				</div>
			{/if}

			<!-- Segmented 360° Studio vs Video Preview Switcher -->
			<div class="neu-well-sm flex items-center gap-1 rounded-xl p-1">
				<button
					type="button"
					onclick={() => (userStageMode = '360')}
					data-active={stageMode === '360'}
					class="seg-tab flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold"
				>
					<Rotate3d class="h-3.5 w-3.5" />
					<span>360° View</span>
				</button>
				<button
					type="button"
					disabled={!activeMedia.videoUrl}
					onclick={() => {
						if (activeMedia.videoUrl) userStageMode = 'video';
					}}
					data-active={stageMode === 'video'}
					class="seg-tab flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold {activeMedia.videoUrl
						? 'cursor-pointer'
						: 'cursor-not-allowed opacity-40'}"
					title={activeMedia.videoUrl
						? 'Watch in-game level/finisher video'
						: 'No video available for this selection'}
				>
					<Film class="h-3.5 w-3.5" />
					<span>Video</span>
				</button>
			</div>

			<button
				type="button"
				data-inspector-close
				onclick={onClose}
				class="neu-btn cursor-pointer rounded-xl p-2 text-slate-400 hover:text-white"
				aria-label="Close inspector"
			>
				<X class="h-4 w-4" />
			</button>
		</div>
	</div>

	<!-- Active Showcase Stage: Three.js 360° Interactive Studio OR Upgrade Video -->
	<div class="neu-well relative overflow-hidden rounded-xl bg-black">
		{#if stageMode === 'video' && activeMedia.videoUrl}
			{#key activeMedia.videoUrl}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					src={activeMedia.videoUrl}
					controls
					autoplay
					playsinline
					class="aspect-video w-full bg-black object-contain"
				></video>
			{/key}
		{:else}
			<Weapon360Stage
				imageUrl={activeMedia.imageUrl}
				label={activeMedia.label}
				tier={target.tier}
			/>
		{/if}

		<div
			class="flex flex-wrap items-center justify-between gap-2 border-t border-white/8 bg-[#090d16]/95 px-4 py-2.5 text-xs"
		>
			<span class="inline-flex items-center gap-2 font-semibold text-white">
				<Sparkles class="h-3.5 w-3.5" style="color: {spec.primaryHex}" />
				{activeMedia.label}
			</span>

			<div class="flex items-center gap-2">
				{#if stageMode === '360' && activeMedia.videoUrl}
					<button
						type="button"
						onclick={() => (userStageMode = 'video')}
						class="inline-flex cursor-pointer items-center gap-1 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-neu-cyan transition hover:bg-cyan-400/20"
					>
						<Play class="h-2.5 w-2.5 fill-current" />
						<span>Watch Finisher / VFX</span>
					</button>
				{/if}
				<span
					class="rounded-full bg-white/[0.07] px-2.5 py-0.5 font-mono text-[10px] text-slate-300"
				>
					{activeMedia.badge}
				</span>
			</div>
		</div>
	</div>

	<!-- Chroma Variants Selector (Click any variant to rotate it live in 360°!) -->
	{#if target.chromas.length > 1}
		<div class="flex flex-col gap-2">
			<p class="font-mono text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
				Color Variants ({target.chromas.length}) · Click to swap model
			</p>
			<div class="flex flex-wrap gap-2">
				{#each target.chromas as chroma (chroma.uuid)}
					{@const isActive = selection.kind === 'chroma' && selection.chromaUuid === chroma.uuid}
					<button
						type="button"
						onclick={() => {
							userSelection = { kind: 'chroma', chromaUuid: chroma.uuid };
							if (stageMode === 'video' && !chroma.streamedVideo) {
								userStageMode = '360';
							}
						}}
						data-active={isActive}
						class="neu-btn flex cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-xs"
					>
						{#if chroma.swatch}
							<img
								src={chroma.swatch}
								alt=""
								class="h-4 w-4 rounded-sm border border-white/20 object-cover"
							/>
						{/if}
						<span class="max-w-44 truncate font-medium">{chroma.name}</span>
						{#if target.mode === 'inventory' && !chroma.unlocked}
							<Lock class="h-3 w-3 text-slate-500" />
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Level Selector Pills -->
	{#if target.levels.length > 0}
		<div class="flex flex-col gap-2">
			<p class="font-mono text-[10px] font-semibold tracking-wider text-slate-400 uppercase">
				Upgrade Levels ({target.levels.length})
			</p>
			<div class="grid gap-2 sm:grid-cols-2 md:grid-cols-4">
				{#each target.levels as lvl (lvl.uuid)}
					{@const isActive =
						selection.kind === 'level' && selection.levelNumber === lvl.levelNumber}
					<button
						type="button"
						onclick={() => {
							userSelection = { kind: 'level', levelNumber: lvl.levelNumber };
							if (lvl.streamedVideo && lvl.levelNumber > 1) {
								userStageMode = 'video';
							}
						}}
						data-active={isActive}
						class="neu-btn flex cursor-pointer items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs"
					>
						<div class="min-w-0">
							<div class="flex items-center gap-1.5">
								<Star
									class="h-3 w-3 shrink-0 {(
										target.mode === 'inventory' ? lvl.unlocked : lvl.levelNumber === 1
									)
										? 'fill-amber-400 text-amber-400'
										: 'text-slate-400'}"
								/>
								<span class="font-mono text-[10px] font-bold text-slate-300">
									LVL {lvl.levelNumber}
								</span>
							</div>
							<p class="mt-0.5 truncate font-semibold text-white">{lvl.effectLabel}</p>
						</div>
						{#if lvl.streamedVideo}
							<Play class="h-3 w-3 shrink-0 text-neu-cyan" />
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
