<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import Footer from '#lib/components/Footer.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>g. | VALORANT Dashboard</title>
	<meta
		name="description"
		content="A self-hosted VALORANT dashboard for your daily shop, skin collection value, and match history. Your Riot session stays sealed on your own server."
	/>
	<meta name="theme-color" content="#070a11" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="geim" />
	<meta property="og:title" content="g. | VALORANT Dashboard" />
	<meta
		property="og:description"
		content="Daily shop, skin collection value, and match history in one self-hosted VALORANT dashboard."
	/>
	<meta name="twitter:card" content="summary" />
</svelte:head>

<div
	class="geim-canvas flex min-h-screen flex-col text-neu-ink selection:bg-neu-accent/30 selection:text-white"
>
	<div class="flex flex-1 flex-col">
		{@render children()}
	</div>
	<Footer />
</div>
