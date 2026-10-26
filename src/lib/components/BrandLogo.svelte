<script lang="ts">
	interface Props {
		size?: 'sm' | 'md' | 'lg';
		subtitle?: string;
	}

	let { size = 'md', subtitle }: Props = $props();

	const boxClass = $derived(
		size === 'sm'
			? 'h-7 w-7 rounded-lg text-base'
			: size === 'lg'
				? 'h-12 w-12 rounded-2xl text-2xl'
				: 'h-9 w-9 rounded-xl text-xl'
	);

	const dotClass = $derived(
		size === 'sm' ? 'h-1.5 w-1.5' : size === 'lg' ? 'h-2.5 w-2.5' : 'h-2 w-2'
	);
</script>

<div class="inline-flex items-center gap-2.5 select-none">
	<div
		class="{boxClass} relative flex shrink-0 items-center justify-center border border-white/14 bg-gradient-to-br from-[#1a2438] to-[#0a0e18] font-display font-extrabold tracking-tighter text-white shadow-[0_6px_18px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.18)]"
		aria-hidden="true"
	>
		<span class="-translate-y-[1px] leading-none">g</span>
		<span
			class="{dotClass} ml-[1px] translate-y-[3px] rounded-full bg-neu-accent shadow-[0_0_10px_#ff4655]"
		></span>
	</div>

	{#if subtitle}
		<div class="flex flex-col leading-none">
			<span class="font-display text-sm font-bold tracking-tight text-white">
				geim<span class="text-neu-accent">.</span>
			</span>
			<span class="mt-0.5 font-mono text-[10px] tracking-wider text-slate-400 uppercase">
				{subtitle}
			</span>
		</div>
	{/if}
</div>
