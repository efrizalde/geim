<script lang="ts">
	import { browser } from '$app/env';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		ChevronDown,
		Eye,
		EyeOff,
		ExternalLink,
		KeyRound,
		Link2,
		Lock,
		LogOut,
		Plus,
		RefreshCw,
		ShieldCheck,
		User,
		X
	} from '@lucide/svelte';
	import { cubicOut } from 'svelte/easing';
	import { tick } from 'svelte';
	import { fly, scale, slide } from 'svelte/transition';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import InventorySection from '#lib/components/InventorySection.svelte';
	import MobileFloatingNav from '#lib/components/MobileFloatingNav.svelte';
	import ProfileHero, { type ModuleKey } from '#lib/components/ProfileHero.svelte';
	import ShopSection from '#lib/components/ShopSection.svelte';
	import ShareProfileDialog from '#lib/components/ShareProfileDialog.svelte';
	import LazySkinInspector from '#lib/components/LazySkinInspector.svelte';
	import type { SkinInspectorPayload } from '#lib/components/SkinInspectorModal.svelte';
	import TrackerSection from '#lib/components/TrackerSection.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type ConnectMode = 'redirect' | 'ssid' | 'credentials';

	const MODULE_ORDER: Record<ModuleKey, number> = {
		tracker: 0,
		shop: 1,
		inventory: 2
	};

	let activeModule = $state<ModuleKey>('tracker');
	let tabDirection = $state<1 | -1>(1);
	let showConnectPanel = $state(false);
	let dismissedForm = $state<unknown>(null);
	let connectMode = $state<ConnectMode>('redirect');
	let showSecrets = $state(false);
	let connecting = $state(false);
	let optimisticCurrency = $state<'IDR' | 'USD' | null>(null);
	let inspectorTarget = $state.raw<SkinInspectorPayload | null>(null);

	// The 3D inspector chunk loads lazily via LazySkinInspector; inventory skins fetch their
	// full level/chroma detail (videos) from the owner-only endpoint only when inspected.
	function openInspector(payload: SkinInspectorPayload) {
		inspectorTarget = payload;
		if (payload.mode === 'inventory' && payload.skinUuid && activeAccount) {
			fetch(
				`/api/valorant/skin-inspector?account=${encodeURIComponent(activeAccount.id)}&skin=${encodeURIComponent(payload.skinUuid)}`
			)
				.then((r) => (r.ok ? r.json() : Promise.reject()))
				.then((detail) => {
					if (inspectorTarget === payload) {
						inspectorTarget = { ...payload, levels: detail.levels, chromas: detail.chromas };
					}
				})
				.catch(() => {});
		}
	}
	let shareAccountId = $state<string | null>(null);
	let userMenuOpen = $state(false);
	let showLogoutConfirm = $state(false);
	let logoutDialogEl = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		if (showLogoutConfirm && logoutDialogEl && !logoutDialogEl.open) {
			logoutDialogEl.showModal();
		}
	});

	// Sync active module with URL hash (#tracker | #shop | #inventory)
	$effect(() => {
		if (!browser) return;
		const hash = window.location.hash.replace('#', '');
		if (hash === 'shop' || hash === 'inventory' || hash === 'tracker') {
			activeModule = hash;
		}
	});

	function selectModule(mod: ModuleKey) {
		if (mod !== activeModule) {
			tabDirection = MODULE_ORDER[mod] >= MODULE_ORDER[activeModule] ? 1 : -1;
			activeModule = mod;
		}
		if (browser) {
			history.replaceState(null, '', `#${mod}`);
		}
	}

	// Live ticking clock for Shop & Night Market countdowns
	let nowMs = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => {
			nowMs = Date.now();
		}, 1000);
		return () => clearInterval(id);
	});

	const displayCurrency = $derived(optimisticCurrency ?? data.user.displayCurrency);
	const dashboard = $derived(data.dashboard);
	const activeAccount = $derived(dashboard.activeAccount);
	const hasActiveFormPrompt = $derived(
		Boolean(form?.connectError || form?.mfaRequired) && form !== dismissedForm
	);
	const isConnectOpen = $derived(showConnectPanel || !activeAccount || hasActiveFormPrompt);
	const isMfaStep = $derived(Boolean(form?.mfaRequired) && form !== dismissedForm);

	function openConnectPanel() {
		dismissedForm = null;
		showConnectPanel = true;
	}

	function closeConnectPanel() {
		if (!activeAccount) return;
		dismissedForm = form;
		showConnectPanel = false;
	}

	// Riot's OAuth redirect lands on playvalorant.com (cross-origin), so the URL can only be
	// captured from the clipboard: instant on `paste`, automatic on tab focus via readText
	// (browser prompts for clipboard-read permission once).
	let redirectUrlValue = $state('');
	let connectFormEl = $state<HTMLFormElement | null>(null);
	let autoDetected = $state(false);
	let lastAutoCaptured = '';

	function looksLikeRiotRedirect(text: string): boolean {
		return /access_token=[^&\s]+/i.test(text) && /id_token=[^&\s]+/i.test(text);
	}

	async function autoCaptureRedirectUrl(raw: string) {
		const candidate = raw.trim();
		if (!candidate || candidate === lastAutoCaptured || connecting) return;
		lastAutoCaptured = candidate;
		autoDetected = true;
		redirectUrlValue = candidate;
		await tick();
		connectFormEl?.requestSubmit();
	}

	$effect(() => {
		if (!browser || !isConnectOpen || connectMode !== 'redirect' || isMfaStep) return;

		const onPaste = (e: ClipboardEvent) => {
			const text = e.clipboardData?.getData('text') ?? '';
			if (looksLikeRiotRedirect(text)) autoCaptureRedirectUrl(text);
		};
		const onTabReturn = () => {
			if (connecting) return;
			navigator.clipboard
				?.readText()
				.then((text) => {
					if (looksLikeRiotRedirect(text)) autoCaptureRedirectUrl(text);
				})
				.catch(() => {});
		};
		const onVisibility = () => {
			if (document.visibilityState === 'visible') onTabReturn();
		};

		window.addEventListener('paste', onPaste);
		window.addEventListener('focus', onTabReturn);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.removeEventListener('paste', onPaste);
			window.removeEventListener('focus', onTabReturn);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});

	function toggleConnectPanel() {
		if (isConnectOpen) {
			closeConnectPanel();
		} else {
			openConnectPanel();
		}
	}

	function formatCountdown(isoTarget: string | null | undefined): string {
		if (!isoTarget) return '--:--:--';
		const diffSec = Math.max(0, Math.floor((new Date(isoTarget).getTime() - nowMs) / 1000));
		if (diffSec <= 0) return 'Expired';
		const hrs = Math.floor(diffSec / 3600);
		const mins = Math.floor((diffSec % 3600) / 60);
		const secs = diffSec % 60;
		return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
	}

	function formatRelativeSync(iso: string | null | undefined): string {
		if (!iso) return 'Never';
		const sec = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
		if (sec < 60) return `${sec}s ago`;
		if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
		const hrs = Math.floor(sec / 3600);
		return `${hrs}h ago`;
	}
