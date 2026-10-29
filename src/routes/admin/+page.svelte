<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		ArrowLeft,
		ArrowRight,
		CheckCircle2,
		ChevronDown,
		Clock3,
		Search,
		ShieldCheck,
		Users,
		X
	} from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let pending = $state(false);
	let confirmed = $state(false);
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	function date(value: string) {
		const parsed = new Date(value);
		return mounted
			? parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
			: parsed.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
	}
	function pageLink(page: number, auditPage: number, search: string) {
		const params = new SvelteURLSearchParams();
		if (search) params.set('q', search);
		if (page > 1) params.set('page', String(page));
		if (auditPage > 1) params.set('auditPage', String(auditPage));
		return params.toString();
	}
	function statusLabel(status: string) {
		return status.replace(/[_-]+/g, ' ');
	}
</script>

<svelte:head><title>Owner admin | geim</title></svelte:head>

<header class="sticky top-0 z-40 border-b border-white/[0.07] bg-[#070a11]/84 backdrop-blur-2xl">
	<div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
		<BrandLogo size="sm" subtitle="Owner admin" />
		<a
			href={resolve('/')}
			class="neu-btn admin-link inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-200 hover:text-white"
		>
			<ArrowLeft class="h-4 w-4" aria-hidden="true" /> <span>Dashboard</span>
		</a>
	</div>
</header>

