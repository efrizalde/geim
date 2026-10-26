<script lang="ts">
	import { Activity, Backpack, Store } from '@lucide/svelte';
	import type { ModuleKey } from './ProfileHero.svelte';

	interface Props {
		activeModule: ModuleKey;
		onSelectModule: (mod: ModuleKey) => void;
		readOnly?: boolean;
		ownedSkinCount?: number | null;
		matchSampleCount?: number | null;
		shopCountdown?: string | null;
	}

	let {
		activeModule,
		onSelectModule,
		readOnly = false,
		ownedSkinCount = null,
		matchSampleCount = null,
		shopCountdown = null
	}: Props = $props();

	const tabs = $derived(
		readOnly
			? ([
					{
						id: 'inventory' as ModuleKey,
						label: 'Collection',
						ariaLabel: 'Collection',
						icon: Backpack,
						badge: ownedSkinCount !== null ? String(ownedSkinCount) : null
					},
					{
						id: 'tracker' as ModuleKey,
						label: 'Stats',
						ariaLabel: 'Stats',
						icon: Activity,
						badge: null
					}
				] as const)
			: ([
					{
						id: 'tracker' as ModuleKey,
						label: 'Overview',
						ariaLabel: 'Overview & Tracker',
						icon: Activity,
						badge: matchSampleCount && matchSampleCount > 0 ? String(matchSampleCount) : null
					},
					{
						id: 'shop' as ModuleKey,
						label: 'Daily Shop',
						ariaLabel: 'Daily Shop',
						icon: Store,
						badge: shopCountdown && shopCountdown !== 'Expired' ? 'LIVE' : null
					},
					{
						id: 'inventory' as ModuleKey,
						label: 'Collection',
						ariaLabel: 'Collection',
						icon: Backpack,
						badge: ownedSkinCount !== null ? String(ownedSkinCount) : null
					}
				] as const)
	);

	const activeIndex = $derived(
		Math.max(
			0,
			tabs.findIndex((t) => t.id === activeModule)
		)
	);
</script>

<div
	class="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
>
	<nav
		aria-label="Mobile Account Modules"
		class="glass-dock pointer-events-auto relative mx-auto max-w-md overflow-hidden rounded-2xl p-1.5"
	>
		<!-- Sliding Frosted Glass Active Pill Indicator -->
		<div
			aria-hidden="true"
			class="pointer-events-none absolute inset-y-1.5 left-1.5 rounded-xl border border-rose-400/40 transition-transform duration-320 ease-[cubic-bezier(0.22,1,0.36,1)]"
			style="width: calc((100% - 0.75rem) / {tabs.length}); transform: translateX(calc({activeIndex} * 100%)); background: linear-gradient(160deg, rgba(255, 70, 85, 0.25) 0%, rgba(255, 70, 85, 0.07) 100%); box-shadow: 0 6px 20px -4px rgba(255, 70, 85, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.22);"
		>
			<span
				class="absolute top-0 left-1/2 h-[2px] w-7 -translate-x-1/2 rounded-full bg-gradient-to-r from-[#ff4655] to-[#ff858f] shadow-[0_0_10px_#ff4655]"
			></span>
		</div>

		<div
			class="relative z-10 grid"
			style="grid-template-columns: repeat({tabs.length}, minmax(0, 1fr));"
		>
			{#each tabs as tab (tab.id)}
				{@const isActive = activeModule === tab.id}
				<button
					type="button"
					onclick={() => onSelectModule(tab.id)}
					aria-label={tab.ariaLabel}
					aria-current={isActive ? 'page' : undefined}
					data-active={isActive}
					class="relative flex min-h-13 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 transition-colors duration-200 {isActive
						? 'text-white'
						: 'text-slate-400 hover:text-slate-200'}"
				>
					<div class="relative flex items-center justify-center">
						<tab.icon
							class="h-4.5 w-4.5 transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] {isActive
								? '-translate-y-0.5 scale-110 text-neu-accent drop-shadow-[0_0_8px_rgba(255,70,85,0.65)]'
								: 'text-slate-400'}"
						/>
						{#if tab.badge}
							<span
								class="py-0.2 ml-1 rounded-full px-1.5 font-mono text-[9px] leading-tight font-bold tabular-nums transition-colors {isActive
									? 'bg-white/15 text-white'
									: 'bg-white/[0.06] text-slate-400'}"
							>
								{tab.badge}
							</span>
						{/if}
					</div>
					<span
						class="truncate text-[11px] leading-none font-bold tracking-tight transition-all duration-200 {isActive
							? 'text-white'
							: 'font-semibold text-slate-400'}"
					>
						{tab.label}
					</span>
				</button>
			{/each}
		</div>
	</nav>
</div>