</script>

<!-- Sticky Full-Bleed Frosted Glass Top Navbar -->
<header class="sticky top-0 z-40 border-b border-white/[0.07] bg-[#070a11]/84 backdrop-blur-2xl">
	<div class="mx-auto flex max-w-7xl flex-col gap-2 px-3.5 py-2 sm:px-6 sm:py-2.5 lg:px-8">
		<div class="flex items-center justify-between gap-2">
			<!-- Left: "g." Brand Logo + Desktop Account Switcher -->
			<div class="flex min-w-0 items-center gap-3">
				<a href={resolve('/')} class="flex shrink-0 items-center gap-2">
					<BrandLogo size="sm" subtitle="VALORANT Deck" />
				</a>

				{#if dashboard.accounts.length > 0}
					<span class="hidden h-5 w-px bg-white/10 md:inline-block"></span>

					<div class="neu-well-sm hidden flex-wrap items-center gap-1 rounded-xl p-1 md:flex">
						{#each dashboard.accounts as acc (acc.id)}
							<a
								href={resolve(`/?account=${acc.id}`)}
								data-active={activeAccount?.id === acc.id}
								class="neu-btn flex items-center gap-2 rounded-lg px-2.5 py-1 text-xs font-semibold"
							>
								<span
									class="h-1.5 w-1.5 rounded-full {acc.connectionStatus === 'connected'
										? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
										: 'bg-amber-400'}"
								></span>
								<span>
									{acc.gameName}<span class="text-slate-400">#{acc.tagLine}</span>
								</span>
								<span class="font-mono text-[10px] text-neu-cyan uppercase">{acc.shard}</span>
							</a>
						{/each}
						<button
							type="button"
							onclick={toggleConnectPanel}
							data-active={isConnectOpen}
							aria-expanded={isConnectOpen}
							aria-controls="riot-session-card"
							class="neu-btn flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 hover:text-white"
							title={isConnectOpen ? 'Hide Riot session panel' : 'Link or refresh a Riot account'}
						>
							<Plus
								class="h-3.5 w-3.5 transition-transform duration-200 {isConnectOpen
									? 'rotate-45 text-white'
									: ''}"
							/>
							<span>{isConnectOpen ? 'Close' : 'Link'}</span>
						</button>
					</div>
				{/if}
			</div>

			<!-- Right: Display Currency Switcher & User Menu -->
			<div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
				<form
					method="POST"
					action="?/setCurrency"
					use:enhance={({ formData }) => {
						const next = formData.get('currency');
						if (next === 'IDR' || next === 'USD') optimisticCurrency = next;
						return async ({ update }) => {
							await update();
							optimisticCurrency = null;
						};
					}}
					class="neu-well-sm flex items-center gap-0.5 rounded-xl p-1"
				>
					<button
						type="submit"
						name="currency"
						value="IDR"
						data-active={displayCurrency === 'IDR'}
						class="seg-tab cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] font-bold sm:px-2.5 sm:text-[11px]"
					>
						IDR
					</button>
					<button
						type="submit"
						name="currency"
						value="USD"
						data-active={displayCurrency === 'USD'}
						class="seg-tab cursor-pointer rounded-lg px-2 py-1 font-mono text-[10px] font-bold sm:px-2.5 sm:text-[11px]"
					>
						USD
					</button>
				</form>

				<!-- User Account Dropdown (prevents accidental mobile logout tap) -->
				<div class="relative" data-user-menu>
					<button
						type="button"
						onclick={() => (userMenuOpen = !userMenuOpen)}
						data-active={userMenuOpen}
						aria-expanded={userMenuOpen}
						aria-haspopup="menu"
						aria-label="Account menu for {data.user.username}"
						class="neu-btn flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-white sm:px-3"
					>
						<User class="h-3.5 w-3.5 shrink-0 text-neu-cyan" />
						<span class="max-w-24 truncate sm:max-w-28">{data.user.username}</span>
						<ChevronDown
							class="h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform {userMenuOpen
								? 'rotate-180'
								: ''}"
						/>
					</button>

					{#if userMenuOpen}
						<div
							role="menu"
							aria-label="Account actions"
							class="glass-neu absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-2xl p-1.5 shadow-[0_20px_48px_rgba(0,0,0,0.88)]"
						>
							<div class="px-3 py-2">
								<p
									class="font-mono text-[10px] font-semibold tracking-wider text-slate-400 uppercase"
								>
									Signed in as
								</p>
								<p class="mt-0.5 truncate text-xs font-bold text-white">
									{data.user.username}
								</p>
							</div>
							<div class="my-1 border-t border-white/8"></div>
							<button
								type="button"
								role="menuitem"
								onclick={() => {
									userMenuOpen = false;
									showLogoutConfirm = true;
								}}
								class="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left text-xs font-semibold text-rose-300 transition hover:bg-rose-500/15 hover:text-white"
							>
								<LogOut class="h-3.5 w-3.5 shrink-0 text-neu-accent" />
								<span>Log Out…</span>
							</button>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Mobile Swipeable Account Switcher Strip -->
		{#if dashboard.accounts.length > 0}
			<div
				class="neu-well-sm no-scrollbar flex items-center gap-1 overflow-x-auto rounded-xl p-1 md:hidden"
			>
				{#each dashboard.accounts as acc (acc.id)}
					<a
						href={resolve(`/?account=${acc.id}`)}
						data-active={activeAccount?.id === acc.id}
						class="neu-btn flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap"
					>
						<span
							class="h-1.5 w-1.5 rounded-full {acc.connectionStatus === 'connected'
								? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
								: 'bg-amber-400'}"
						></span>
						<span>
							{acc.gameName}<span class="text-slate-400">#{acc.tagLine}</span>
						</span>
						<span class="font-mono text-[9px] text-neu-cyan uppercase">{acc.shard}</span>
					</a>
				{/each}
				<button
					type="button"
					onclick={toggleConnectPanel}
					data-active={isConnectOpen}
					aria-expanded={isConnectOpen}
					aria-controls="riot-session-card"
					class="neu-btn ml-auto flex shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-300 hover:text-white"
				>
					<Plus
						class="h-3.5 w-3.5 transition-transform duration-200 {isConnectOpen
							? 'rotate-45 text-white'
							: ''}"
					/>
					<span>{isConnectOpen ? 'Close' : 'Link'}</span>
				</button>
			</div>
		{/if}
	</div>
</header>

<svelte:window
	onclick={(e) => {
		const target = e.target as HTMLElement | null;
		if (userMenuOpen && target && !target.closest('[data-user-menu]')) {
			userMenuOpen = false;
		}
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape') {
			if (userMenuOpen) {
				userMenuOpen = false;
				return;
			}
			if (isConnectOpen && activeAccount && !inspectorTarget && !showLogoutConfirm) {
				closeConnectPanel();
			}
		}
	}}
