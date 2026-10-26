<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Rotate3d } from '@lucide/svelte';
	import type { RarityVisualSpec } from '#lib/rarity.js';

	interface Props {
		spec: RarityVisualSpec;
		imageUrl: string | null;
		alt: string;
		heightClass?: string;
		imageMaxHeightClass?: string;
		onOpen360?: () => void;
		overlay?: Snippet;
	}

	let {
		spec,
		imageUrl,
		alt,
		heightClass = 'h-38',
		imageMaxHeightClass = 'max-h-27',
		onOpen360,
		overlay
	}: Props = $props();

	// Deterministic horizontal positions & sizes for rising rarity sparks/motes
	const motes = $derived.by(() =>
		Array.from({ length: spec.particleCount }, (_, idx) => {
			const leftPct = 10 + ((idx * 73 + 17) % 80);
			const sizePx = spec.rank >= 5 ? 2.5 + (idx % 3) * 1.4 : 2 + (idx % 3) * 1.1;
			const isAltColor = idx % 3 === 0;
			return {
				id: idx,
				leftPct,
				sizePx,
				color: isAltColor ? spec.tertiaryHex : idx % 2 === 0 ? spec.primaryHex : spec.secondaryHex
			};
		})
	);

	const chamberBg = $derived.by(() => {
		if (spec.rank === 5) {
			return `radial-gradient(circle at 50% 56%, rgba(250, 214, 99, 0.34) 0%, rgba(34, 211, 238, 0.12) 42%, rgba(7, 10, 17, 0.90) 78%)`;
		}
		if (spec.rank === 4) {
			return `radial-gradient(circle at 50% 58%, rgba(249, 115, 22, 0.30) 0%, rgba(255, 70, 85, 0.12) 44%, rgba(7, 10, 17, 0.90) 78%)`;
		}
		if (spec.rank === 3) {
			return `radial-gradient(circle at 50% 58%, rgba(209, 84, 141, 0.28) 0%, rgba(168, 85, 247, 0.11) 45%, rgba(7, 10, 17, 0.89) 76%)`;
		}
		if (spec.rank === 2) {
			return `radial-gradient(circle at 50% 58%, rgba(24, 201, 181, 0.22) 0%, rgba(7, 10, 17, 0.88) 74%)`;
		}
		if (spec.rank === 1) {
			return `radial-gradient(circle at 50% 58%, rgba(90, 159, 226, 0.18) 0%, rgba(7, 10, 17, 0.88) 74%)`;
		}
		return `radial-gradient(circle at 50% 58%, rgba(148, 163, 184, 0.10) 0%, rgba(7, 10, 17, 0.90) 74%)`;
	});
</script>

<button
	type="button"
	onclick={onOpen360}
	disabled={!onOpen360}
	aria-label={onOpen360 ? `Open 360° interactive preview for ${alt}` : alt}
	class="neu-well group/chamber relative flex w-full items-center justify-center overflow-hidden rounded-xl p-3.5 text-left transition duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-neu-cyan/60 {heightClass} {onOpen360
		? 'cursor-pointer'
		: 'cursor-default'}"
	style="background: {chamberBg}; border-color: {spec.rank >= 2
		? spec.borderBaseRgba
		: 'rgba(255,255,255,0.05)'};"
>
	<!-- Breathing Rarity Core Spotlight -->
	{#if spec.rank >= 1}
		<div
			data-rarity-aura
			class="pointer-events-none absolute inset-2 rounded-full blur-xl"
			style="background: radial-gradient(circle, {spec.glowStrongRgba} 0%, transparent 70%);"
		></div>
	{/if}

	<!-- Rotating Sacred/Tactical Geometric Halo behind Exclusive & Ultra Skins -->
	{#if spec.hasHaloRing}
		<div
			data-rarity-halo
			class="pointer-events-none absolute flex h-28 w-28 items-center justify-center opacity-40 transition-opacity duration-300 group-hover/chamber:opacity-75"
		>
			<svg viewBox="0 0 120 120" class="h-full w-full">
				<circle
					cx="60"
					cy="60"
					r="52"
					fill="none"
					stroke={spec.primaryHex}
					stroke-width="1"
					stroke-dasharray={spec.rank === 5 ? '8 5 2 5' : '12 8'}
				/>
				<polygon
					points="60,14 100,37 100,83 60,106 20,83 20,37"
					fill="none"
					stroke={spec.secondaryHex}
					stroke-width="0.9"
					opacity="0.7"
				/>
				{#if spec.rank === 5}
					<polygon
						points="60,22 93,79 27,79"
						fill="none"
						stroke={spec.tertiaryHex}
						stroke-width="0.8"
						opacity="0.55"
					/>
				{/if}
			</svg>
		</div>
	{/if}

	<!-- Sweeping Holographic Foil Sheen (Premium / Exclusive / Ultra) -->
	{#if spec.hasFoilShimmer}
		<div
			data-rarity-foil
			class="pointer-events-none absolute inset-y-0 -left-1/4 w-2/3 -skew-x-25 opacity-30"
			style="background: linear-gradient(90deg, transparent 0%, {spec.rank === 5
				? 'rgba(255, 245, 190, 0.38)'
				: 'rgba(255, 255, 255, 0.22)'} 50%, transparent 100%);"
		></div>
	{/if}

	<!-- Rising GSAP Motes / Ember Sparks (Deluxe 5 -> Premium 8 -> Exclusive 12 -> Ultra 16) -->
	{#if motes.length > 0}
		<div class="pointer-events-none absolute inset-0 overflow-hidden">
			{#each motes as m (m.id)}
				<span
					data-rarity-mote
					class="absolute bottom-1 rounded-full opacity-0"
					style="left: {m.leftPct}%; width: {m.sizePx}px; height: {m.sizePx}px; background: {m.color}; box-shadow: 0 0 {spec.rank >=
					4
						? 9
						: 6}px {m.color};"
				></span>
			{/each}
		</div>
	{/if}

	<!-- Weapon Artwork with GSAP Levitation & Rarity Drop-Shadow Bloom -->
	<div data-rarity-float class="relative z-10 flex w-full items-center justify-center">
		{#if imageUrl}
			<img
				src={imageUrl}
				{alt}
				loading="lazy"
				class="{imageMaxHeightClass} w-full object-contain transition duration-300 group-hover/chamber:scale-108"
				style="filter: drop-shadow(0 14px 18px rgba(0,0,0,0.82)) {spec.rank >= 3
					? `drop-shadow(0 0 ${6 + spec.rank * 3}px ${spec.glowRgba})`
					: ''};"
			/>
		{:else}
			<span class="font-mono text-xs text-slate-500">No Artwork</span>
		{/if}
	</div>

	<!-- Subtle "360° Inspect" Pill Appearing on Hover -->
	{#if onOpen360 && imageUrl}
		<span
			class="pointer-events-none absolute top-2 left-2 z-20 inline-flex translate-y-0.5 items-center gap-1 rounded-lg border border-white/15 bg-[#080c16]/88 px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider text-white uppercase opacity-0 shadow-lg backdrop-blur-md transition duration-200 group-hover/chamber:translate-y-0 group-hover/chamber:opacity-100"
			style="border-color: {spec.borderBaseRgba};"
		>
			<Rotate3d class="h-3 w-3" style="color: {spec.primaryHex}" />
			<span>360° View</span>
		</span>
	{/if}

	{#if overlay}
		{@render overlay()}
	{/if}
</button>
