<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Check,
		Clock,
		Copy,
		ExternalLink,
		Eye,
		Link2,
		Lock,
		RefreshCw,
		Share2,
		ShieldAlert,
		ShieldCheck,
		X
	} from '@lucide/svelte';

	let {
		accountId,
		riotId,
		lastSyncedAt,
		existingPath,
		onClose
	}: {
		accountId: string;
		riotId: string;
		lastSyncedAt: string | null;
		existingPath: string | null;
		onClose: () => void;
	} = $props();

	let dialog: HTMLDialogElement;
	let publishing = $state(false);
	let publishedPath = $state<string | null>(null);
	let error = $state('');
	let copyStatus = $state('');
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	const sharePath = $derived(publishedPath ?? existingPath);
	const relativeUrl = $derived(
		sharePath ? resolve('/share/[token]', { token: sharePath.slice('/share/'.length) }) : ''
	);
	const shareUrl = $derived(
		typeof location === 'undefined' ? relativeUrl : new URL(relativeUrl, location.origin).href
	);

	const riotIdParts = $derived.by(() => {
		const hashIdx = riotId.indexOf('#');
		if (hashIdx <= 0) return { gameName: riotId, tagLine: '' };
		return {
			gameName: riotId.slice(0, hashIdx),
			tagLine: riotId.slice(hashIdx + 1)
		};
	});

	const formattedSyncTime = $derived.by(() => {
		if (!lastSyncedAt) return null;
		const parsed = new Date(lastSyncedAt);
		if (Number.isNaN(parsed.getTime())) return lastSyncedAt;
		return parsed.toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	});

	$effect(() => {
		dialog.showModal();
		return () => {
			if (copyTimer) clearTimeout(copyTimer);
		};
	});

	async function copyLink() {
		if (!sharePath) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
			copied = true;
			copyStatus = 'Link copied to clipboard.';
			if (copyTimer) clearTimeout(copyTimer);
			copyTimer = setTimeout(() => {
				copied = false;
			}, 2400);
		} catch {
			copied = false;
			copyStatus = 'Copy failed. Select and copy the link manually.';
		}
	}
</script>

<dialog
	bind:this={dialog}
	onclose={onClose}
	onclick={(event) => {
		if (event.target === dialog) dialog.close();
	}}
	aria-labelledby="share-title"
	aria-describedby="share-description"
	class="geim-dialog glass-neu relative m-auto max-h-[92dvh] w-[calc(100%_-_1.5rem)] max-w-xl overflow-x-hidden overflow-y-auto rounded-2xl p-0 text-slate-200 sm:w-[calc(100%_-_2rem)]"
