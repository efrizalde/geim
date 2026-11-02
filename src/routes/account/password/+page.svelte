<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { ArrowLeft, Eye, EyeOff, KeyRound, ShieldCheck } from '@lucide/svelte';
	import { authClient } from '#lib/auth-client.js';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let submitting = $state(false);
	let showPasswords = $state(false);
	let passkeyBusy = $state(false);
	let googleBusy = $state(false);
	let passkeyMessage = $state('');
	let passkeyError = $state('');

	async function addPasskey() {
		passkeyBusy = true;
		passkeyMessage = '';
		passkeyError = '';
		try {
			const result = await authClient.passkey.addPasskey({ name: data.username });
			if (result.error) {
				throw new Error(result.error.message || 'Could not save passkey. Try again.');
			}
			passkeyMessage = 'Passkey added. You can use it to sign in.';
			await invalidateAll();
		} catch (err) {
			passkeyError = err instanceof Error ? err.message : 'Passkey setup failed.';
		} finally {
			passkeyBusy = false;
		}
	}

	async function removePasskey(id: string) {
		passkeyBusy = true;
		passkeyMessage = '';
		passkeyError = '';
		try {
			const result = await authClient.passkey.deletePasskey({ id });
			if (result.error) {
				throw new Error(result.error.message || 'Could not remove passkey.');
			}
			passkeyMessage = 'Passkey removed.';
			await invalidateAll();
		} catch (err) {
			passkeyError = err instanceof Error ? err.message : 'Could not remove passkey.';
		} finally {
			passkeyBusy = false;
		}
	}

	async function linkGoogle() {
		googleBusy = true;
		passkeyMessage = '';
		passkeyError = '';
		try {
			const result = await authClient.linkSocial({
				provider: 'google',
				callbackURL: `${resolve('/account/password')}?google=linked`,
				errorCallbackURL: resolve('/account/password')
			});
			if (result.error) {
				throw new Error(result.error.message || 'Could not start Google account linking.');
			}
		} catch (err) {
			passkeyError = err instanceof Error ? err.message : 'Could not link Google account.';
			googleBusy = false;
		}
	}

	async function unlinkGoogle(accountId: string) {
		googleBusy = true;
		passkeyMessage = '';
		passkeyError = '';
		try {
			const result = await authClient.unlinkAccount({ accountId });
			if (result.error) {
				throw new Error(result.error.message || 'Could not unlink Google account.');
			}
			passkeyMessage = 'Google account unlinked.';
			await invalidateAll();
		} catch (err) {
			passkeyError = err instanceof Error ? err.message : 'Could not unlink Google account.';
		} finally {
			googleBusy = false;
		}
	}
</script>

<svelte:head><title>Change password | geim</title></svelte:head>
<header class="sticky top-0 z-40 border-b border-white/[0.07] bg-[#070a11]/84 backdrop-blur-2xl">
	<div class="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
		<BrandLogo size="sm" subtitle="Account security" /><a
			href={resolve('/')}
			class="neu-btn inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-slate-200"
			><ArrowLeft class="h-4 w-4" /> Dashboard</a
		>
	</div>
