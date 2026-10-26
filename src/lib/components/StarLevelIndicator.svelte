<script lang="ts">
	import { Play, Star } from '@lucide/svelte';
	import type { HydratedSkinLevelItem } from '#lib/server/providers/valorant/service.js';

	interface Props {
		levels: HydratedSkinLevelItem[];
		mode?: 'shop' | 'inventory';
		size?: 'xs' | 'sm' | 'md';
		onSelectLevel?: (level: HydratedSkinLevelItem) => void;
	}

	let { levels, mode = 'inventory', size = 'sm', onSelectLevel }: Props = $props();

	let hoveredLevel = $state<number | null>(null);

	const normalizedLevels = $derived<HydratedSkinLevelItem[]>(
		levels.length > 0
			? levels
			: [
					{
						uuid: 'default-lvl-1',
						levelNumber: 1,
						displayName: 'Level 1',
						effectLabel: 'Base Model',
						displayIcon: null,
						streamedVideo: null,
						unlocked: true
					}
				]
	);

	const allUnlocked = $derived(
		normalizedLevels.length > 1 && normalizedLevels.every((l) => l.unlocked)
	);

	const iconSizeClass = $derived(
		size === 'xs' ? 'h-3.5 w-3.5' : size === 'md' ? 'h-4.5 w-4.5' : 'h-4 w-4'
	);
</script>

<div
	class="relative inline-flex items-center gap-0.5"
	role="group"
	aria-label="Skin upgrade levels"
>
	{#each normalizedLevels as lvl (lvl.uuid)}
		{@const isFilled = mode === 'inventory' ? lvl.unlocked : lvl.levelNumber === 1}
		{@const isInteractive = Boolean(onSelectLevel && (lvl.streamedVideo || lvl.displayIcon))}
		{@const isHovered = hoveredLevel === lvl.levelNumber}

		<div class="relative inline-flex">
			<button
				type="button"
				onmouseenter={() => (hoveredLevel = lvl.levelNumber)}
				onmouseleave={() => {
					if (hoveredLevel === lvl.levelNumber) hoveredLevel = null;
				}}
				onfocus={() => (hoveredLevel = lvl.levelNumber)}
				onblur={() => {
					if (hoveredLevel === lvl.levelNumber) hoveredLevel = null;
				}}
				onclick={() => {
					if (onSelectLevel) onSelectLevel(lvl);
				}}
				class="group/star rounded-md p-0.5 transition focus:outline-none {isInteractive
					? 'cursor-pointer hover:scale-115 hover:bg-white/[0.06]'
					: 'cursor-default'}"
				aria-label={`Level ${lvl.levelNumber}: ${lvl.effectLabel}`}
			>
				{#if isFilled}
					<Star
						class="{iconSizeClass} shrink-0 transition {allUnlocked
							? 'fill-amber-400 text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.65)]'
							: 'fill-amber-400 text-amber-400 drop-shadow-[0_0_4px_rgba(251,191,36,0.45)]'}"
						strokeWidth={2}
					/>
				{:else}
					<Star
						class="{iconSizeClass} shrink-0 fill-transparent transition {mode === 'shop'
							? 'text-slate-400 group-hover/star:text-amber-300'
							: 'text-slate-500/85 group-hover/star:text-slate-300'}"
						strokeWidth={2}
					/>
				{/if}
			</button>

			<!-- Floating Frosted Glass Level Effect Tooltip -->
			{#if isHovered}
				<div
					role="tooltip"
					class="pointer-events-none absolute bottom-full left-1/2 z-40 mb-2 w-max max-w-52 -translate-x-1/2 rounded-xl border border-white/14 bg-[#0a0f1a]/95 px-2.5 py-2 text-left shadow-[0_12px_28px_rgba(0,0,0,0.85)] backdrop-blur-xl"
				>
					<div class="flex items-center gap-1.5">
						<span class="font-mono text-[10px] font-bold text-amber-300">
							LVL {lvl.levelNumber}
						</span>
						<span class="h-1 w-1 rounded-full bg-white/25"></span>
						<span
							class="font-mono text-[9px] font-semibold uppercase {mode === 'inventory'
								? lvl.unlocked
									? 'text-emerald-400'
									: 'text-slate-400'
								: lvl.levelNumber === 1
									? 'text-emerald-400'
									: 'text-neu-cyan'}"
						>
							{mode === 'inventory'
								? lvl.unlocked
									? 'Unlocked'
									: 'Locked'
								: lvl.levelNumber === 1
									? 'Included'
									: 'Upgrade'}
						</span>
					</div>

					<p class="mt-0.5 text-[11px] font-semibold text-white">
						{lvl.effectLabel}
					</p>

					{#if lvl.streamedVideo && onSelectLevel}
						<p class="mt-1 inline-flex items-center gap-1 font-mono text-[9px] text-neu-cyan">
							<Play class="h-2.5 w-2.5 fill-current" />
							<span>Click star to preview</span>
						</p>
					{/if}
				</div>
			{/if}
		</div>
	{/each}
</div>
