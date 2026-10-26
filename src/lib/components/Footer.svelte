<script lang="ts">
	import { ShieldCheck } from '@lucide/svelte';
	import BrandLogo from './BrandLogo.svelte';

	const currentYear = new Date().getFullYear();
</script>

<footer class="mt-12 border-t border-white/[0.06] bg-[#06090f]/80 backdrop-blur-xl">
	<div
		class="mx-auto flex max-w-7xl flex-col gap-4 px-4 pt-6 pb-28 text-xs text-slate-400 sm:px-6 md:flex-row md:items-center md:justify-between md:py-6 lg:px-8"
	>
		<div class="flex flex-wrap items-center gap-3">
			<BrandLogo size="sm" />
			<a
				href="https://geim.efri.day"
				class="font-display font-semibold text-slate-200 transition-colors hover:text-white"
			>
				geim<span class="text-neu-accent">.</span>efri.day
			</a>
			<span class="hidden text-white/15 sm:inline">|</span>
			<span class="inline-flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
				<ShieldCheck class="h-3.5 w-3.5 text-emerald-400" />
				AES-256-GCM Sealed Sessions
			</span>
		</div>

		<div class="flex flex-col gap-1 text-[11px] text-slate-500 md:text-right">
			<p>
				© {currentYear}
				<a
					href="https://efri.day"
					target="_blank"
					rel="noreferrer"
					class="font-medium text-slate-400 transition-colors hover:text-slate-200"
				>
					efri.day
				</a>
				· Weapon & competitive metadata via
				<span class="font-mono text-slate-400">valorant-api.com</span>
				· FX rates via <span class="font-mono text-slate-400">ECB / Frankfurter</span>
			</p>
			<p class="text-[10px] text-slate-500/80">
				Not endorsed by Riot Games. VALORANT and Riot Games are trademarks or registered trademarks
				of Riot Games, Inc.
			</p>
		</div>
	</div>
</footer>