/>

<main class="mx-auto flex w-full max-w-7xl flex-col px-4 pt-5 sm:px-6 lg:px-8">
	<!-- Collapsible Riot Session Connection Card -->
	{#if isConnectOpen}
		<div transition:slide={{ duration: 280, easing: cubicOut }} class="overflow-hidden">
			<div class="pb-5">
				<section
					id="riot-session-card"
					transition:scale={{ start: 0.985, opacity: 0, duration: 220, easing: cubicOut }}
					aria-label={activeAccount
						? 'Link or Refresh Riot Session'
						: 'Connect your VALORANT Account'}
					class="glass-neu relative flex origin-top flex-col gap-5 overflow-hidden rounded-2xl p-5 sm:p-6"
				>
					<!-- Top Specular Accent Line -->
					<div
						class="pointer-events-none absolute inset-x-8 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-neu-accent/70 to-transparent"
					></div>

					<!-- Card Header + Method Switcher + Close Control -->
					<div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
						<div class="flex items-start gap-3.5">
							<div
								class="neu-well-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neu-accent/25 text-neu-accent shadow-[0_0_20px_rgba(255,70,85,0.16)]"
							>
								{#if isMfaStep}
									<ShieldCheck class="h-5 w-5" />
								{:else}
									<Link2 class="h-5 w-5" />
								{/if}
							</div>

							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<h2 class="font-display text-base font-bold text-white sm:text-lg">
										{#if isMfaStep}
											Two-Factor Riot Verification
										{:else if activeAccount}
											Link or Refresh Riot Session
										{:else}
											Connect your VALORANT Account
										{/if}
									</h2>
									{#if activeAccount}
										<span
											class="neu-well-sm inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-mono text-[10px] font-semibold text-slate-300"
										>
											<span
												class="h-1.5 w-1.5 rounded-full {activeAccount.connectionStatus ===
												'connected'
													? 'bg-emerald-400'
													: 'bg-amber-400'}"
											></span>
											{activeAccount.gameName}<span class="text-slate-400"
												>#{activeAccount.tagLine}</span
											>
										</span>
									{/if}
								</div>
								<p class="mt-0.5 text-xs text-slate-400">
									Sealed at rest with <code class="font-mono text-slate-300">AES-256-GCM</code> · Tokens
									stay server-side and never touch client scripts.
								</p>
							</div>
						</div>

						<div class="flex items-center justify-between gap-2 sm:justify-end">
							{#if !isMfaStep}
								<div
									role="tablist"
									aria-label="Riot authentication method"
									class="neu-well no-scrollbar flex items-center gap-1 overflow-x-auto rounded-xl p-1"
								>
									<button
										type="button"
										role="tab"
										aria-selected={connectMode === 'redirect'}
										onclick={() => (connectMode = 'redirect')}
										data-active={connectMode === 'redirect'}
										class="seg-tab flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap"
									>
										<KeyRound class="h-3.5 w-3.5" />
										<span>Redirect URL</span>
										<span
											class="py-0.2 rounded bg-white/15 px-1.5 font-mono text-[9px] font-bold tracking-wider uppercase"
										>
											Best
										</span>
									</button>
									<button
										type="button"
										role="tab"
										aria-selected={connectMode === 'ssid'}
										onclick={() => (connectMode = 'ssid')}
										data-active={connectMode === 'ssid'}
										class="seg-tab flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap"
									>
										<RefreshCw class="h-3.5 w-3.5" />
										<span>SSID Cookie</span>
									</button>
									<button
										type="button"
										role="tab"
										aria-selected={connectMode === 'credentials'}
										onclick={() => (connectMode = 'credentials')}
										data-active={connectMode === 'credentials'}
										class="seg-tab flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold whitespace-nowrap"
									>
										<Lock class="h-3.5 w-3.5" />
										<span>Direct Login</span>
									</button>
								</div>
							{/if}

							{#if activeAccount}
								<button
									type="button"
									onclick={closeConnectPanel}
									class="neu-btn flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-400 hover:text-white"
									aria-label="Close connection panel"
									title="Close panel (Esc)"
								>
									<X class="h-4 w-4" />
									<span class="hidden font-mono text-[10px] sm:inline">ESC</span>
								</button>
							{/if}
						</div>
					</div>

					{#if form?.connectError && form !== dismissedForm}
						<div
							role="alert"
							transition:slide={{ duration: 180, easing: cubicOut }}
							class="neu-well flex items-center justify-between gap-3 rounded-xl border border-rose-500/35 px-4 py-3 text-xs font-medium text-rose-300"
						>
							<span>{form.connectError}</span>
						</div>
					{/if}

					{#if isMfaStep}
						<form
							method="POST"
							action="?/submitMfa"
							in:fly={{ y: 6, duration: 180, easing: cubicOut }}
							use:enhance={() => {
								connecting = true;
								return async ({ result, update }) => {
									connecting = false;
									if (result.type === 'redirect' || result.type === 'success') {
										showConnectPanel = false;
									}
									await update();
								};
							}}
							class="neu-well-sm flex flex-col justify-between gap-4 rounded-xl p-4 sm:flex-row sm:items-end"
						>
							<input
								type="hidden"
								name="pendingCookiesSealed"
								value={form?.pendingCookiesSealed ?? ''}
							/>
							<div class="flex flex-1 flex-col gap-2">
								<label for="mfa-code" class="text-xs font-semibold text-slate-200">
									6-Digit Riot MFA Code
									<span class="ml-1.5 font-normal text-slate-400">
										(sent to {form?.emailHint ?? 'your 2FA device'})
									</span>
								</label>
								<div
									class="neu-well flex items-center rounded-xl px-3.5 py-1 transition-colors focus-within:border-white/25"
								>
									<ShieldCheck class="mr-2.5 h-4 w-4 shrink-0 text-neu-cyan" />
									<input
										id="mfa-code"
										name="code"
										type="text"
										inputmode="numeric"
										autocomplete="one-time-code"
										required
										placeholder="Enter 6-digit verification code…"
										class="w-full bg-transparent py-2 font-mono text-sm tracking-widest text-white placeholder:tracking-normal placeholder:text-slate-500 focus:outline-none"
									/>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<button
									type="button"
									onclick={() => (dismissedForm = form)}
									class="neu-btn cursor-pointer rounded-xl px-4 py-2.5 text-xs font-semibold"
								>
									Back
								</button>
								<button
									type="submit"
									disabled={connecting}
									class="neu-btn-accent flex cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold disabled:opacity-60"
								>
									<RefreshCw class="h-4 w-4 {connecting ? 'animate-spin' : ''}" />
									<span>{connecting ? 'Verifying & Syncing…' : 'Verify MFA & Sync'}</span>
								</button>
							</div>
						</form>
					{:else}
						{#key connectMode}
							<form
								method="POST"
								action="?/connectAccount"
								bind:this={connectFormEl}
								in:fly={{ y: 6, duration: 180, easing: cubicOut }}
								use:enhance={() => {
									connecting = true;
									dismissedForm = null;
									return async ({ result, update }) => {
										connecting = false;
										if (
											result.type === 'redirect' ||
											(result.type === 'success' && !result.data?.mfaRequired)
										) {
											showConnectPanel = false;
										}
										await update();
									};
								}}
								class="grid gap-4 lg:grid-cols-12"
							>
								<input type="hidden" name="mode" value={connectMode} />

								{#if connectMode === 'redirect'}
									<!-- Step 1: Launch Riot Official Sign-In -->
									<div
										class="neu-well-sm flex flex-col justify-between gap-3 rounded-xl p-4 lg:col-span-4"
									>
										<div class="flex flex-col gap-1.5">
											<div class="flex items-center justify-between gap-2">
												<span
													class="font-mono text-[10px] font-bold tracking-wider text-neu-cyan uppercase"
												>
													Step 01 · Riot Sign-In
												</span>
												<span class="font-mono text-[10px] text-slate-400">OAuth2 Token</span>
											</div>
											<p class="text-xs leading-relaxed text-slate-300">
												Sign in on Riot Games. Once redirected to
												<code class="font-mono text-white">playvalorant.com/opt_in</code>, copy the
												full URL, then switch back here.
											</p>
										</div>

										<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
										<a
											href={data.riotAuthorizeUrl}
											target="_blank"
											rel="external noreferrer"
											class="neu-btn inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-neu-cyan hover:text-white"
										>
											<span>Open Riot Sign-In Portal</span>
											<ExternalLink class="h-3.5 w-3.5" />
										</a>
									</div>

									<!-- Step 2: Paste Callback URL + Optional SSID Auto-Renew -->
									<div
										class="neu-well-sm flex flex-col justify-between gap-3.5 rounded-xl p-4 lg:col-span-8"
									>
										<div class="flex flex-col gap-1.5">
											<label
												for="redirect-url-input"
												class="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-200"
											>
												<span
													class="font-mono text-[10px] font-bold tracking-wider text-neu-accent uppercase"
												>
													Step 02 · Paste Redirect Callback URL
												</span>
												<span class="font-mono text-[10px] font-normal text-slate-400">
													Contains #access_token=…
												</span>
											</label>
											<div
												class="neu-well flex items-center rounded-xl px-3.5 py-0.5 transition-colors focus-within:border-white/25"
											>
												<KeyRound class="mr-2.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
												<input
													id="redirect-url-input"
													name="redirectUrl"
													bind:value={redirectUrlValue}
													type={showSecrets ? 'text' : 'password'}
													required
													placeholder="https://playvalorant.com/opt_in#access_token=..."
													class="w-full bg-transparent py-2 font-mono text-xs text-white placeholder:text-slate-500 focus:outline-none"
												/>
												<button
													type="button"
													onclick={() => (showSecrets = !showSecrets)}
													class="ml-1.5 cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:text-white"
													aria-label={showSecrets ? 'Hide pasted token' : 'Show pasted token'}
												>
													{#if showSecrets}
														<EyeOff class="h-3.5 w-3.5" />
													{:else}
														<Eye class="h-3.5 w-3.5" />
													{/if}
												</button>
											</div>
											{#if autoDetected}
												<p role="status" class="font-mono text-[10px] font-bold text-emerald-400">
													Redirect URL detected. Connecting…
												</p>
											{:else}
												<p class="font-mono text-[10px] leading-relaxed text-slate-500">
													Auto-capture on: copy the URL in the Riot tab, switch back, and this
													form fills and connects by itself. Pasting anywhere on this page works
													too.
												</p>
											{/if}
										</div>

										<div class="grid gap-3 sm:grid-cols-12 sm:items-end">
											<div class="flex flex-col gap-1 sm:col-span-7">
												<label
													for="redirect-ssid-input"
													class="text-[11px] font-medium text-slate-400"
												>
													Optional: <code class="font-mono text-slate-300">ssid</code> cookie for ~2w
													auto-renew
												</label>
												<div
													class="neu-well flex items-center rounded-xl px-3.5 py-0.5 transition-colors focus-within:border-white/25"
												>
													<input
														id="redirect-ssid-input"
														name="ssidCookie"
														type={showSecrets ? 'text' : 'password'}
														placeholder="Leave blank for 1-hour session only"
														class="w-full bg-transparent py-2 font-mono text-xs text-white placeholder:text-slate-500 focus:outline-none"
													/>
												</div>
											</div>

											<div class="sm:col-span-5">
												<button
													type="submit"
													disabled={connecting}
													class="neu-btn-accent flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold disabled:opacity-60"
												>
													<RefreshCw class="h-4 w-4 {connecting ? 'animate-spin' : ''}" />
													<span>
														{connecting ? 'Syncing VALORANT Data…' : 'Connect & Sync Account'}
													</span>
												</button>
											</div>
										</div>
									</div>
								{:else if connectMode === 'ssid'}
									<div
										class="neu-well-sm flex flex-col justify-between gap-4 rounded-xl p-4 lg:col-span-12"
									>
										<div class="grid gap-4 lg:grid-cols-12 lg:items-end">
											<div class="flex flex-col gap-1.5 lg:col-span-8">
												<label for="ssid-cookie-input" class="text-xs font-semibold text-slate-200">
													Riot <code class="font-mono text-neu-cyan">ssid</code> Cookie Value
													<span class="ml-1.5 font-normal text-slate-400">
														(DevTools → Application → Cookies → auth.riotgames.com)
													</span>
												</label>
												<div
													class="neu-well flex items-center rounded-xl px-3.5 py-0.5 transition-colors focus-within:border-white/25"
												>
													<RefreshCw class="mr-2.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
													<input
														id="ssid-cookie-input"
														name="ssidCookie"
														type={showSecrets ? 'text' : 'password'}
														required
														placeholder="Paste ssid cookie value for silent token renewal…"
														class="w-full bg-transparent py-2 font-mono text-xs text-white placeholder:text-slate-500 focus:outline-none"
													/>
													<button
														type="button"
														onclick={() => (showSecrets = !showSecrets)}
														class="ml-1.5 cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:text-white"
														aria-label={showSecrets ? 'Hide cookie value' : 'Show cookie value'}
													>
														{#if showSecrets}
															<EyeOff class="h-3.5 w-3.5" />
														{:else}
															<Eye class="h-3.5 w-3.5" />
														{/if}
													</button>
												</div>
											</div>

											<div class="lg:col-span-4">
												<button
													type="submit"
													disabled={connecting}
													class="neu-btn-accent flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold disabled:opacity-60"
												>
													<RefreshCw class="h-4 w-4 {connecting ? 'animate-spin' : ''}" />
													<span>
														{connecting ? 'Renewing & Syncing…' : 'Connect via SSID Cookie'}
													</span>
												</button>
											</div>
										</div>
									</div>
								{:else}
									<div
										class="neu-well-sm grid gap-3.5 rounded-xl p-4 sm:grid-cols-2 lg:col-span-12 lg:grid-cols-12 lg:items-end"
									>
										<div class="flex flex-col gap-1.5 lg:col-span-4">
											<label for="riot-username-input" class="text-xs font-semibold text-slate-200">
												Riot Username
											</label>
											<div
												class="neu-well flex items-center rounded-xl px-3.5 py-0.5 transition-colors focus-within:border-white/25"
											>
												<input
													id="riot-username-input"
													name="username"
													type="text"
													required
													autocomplete="username"
													placeholder="Enter Riot username…"
													class="w-full bg-transparent py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none"
												/>
											</div>
										</div>

										<div class="flex flex-col gap-1.5 lg:col-span-4">
											<label for="riot-password-input" class="text-xs font-semibold text-slate-200">
												Riot Password
												<span class="ml-1 font-normal text-slate-400">(never stored)</span>
											</label>
											<div
												class="neu-well flex items-center rounded-xl px-3.5 py-0.5 transition-colors focus-within:border-white/25"
											>
												<Lock class="mr-2 h-3.5 w-3.5 shrink-0 text-slate-400" />
												<input
													id="riot-password-input"
													name="password"
													type={showSecrets ? 'text' : 'password'}
													required
													autocomplete="current-password"
													placeholder="Enter Riot password…"
													class="w-full bg-transparent py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none"
												/>
												<button
													type="button"
													onclick={() => (showSecrets = !showSecrets)}
													class="ml-1.5 cursor-pointer rounded-lg p-1.5 text-slate-400 transition hover:text-white"
													aria-label={showSecrets ? 'Hide password' : 'Show password'}
												>
													{#if showSecrets}
														<EyeOff class="h-3.5 w-3.5" />
													{:else}
														<Eye class="h-3.5 w-3.5" />
													{/if}
												</button>
											</div>
										</div>

										<div class="sm:col-span-2 lg:col-span-4">
											<button
												type="submit"
												disabled={connecting}
												class="neu-btn-accent flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold disabled:opacity-60"
											>
												<RefreshCw class="h-4 w-4 {connecting ? 'animate-spin' : ''}" />
												<span>{connecting ? 'Authenticating…' : 'Sign In & Sync'}</span>
											</button>
										</div>
									</div>
								{/if}
							</form>
						{/key}
					{/if}

					<!-- Security notes + honest disclaimer; shown regardless of the chosen method -->
					<div
						class="neu-well-sm flex items-start gap-3 rounded-xl border border-white/[0.06] p-3.5"
					>
						<ShieldCheck class="mt-0.5 h-4 w-4 shrink-0 text-neu-cyan" />
						<div class="text-[11px] leading-relaxed text-slate-400">
							<p>
								<span class="font-semibold text-slate-200">How your session is handled.</span>
								Tokens and cookies are sealed with
								<code class="font-mono text-slate-300">AES-256-GCM</code> before they touch the
								database, are only used to pull your own game data, and are wiped when you
								disconnect the account. A Riot password entered here is used once for sign-in and
								never stored.
							</p>
							<p class="mt-1.5 border-t border-white/[0.06] pt-1.5">
								geim is an unofficial, fan-made tool and is not affiliated with or endorsed by
								Riot Games. Only link accounts you own, and use at your own risk under Riot's
								Terms of Service.
							</p>
						</div>
					</div>
				</section>
			</div>
		</div>
	{/if}

	{#if activeAccount}
		<div class="flex flex-col gap-5">
			<!-- Account Profile Hero Banner + Integrated Wallet + Horizontal Frosted-Glass Tabs -->
			<ProfileHero
				{activeAccount}
				profile={dashboard.profile}
				currencyIcons={dashboard.currencyIcons}
				wallet={dashboard.store?.wallet ?? null}
				{activeModule}
				onSelectModule={selectModule}
				onOpenConnect={openConnectPanel}
				onShare={() => (shareAccountId = activeAccount.id)}
				syncError={form?.syncError ?? null}
				ownedSkinCount={dashboard.inventory?.valuation.ownedBaseSkinCount ?? null}
				matchSampleCount={dashboard.tracker?.totalMatches ?? null}
				shopCountdown={dashboard.store ? formatCountdown(dashboard.store.dailyExpiresAt) : null}
				relativeSyncText={formatRelativeSync(activeAccount.lastSyncedAt)}
			/>

			{#key activeModule}
				<div
					in:fly={{
						x: tabDirection * 22,
						y: 8,
						duration: 280,
						easing: cubicOut
					}}
					class="will-change-transform"
				>
					<!-- ==================== MODULE 1: TRACKER & COMPETITIVE OVERVIEW ==================== -->
					{#if activeModule === 'tracker'}
						{#key `${activeAccount.id}:${dashboard.tracker?.fetchedAt ?? ''}`}
							<TrackerSection
								ownerPuuid={activeAccount.puuid}
								ownerAccount={activeAccount}
								profile={dashboard.profile}
								tracker={dashboard.tracker}
							/>
						{/key}

						<!-- ==================== MODULE 2: DAILY STOREFRONT & NIGHT MARKET ==================== -->
					{:else if activeModule === 'shop'}
						{#if dashboard.store}
							<ShopSection
								store={dashboard.store}
								vpIconUrl={dashboard.currencyIcons.vp}
								shopCountdown={formatCountdown(dashboard.store.dailyExpiresAt)}
								nightMarketCountdown={formatCountdown(dashboard.store.nightMarket.expiresAt)}
								onInspectSkin={openInspector}
							/>
						{:else}
							<div class="glass-neu rounded-2xl p-6 text-xs text-slate-400">
								No storefront snapshot found yet. Click <strong class="text-white">Sync</strong>
								above to pull your daily offers.
							</div>
						{/if}

						<!-- ==================== MODULE 3: INVENTORY & VALUATION ==================== -->
					{:else if activeModule === 'inventory'}
						{#if dashboard.inventory}
							<InventorySection
								inventory={dashboard.inventory}
								vpIconUrl={dashboard.currencyIcons.vp}
								onInspectSkin={openInspector}
							/>
						{:else}
							<div class="glass-neu rounded-2xl p-6 text-xs text-slate-400">
								No inventory snapshot found yet. Click <strong class="text-white">Sync</strong>
								above to index your collection.
							</div>
						{/if}
					{/if}
				</div>
			{/key}
		</div>
	{/if}
</main>

<!-- Mobile Frosted Glass Floating Bottom Navigation -->
{#if activeAccount}
	<MobileFloatingNav
		{activeModule}
		onSelectModule={selectModule}
		ownedSkinCount={dashboard.inventory?.valuation.ownedBaseSkinCount ?? null}
		matchSampleCount={dashboard.tracker?.totalMatches ?? null}
		shopCountdown={dashboard.store ? formatCountdown(dashboard.store.dailyExpiresAt) : null}
	/>
{/if}

<!-- Multi-Level & Variant Skin Inspector Modal -->
{#if inspectorTarget}
	<LazySkinInspector target={inspectorTarget} onClose={() => (inspectorTarget = null)} />
{/if}

{#if activeAccount && shareAccountId === activeAccount.id}
	<ShareProfileDialog
		accountId={activeAccount.id}
		riotId={`${activeAccount.gameName}#${activeAccount.tagLine}`}
		lastSyncedAt={activeAccount.lastSyncedAt}
		existingPath={data.profileShare?.path ?? null}
		onClose={() => (shareAccountId = null)}
	/>
{/if}

{#if showLogoutConfirm}
	<dialog
		bind:this={logoutDialogEl}
		onclose={() => (showLogoutConfirm = false)}
		onclick={(event) => {
			if (event.target === logoutDialogEl) logoutDialogEl?.close();
		}}
		aria-labelledby="logout-title"
		aria-describedby="logout-description"
		class="geim-dialog glass-neu relative m-auto w-[calc(100%_-_2rem)] max-w-sm overflow-hidden rounded-2xl p-5 text-slate-200 sm:p-6"
	>
		<div
			class="pointer-events-none absolute inset-x-8 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-neu-accent/80 to-transparent"
		></div>

		<div class="flex items-start justify-between gap-3">
			<div class="flex items-center gap-3">
				<div
					class="neu-well-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neu-accent/30 text-neu-accent"
				>
					<LogOut class="h-4 w-4" />
				</div>
				<div>
					<span class="font-mono text-[10px] font-bold tracking-widest text-neu-accent uppercase">
						Confirm Action
					</span>
					<h2 id="logout-title" class="font-display text-base font-bold text-white sm:text-lg">
						Log out of geim?
					</h2>
				</div>
			</div>
			<button
				type="button"
				onclick={() => logoutDialogEl?.close()}
				class="neu-btn rounded-xl p-1.5 text-slate-400 hover:text-white"
				aria-label="Close logout dialog"
			>
				<X class="h-4 w-4" />
			</button>
		</div>

		<p id="logout-description" class="mt-3.5 text-xs leading-relaxed text-slate-300">
			You will be signed out of <strong class="text-white">{data.user.username}</strong> on this device.
			Your connected Riot accounts and saved snapshots remain safely stored.
		</p>

		<form
			method="POST"
			action="?/logout"
			use:enhance
			class="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"
		>
			<button
				type="button"
				onclick={() => logoutDialogEl?.close()}
				class="neu-btn min-h-11 cursor-pointer rounded-xl px-4 text-xs font-semibold text-slate-200"
			>
				Cancel
			</button>
			<button
				type="submit"
				class="neu-btn-accent flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold"
			>
				<LogOut class="h-3.5 w-3.5" />
				<span>Confirm Log Out</span>
			</button>
		</form>
	</dialog>
{/if}