>
	<!-- Top Specular Highlight & Ambient Corner Wash -->
	<div
		class="pointer-events-none absolute inset-x-8 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-neu-cyan/80 to-transparent"
	></div>
	<div
		class="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
		style="background: radial-gradient(circle at 12% 0%, rgba(34, 211, 238, 0.14) 0%, transparent 45%), radial-gradient(circle at 90% 0%, rgba(255, 70, 85, 0.13) 0%, transparent 45%);"
	></div>

	<div class="relative z-10 flex flex-col gap-4 p-5 sm:gap-5 sm:p-6">
		<!-- Dialog Header -->
		<div class="flex items-start justify-between gap-3">
			<div class="flex min-w-0 items-start gap-3.5">
				<div
					class="neu-well-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-400/30 text-neu-cyan shadow-[0_0_22px_rgba(34,211,238,0.2)]"
				>
					<Share2 class="h-5 w-5" />
				</div>

				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<span class="font-mono text-[10px] font-bold tracking-widest text-neu-cyan uppercase">
							Public Profile Snapshot
						</span>
						{#if sharePath}
							<span
								class="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/12 px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider text-emerald-300 uppercase"
							>
								<span class="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]"
								></span>
								Live Link
							</span>
						{:else if !lastSyncedAt}
							<span
								class="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/12 px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider text-amber-300 uppercase"
							>
								Unsynced
							</span>
						{/if}
					</div>

					<h2
						id="share-title"
						class="mt-0.5 flex flex-wrap items-baseline gap-1.5 font-display text-lg font-bold text-white sm:text-xl"
					>
						<span>Share {riotIdParts.gameName}</span>
						{#if riotIdParts.tagLine}
							<span
								class="neu-well-sm rounded-md px-2 py-0.5 font-mono text-xs font-semibold text-slate-300"
							>
								#{riotIdParts.tagLine}
							</span>
						{/if}
					</h2>
				</div>
			</div>

			<button
				type="button"
				onclick={() => dialog.close()}
				class="neu-btn flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl p-2 text-slate-400 hover:text-white"
				aria-label="Close share dialog"
				title="Close (Esc)"
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		<!-- Visibility Breakdown (Public vs Private) -->
		<div id="share-description" class="flex flex-col gap-3">
			<p class="text-xs leading-relaxed text-slate-300 sm:text-[13px]">
				Create a permanent read-only showcase URL from your latest saved sync. Opening the shared
				link never triggers live Riot requests—re-publish anytime to refresh your snapshot while
				keeping the exact same URL.
			</p>

			<div class="grid gap-2.5 sm:grid-cols-2">
				<!-- Shared Publicly Card -->
				<div
					class="neu-well-sm flex flex-col gap-2 rounded-xl border border-emerald-400/20 p-3.5"
					style="background: radial-gradient(circle at 0% 0%, rgba(16, 185, 129, 0.1) 0%, rgba(8, 11, 19, 0.8) 75%);"
				>
					<div
						class="flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider text-emerald-300 uppercase"
					>
						<Eye class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
						<span>Visible to Link Holders</span>
					</div>
					<ul class="flex flex-col gap-1.5 text-xs text-slate-300">
						<li class="flex items-center gap-2">
							<Check class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
							<span>Riot ID, Level &amp; Player Card</span>
						</li>
						<li class="flex items-center gap-2">
							<Check class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
							<span>Current Rating &amp; Career Peak</span>
						</li>
						<li class="flex items-center gap-2">
							<Check class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
							<span>Aggregate Winrate, K/D &amp; ADR</span>
						</li>
						<li class="flex items-center gap-2">
							<Check class="h-3.5 w-3.5 shrink-0 text-emerald-400" />
							<span>Owned Skins &amp; Collection Value</span>
						</li>
					</ul>
				</div>

				<!-- Kept Private Card -->
				<div
					class="neu-well-sm flex flex-col gap-2 rounded-xl border border-rose-400/20 p-3.5"
					style="background: radial-gradient(circle at 100% 0%, rgba(255, 70, 85, 0.1) 0%, rgba(8, 11, 19, 0.8) 75%);"
				>
					<div
						class="flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider text-rose-300 uppercase"
					>
						<ShieldCheck class="h-3.5 w-3.5 shrink-0 text-neu-accent" />
						<span>Always Kept Private</span>
					</div>
					<ul class="flex flex-col gap-1.5 text-xs text-slate-300">
						<li class="flex items-center gap-2">
							<Lock class="h-3 w-3 shrink-0 text-rose-400/90" />
							<span>Match History &amp; Scoreboards</span>
						</li>
						<li class="flex items-center gap-2">
							<Lock class="h-3 w-3 shrink-0 text-rose-400/90" />
							<span>Daily Shop &amp; Night Market</span>
						</li>
						<li class="flex items-center gap-2">
							<Lock class="h-3 w-3 shrink-0 text-rose-400/90" />
							<span>Wallet Balances (VP / RP / KC)</span>
						</li>
						<li class="flex items-center gap-2">
							<Lock class="h-3 w-3 shrink-0 text-rose-400/90" />
							<span>geim Login &amp; Sealed Riot Tokens</span>
						</li>
					</ul>
				</div>
			</div>
		</div>

		<!-- Snapshot Timestamp Strip -->
		<div
			class="neu-well-sm flex flex-wrap items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-xs"
		>
			<span class="inline-flex items-center gap-2 text-slate-400">
				<Clock class="h-3.5 w-3.5 shrink-0 text-neu-cyan" />
				<span>Snapshot Source</span>
			</span>
			{#if lastSyncedAt && formattedSyncTime}
				<time datetime={lastSyncedAt} class="font-mono text-xs font-semibold text-white">
					{formattedSyncTime}
				</time>
			{:else}
				<span class="font-mono text-xs font-semibold text-amber-300">Not synced yet</span>
			{/if}
		</div>

		<!-- Persistent Share Link Bar -->
		{#if sharePath}
			<div class="neu-well flex flex-col gap-2.5 rounded-xl p-3.5">
				<div class="flex items-center justify-between gap-2">
					<label
						for="share-link"
						class="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold tracking-wider text-slate-300 uppercase"
					>
						<Link2 class="h-3.5 w-3.5 text-neu-cyan" />
						<span>Your Persistent Share URL</span>
					</label>
					<a
						href={resolve('/share/[token]', { token: sharePath.slice('/share/'.length) })}
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-neu-cyan transition hover:text-white"
					>
						<span>Open Shared Profile</span>
						<ExternalLink class="h-3 w-3" />
					</a>
				</div>

				<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
					<input
						id="share-link"
						readonly
						value={shareUrl}
						onfocus={(event) => event.currentTarget.select()}
						class="neu-field min-h-11 flex-1 px-3.5 py-2 font-mono text-xs text-white"
					/>
					<button
						type="button"
						onclick={copyLink}
						data-active={copied}
						class="neu-btn flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold text-white"
					>
						{#if copied}
							<Check class="h-3.5 w-3.5 text-emerald-400" />
							<span>Copied!</span>
						{:else}
							<Copy class="h-3.5 w-3.5 text-neu-cyan" />
							<span>Copy Link</span>
						{/if}
					</button>
				</div>
			</div>
		{/if}

		<!-- Status / Error / Unsynced Messages -->
		{#if copyStatus || publishedPath}
			<p
				role="status"
				class="flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/10 px-3.5 py-2.5 text-xs font-medium text-cyan-200"
			>
				<Check class="h-4 w-4 shrink-0 text-emerald-400" />
				<span>
					{copyStatus || (publishedPath ? 'Profile published. Your link is ready to share.' : '')}
				</span>
			</p>
		{:else}
			<p role="status" class="sr-only"></p>
		{/if}

		{#if error}
			<p
				role="alert"
				class="flex items-center gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3.5 py-2.5 text-xs font-medium text-rose-300"
			>
				<ShieldAlert class="h-4 w-4 shrink-0 text-rose-400" />
				<span>{error}</span>
			</p>
		{/if}

		{#if !lastSyncedAt}
			<div
				class="flex items-center gap-2.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3.5 py-2.5 text-xs font-medium text-amber-200"
			>
				<ShieldAlert class="h-4 w-4 shrink-0 text-amber-300" />
				<span>Sync this account before publishing a profile.</span>
			</div>
		{/if}

		<!-- Action Footer -->
		<form
			method="POST"
			action="?/shareProfile"
			use:enhance={() => {
				publishing = true;
				error = '';
				return async ({ result, update }) => {
					publishing = false;
					if (result.type === 'success' && typeof result.data?.sharedPath === 'string') {
						publishedPath = result.data.sharedPath;
					} else {
						error =
							result.type === 'failure'
								? String(result.data?.shareError ?? 'Could not publish. Try again.')
								: 'Could not publish. Try again.';
					}
					await update({ reset: false });
				};
			}}
			class="flex flex-col-reverse gap-2.5 border-t border-white/8 pt-3.5 sm:flex-row sm:items-center sm:justify-end"
		>
			<input type="hidden" name="accountId" value={accountId} />
			<input type="hidden" name="confirmed" value="yes" />
			<button
				type="button"
				onclick={() => dialog.close()}
				class="neu-btn min-h-11 cursor-pointer rounded-xl px-4 text-xs font-semibold text-slate-200"
			>
				{publishedPath ? 'Done' : 'Cancel'}
			</button>
			{#if !publishedPath}
				<button
					type="submit"
					disabled={publishing || !lastSyncedAt}
					class="neu-btn-accent flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-55"
				>
					{#if publishing}
						<RefreshCw class="h-3.5 w-3.5 animate-spin" />
						<span>Publishing Snapshot…</span>
					{:else}
						<Share2 class="h-3.5 w-3.5" />
						<span>
							{existingPath ? 'Confirm & Update Profile' : 'Confirm & Publish Profile'}
						</span>
					{/if}
				</button>
			{/if}
		</form>
	</div>
</dialog>