<main class="admin-page mx-auto w-full max-w-6xl px-4 pt-8 pb-14 sm:px-6 sm:pt-10">
	<div class="flex flex-wrap items-end justify-between gap-5">
		<div>
			<div
				class="mb-2 inline-flex items-center gap-2 font-mono text-[10px] font-bold tracking-wider text-neu-cyan uppercase"
			>
				<ShieldCheck class="h-3.5 w-3.5" aria-hidden="true" /> Instance management
			</div>
			<h1 class="font-display text-3xl font-bold tracking-tight text-white">
				Owner admin<span class="text-neu-accent">.</span>
			</h1>
			<p class="mt-2 max-w-xl text-sm leading-6 text-slate-300">
				Manage registration and review account activity for this instance.
			</p>
		</div>
		{#if !data.failed}<p class="flex items-center gap-2 text-xs text-slate-400">
				<Clock3 class="h-3.5 w-3.5" aria-hidden="true" /> Updated
				<time datetime={data.retrievedAt} title={data.retrievedAt}>{date(data.retrievedAt)}</time>
			</p>{/if}
	</div>

	{#if data.failed}
		<div
			role="alert"
			class="mt-8 rounded-xl border border-rose-400/30 bg-rose-950/20 p-5 text-sm text-rose-200"
		>
			<p class="font-semibold">Admin data could not be loaded.</p>
			<p class="mt-1 text-rose-200/80">Check the database connection, then try again.</p>
			<a
				class="admin-link mt-3 inline-flex min-h-10 items-center font-semibold underline underline-offset-4"
				href={resolve('/admin')}>Retry</a
			>
		</div>
	{:else}
		<div id="overview" class="scroll-mt-24 pt-7">
			<div class="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
				<section
					aria-labelledby="overview-title"
					class="glass-neu relative overflow-hidden rounded-2xl p-5 sm:p-6"
				>
					<div
						aria-hidden="true"
						class="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-neu-cyan/60 to-transparent"
					></div>
					<div class="flex items-start justify-between gap-4">
						<div>
							<h2 id="overview-title" class="text-base font-bold text-white">Instance overview</h2>
							<p class="mt-1 text-sm text-slate-400">Current totals across your instance</p>
						</div>
						<span
							class="neu-well-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 text-neu-cyan"
							><Users class="h-5 w-5" aria-hidden="true" /></span
						>
					</div>
					<dl class="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3">
						<div>
							<dt class="text-xs font-medium text-slate-400">Users</dt>
							<dd class="mt-1.5 font-display text-3xl font-bold text-white tabular-nums">
								{data.totals.users}
							</dd>
						</div>
						<div>
							<dt class="text-xs font-medium text-slate-400">Published profiles</dt>
							<dd class="mt-1.5 font-display text-3xl font-bold text-white tabular-nums">
								{data.totals.shares}
							</dd>
						</div>
						<div
							class="col-span-2 border-t border-white/8 pt-4 sm:col-span-1 sm:border-t-0 sm:pt-0"
						>
							<dt class="text-xs font-medium text-slate-400">Linked accounts</dt>
							<dd class="mt-1.5 font-display text-3xl font-bold text-white tabular-nums">
								{data.statuses.reduce((total, status) => total + status.count, 0)}
							</dd>
						</div>
					</dl>
					<div
						class="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-white/8 pt-4 text-xs text-slate-300"
					>
						<span class="text-slate-400">Connection status</span>
						{#each data.statuses as status (status.status)}<span class="capitalize"
								>{statusLabel(status.status)}
								<strong class="ml-1 text-white tabular-nums">{status.count}</strong></span
							>{:else}<span>No linked accounts yet</span>{/each}
					</div>
				</section>

				<section
					aria-labelledby="registration-title"
					class="glass-neu relative flex flex-col overflow-hidden rounded-2xl p-5 sm:p-6"
				>
					<div
						aria-hidden="true"
						class="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-neu-accent/60 to-transparent"
					></div>
					<div class="flex items-start justify-between gap-3">
						<div>
							<h2 id="registration-title" class="text-base font-bold text-white">Registration</h2>
							<p class="mt-1 text-sm text-slate-400">Control access for new users</p>
						</div>
						<span
							class="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold {data.registrationOpen
								? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300'
								: 'border-amber-400/25 bg-amber-400/10 text-amber-200'}"
							><span
								aria-hidden="true"
								class="h-1.5 w-1.5 rounded-full {data.registrationOpen
									? 'bg-emerald-400'
									: 'bg-amber-400'}"
							></span>{data.registrationOpen ? 'Open' : 'Paused'}</span
						>
					</div>
					<p class="mt-5 text-sm leading-6 text-slate-300">
						{data.registrationOpen
							? 'New users can create accounts.'
							: 'New account creation is paused.'} Existing users can still sign in.
					</p>
					{#if form?.error}<p role="alert" class="mt-3 text-sm text-rose-300">{form.error}</p>{/if}
					{#if form?.success}<p
							role="status"
							class="mt-3 flex items-center gap-2 text-sm text-emerald-300"
						>
							<CheckCircle2 class="h-4 w-4" aria-hidden="true" />
							{form.success}
						</p>{/if}
					<form
						method="POST"
						action="?/registration"
						class="mt-auto flex flex-wrap items-center justify-between gap-3 pt-5"
						use:enhance={() => {
							pending = true;
							return async ({ result, update }) => {
								try {
									await update();
									if (result.type === 'success') confirmed = false;
								} finally {
									pending = false;
								}
							};
						}}
					>
						<input type="hidden" name="open" value={String(!data.registrationOpen)} />
						<label
							class="admin-check inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-slate-200"
							><input
								type="checkbox"
								name="confirmed"
								value="yes"
								bind:checked={confirmed}
								required
								class="h-4 w-4 accent-[#22d3ee]"
							/>
							Confirm {data.registrationOpen ? 'pause' : 'resume'}</label
						>
						<button
							type="submit"
							disabled={pending}
							class="neu-btn min-h-10 cursor-pointer rounded-xl px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
							>{pending
								? 'Saving…'
								: data.registrationOpen
									? 'Pause registration'
									: 'Resume registration'}</button
						>
					</form>
				</section>
			</div>
		</div>

		<section
			id="users"
			aria-labelledby="users-title"
			class="glass-neu mt-5 scroll-mt-24 overflow-hidden rounded-2xl"
		>
			<div class="flex flex-wrap items-end justify-between gap-4 p-5 sm:p-6">
				<div>
					<h2 id="users-title" class="text-base font-bold text-white">Users</h2>
					<p class="mt-1 text-sm text-slate-400">Find a user and check their linked accounts.</p>
				</div>
				<form
					method="GET"
					action={resolve('/admin#users')}
					class="flex w-full items-end gap-2 sm:w-auto"
				>
					<label class="relative min-w-0 flex-1 sm:w-64"
						><span class="sr-only">Search username</span><Search
							class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
							aria-hidden="true"
						/><input
							name="q"
							value={data.search}
							maxlength="32"
							placeholder="Search username"
							class="neu-well h-11 w-full rounded-xl pr-3 pl-9 text-sm text-white placeholder:text-slate-400"
						/></label
					>
					<button
						class="neu-btn h-11 cursor-pointer rounded-xl px-4 text-sm font-semibold text-white"
						>Search</button
					>
					{#if data.search}<a
							class="admin-link inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-300 hover:bg-white/5"
							href={resolve('/admin')}
							aria-label="Clear search"><X class="h-4 w-4" aria-hidden="true" /></a
						>{/if}
				</form>
			</div>
			<div
				class="flex flex-wrap items-center justify-between gap-2 border-y border-white/8 bg-white/[0.025] px-5 py-3 text-xs text-slate-400 sm:px-6"
			>
				<span>{data.search ? `Results for “${data.search}”` : 'All users'}</span><span
					>{data.users.length} {data.users.length === 1 ? 'user' : 'users'} on this page</span
				>
			</div>
			{#if data.users.length}
				<div
					class="hidden grid-cols-[minmax(0,1fr)_minmax(130px,0.7fr)_minmax(180px,0.9fr)] gap-5 px-6 pt-4 pb-2 text-xs font-semibold text-slate-400 sm:grid"
				>
					<span>Username / joined</span><span>Linked accounts</span><span>Last sync</span>
				</div>
				<div class="divide-y divide-white/8 px-5 sm:px-6">
					{#each data.users as user (user.username)}
						<div
							class="grid gap-3 py-4 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(130px,0.7fr)_minmax(180px,0.9fr)] sm:items-center sm:gap-5"
						>
							<div class="min-w-0">
								<p class="font-semibold break-all text-white">{user.username}</p>
								<p class="mt-1 text-xs text-slate-400">
									Joined <time datetime={user.createdAt} title={user.createdAt}
										>{date(user.createdAt)}</time
									>
								</p>
							</div>
							<div
								class="flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-300 sm:contents sm:text-sm"
							>
								<p><span class="sm:hidden">Accounts: </span>{user.accountCount} linked</p>
								<p class="text-slate-300">
									<span class="sm:hidden">Last sync: </span>{#if user.lastSyncedAt}<time
											datetime={user.lastSyncedAt}
											title={user.lastSyncedAt}>{date(user.lastSyncedAt)}</time
										>{:else}Never synced{/if}
								</p>
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<div class="px-5 py-9 text-center sm:px-6">
					<p class="text-sm font-semibold text-white">
						{data.search ? 'No matching users' : 'No users on this page'}
					</p>
					<p class="mt-1 text-sm text-slate-400">
						{data.search
							? 'Try a different username or clear your search.'
							: 'Go back to see earlier users.'}
					</p>
					{#if data.search}<a
							href={resolve('/admin')}
							class="admin-link mt-3 inline-flex min-h-10 items-center text-sm font-semibold text-neu-cyan underline underline-offset-4"
							>Clear search</a
						>{/if}
				</div>
			{/if}
			<nav
				aria-label="User pages"
				class="flex min-h-14 items-center justify-between gap-3 border-t border-white/8 px-5 text-sm sm:px-6"
			>
				<span class="text-slate-400">Page {data.page}</span>
				<div class="flex items-center gap-4">
					{#if data.page > 1}<a
							class="admin-link inline-flex min-h-10 items-center gap-1 font-semibold text-slate-200"
							href={resolve(`/admin?${pageLink(data.page - 1, data.auditPage, data.search)}#users`)}
							><ArrowLeft class="h-3.5 w-3.5" aria-hidden="true" /> Previous</a
						>{/if}{#if data.hasMoreUsers}<a
							class="admin-link inline-flex min-h-10 items-center gap-1 font-semibold text-slate-200"
							href={resolve(`/admin?${pageLink(data.page + 1, data.auditPage, data.search)}#users`)}
							>Next <ArrowRight class="h-3.5 w-3.5" aria-hidden="true" /></a
						>{/if}
				</div>
			</nav>
		</section>

		<details
			id="history"
			aria-labelledby="audit-title"
			class="glass-neu mt-5 scroll-mt-24 overflow-hidden rounded-2xl"
			open={data.audit.length > 0 || data.auditPage > 1}
		>
			<summary class="flex cursor-pointer items-start gap-3 p-5 sm:p-6">
				<div class="neu-well-sm rounded-xl border border-neu-accent/20 p-2 text-neu-accent">
					<ShieldCheck class="h-4 w-4" aria-hidden="true" />
				</div>
				<div>
					<h2 id="audit-title" class="text-base font-bold text-white">Registration history</h2>
					<p class="mt-1 text-sm text-slate-400">Changes made to registration settings</p>
				</div>
				<ChevronDown class="mt-1 ml-auto h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
			</summary>
			<div class="divide-y divide-white/8 border-t border-white/8 px-5 sm:px-6">
				{#each data.audit as entry (entry.id)}<div
						class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-4 text-sm"
					>
						<p class="text-slate-300">
							<strong class="text-white">{entry.actor ?? 'Deleted user'}</strong> changed
							registration from <span class="text-white">{entry.oldValue ? 'open' : 'paused'}</span>
							to <span class="text-white">{entry.newValue ? 'open' : 'paused'}</span>
						</p>
						<time class="text-xs text-slate-400" datetime={entry.createdAt} title={entry.createdAt}
							>{date(entry.createdAt)}</time
						>
					</div>{:else}<p class="py-6 text-sm text-slate-400">
						No changes yet. Registration changes will appear here.
					</p>{/each}
			</div>
			{#if data.auditPage > 1 || data.hasMoreAudit}<nav
					aria-label="Registration history pages"
					class="flex min-h-14 items-center justify-between gap-3 border-t border-white/8 px-5 text-sm sm:px-6"
				>
					<span class="text-slate-400">Page {data.auditPage}</span>
					<div class="flex gap-4">
						{#if data.auditPage > 1}<a
								class="admin-link inline-flex min-h-10 items-center font-semibold text-slate-200"
								href={resolve(
									`/admin?${pageLink(data.page, data.auditPage - 1, data.search)}#history`
								)}>Previous</a
							>{/if}{#if data.hasMoreAudit}<a
								class="admin-link inline-flex min-h-10 items-center font-semibold text-slate-200"
								href={resolve(
									`/admin?${pageLink(data.page, data.auditPage + 1, data.search)}#history`
								)}>Next</a
							>{/if}
					</div>
				</nav>{/if}
		</details>
	{/if}
</main>

<style>
	details[open] summary > :global(svg:last-child) {
		transform: rotate(180deg);
	}
	.admin-page :is(a, button, input):focus-visible,
	.admin-page summary:focus-visible,
	.admin-link:focus-visible {
		outline: 2px solid #67e8f9;
		outline-offset: 3px;
	}
</style>
