<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import Footer from '#lib/components/Footer.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>g. — VALORANT Command Deck</title>
</svelte:head>

<div
	class="geim-canvas flex min-h-screen flex-col text-neu-ink selection:bg-neu-accent/30 selection:text-white"
>
	<div class="flex flex-1 flex-col">
		{@render children()}
	</div>
	<Footer />
</div>