</header>
<main class="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-4 py-10 sm:py-16">
	<section class="glass-neu relative overflow-hidden rounded-2xl p-5 sm:p-7">
		<div
			class="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-neu-accent/70 to-transparent"
		></div>
		<div class="flex items-start gap-3">
			<div
				class="neu-well-sm flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neu-accent/25 text-neu-accent"
			>
				<KeyRound class="h-5 w-5" />
			</div>
			<div>
				<p class="font-mono text-[10px] font-bold tracking-wider text-neu-cyan uppercase">
					Account security
				</p>
				<h1 class="mt-1 font-display text-xl font-bold text-white">Change password</h1>
				<p class="mt-1 text-sm text-slate-400">Update the geim password for {data.username}.</p>
			</div>
		</div>
		{#if form?.success}
			<div
				role="status"
				class="neu-well mt-6 rounded-xl border border-emerald-400/25 p-4 text-sm text-emerald-200"
			>
				<p class="flex items-center gap-2 font-semibold">
					<ShieldCheck class="h-4 w-4" /> Password updated
				</p>
				<p class="mt-2 text-xs leading-relaxed text-slate-300">
					Your other geim sessions have been signed out. This session stays signed in.
				</p>
			</div>
			<a
				href={resolve('/')}
				class="neu-btn-accent mt-5 inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold"
				>Back to dashboard</a
			>
		{:else}
			<p class="mt-5 text-sm leading-relaxed text-slate-300">
				Use your current geim password to confirm this change. Your Riot password is not needed.
			</p>
			{#if form?.error}<p
					role="alert"
					class="neu-well mt-4 rounded-xl border border-rose-500/35 p-3 text-sm text-rose-300"
				>
					{form.error}
				</p>{/if}
			<form
				method="POST"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						try {
							await update();
						} finally {
							submitting = false;
						}
					};
				}}
				class="mt-5 flex flex-col gap-4"
			>
				<label class="flex flex-col gap-2 text-xs font-semibold text-slate-200"
					>Current password<input
						name="currentPassword"
						type={showPasswords ? 'text' : 'password'}
						autocomplete="current-password"
						required
						maxlength="128"
						class="neu-well min-h-11 rounded-xl px-3 text-sm text-white"
					/></label
				>
				<label class="flex flex-col gap-2 text-xs font-semibold text-slate-200"
					>New password<input
						name="newPassword"
						type={showPasswords ? 'text' : 'password'}
						autocomplete="new-password"
						required
						minlength="4"
						maxlength="128"
						aria-describedby="password-help"
						class="neu-well min-h-11 rounded-xl px-3 text-sm text-white"
					/><span id="password-help" class="font-normal text-slate-400"
						>Use at least 4 characters. A PIN like 2202 works.</span
					></label
				>
				<label class="flex flex-col gap-2 text-xs font-semibold text-slate-200"
					>Confirm new password<input
						name="confirmPassword"
						type={showPasswords ? 'text' : 'password'}
						autocomplete="new-password"
						required
						minlength="4"
						maxlength="128"
						class="neu-well min-h-11 rounded-xl px-3 text-sm text-white"
					/></label
				>
				<button
					type="button"
					onclick={() => (showPasswords = !showPasswords)}
					class="flex min-h-11 w-fit items-center gap-2 text-xs text-slate-300 hover:text-white"
					>{#if showPasswords}<EyeOff class="h-4 w-4" /> Hide passwords{:else}<Eye
							class="h-4 w-4"
						/> Show passwords{/if}</button
				>
				<p class="text-xs leading-relaxed text-slate-400">
					Your other geim sessions will be signed out after the change.
				</p>
				<button
					type="submit"
					disabled={submitting}
					class="neu-btn-accent flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-bold disabled:opacity-50"
					><ShieldCheck class="h-4 w-4" />
					{submitting ? 'Updating password…' : 'Update password'}</button
				>
			</form>
		{/if}
		{#if data.passkeyEnabled || data.googleEnabled}<div class="mt-7 border-t border-white/10 pt-5">
				<h2 class="font-display text-base font-bold text-white">Other ways to sign in</h2>
				<p class="mt-1 text-xs leading-relaxed text-slate-400">
					Link a passkey or Google account to this geim account. Your password still works.
				</p>
				{#if data.googleLinked}<p role="status" class="mt-3 text-xs text-emerald-300">
						Google account linked.
					</p>{/if}
				{#if data.oauthError || passkeyError}<p role="alert" class="mt-3 text-xs text-rose-300">
						{passkeyError || data.oauthError}
					</p>{/if}
				{#if data.passkeys?.length}
					<ul class="mt-4 flex flex-col gap-2">
						{#each data.passkeys as item (item.id)}
							<li
								class="neu-well flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 text-xs text-slate-200"
							>
								<span class="truncate font-semibold">{item.label}</span>
								<button
									type="button"
									onclick={() => removePasskey(item.id)}
									disabled={passkeyBusy}
									class="text-rose-300 underline hover:text-rose-200 disabled:opacity-50"
									>Remove</button
								>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="mt-4 flex flex-col gap-2">
					{#if data.passkeyEnabled}<button
							type="button"
							onclick={addPasskey}
							disabled={passkeyBusy || googleBusy}
							class="neu-btn min-h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-50"
							>{passkeyBusy ? 'Waiting for passkey…' : 'Add passkey'}</button
						>{/if}{#if data.googleEnabled}{#if data.googleAccountId}<button
								type="button"
								onclick={() => unlinkGoogle(data.googleAccountId!)}
								disabled={googleBusy || passkeyBusy}
								class="neu-btn flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-rose-200 disabled:opacity-50"
								>{googleBusy ? 'Unlinking Google…' : 'Unlink Google account'}</button
							>{:else}<button
								type="button"
								onclick={linkGoogle}
								disabled={googleBusy || passkeyBusy}
								class="neu-btn flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50"
								>{googleBusy ? 'Redirecting to Google…' : 'Link Google account'}</button
							>{/if}{/if}
				</div>
				{#if passkeyMessage}<p role="status" class="mt-3 text-xs text-slate-300">
						{passkeyMessage}
					</p>{/if}
			</div>{/if}
	</section>
</main>
