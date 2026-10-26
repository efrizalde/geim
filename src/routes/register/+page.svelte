<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Eye, EyeOff, Lock, ShieldCheck, User } from '@lucide/svelte';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	let showPassword = $state(false);
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Create Account | g.</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
	<section class="glass-neu flex flex-col gap-6 rounded-2xl p-7 sm:p-8">
		<div class="flex items-center gap-4">
			<BrandLogo size="lg" />
			<div>
				<span class="font-mono text-[10px] font-semibold tracking-widest text-neu-cyan uppercase">
					Your Game Accounts
				</span>
				<h1 class="font-display text-xl font-bold text-white">
					Create your geim<span class="text-neu-accent">.</span> account
				</h1>
			</div>
		</div>

		<p class="text-sm leading-relaxed text-slate-400">
			Choose a username and password for geim, not your Riot login. Your connected Riot accounts and
			saved syncs belong to this account.
		</p>

		{#if form?.error}
			<div
				role="alert"
				class="neu-well rounded-xl border border-rose-500/35 px-4 py-3 text-xs font-medium text-rose-300"
			>
				{form.error}
			</div>
		{/if}

		<form
			method="POST"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					submitting = false;
					await update();
				};
			}}
			class="flex flex-col gap-5"
		>
			<div class="flex flex-col gap-2">
				<label for="username" class="text-xs font-semibold text-slate-200">Username</label>
				<div class="neu-well flex items-center rounded-xl px-3.5">
					<User class="mr-2.5 h-4 w-4 shrink-0 text-slate-400" />
					<input
						id="username"
						name="username"
						autocomplete="username"
						autocapitalize="none"
						spellcheck={false}
						minlength={3}
						maxlength={32}
						pattern={'[a-zA-Z0-9_]{3,32}'}
						aria-describedby="username-help"
						required
						placeholder="Choose username…"
						class="w-full bg-transparent text-sm text-white placeholder:text-slate-400"
					/>
				</div>
				<p id="username-help" class="text-xs text-slate-400">
					3-32 letters, numbers, or underscores. Not case-sensitive.
				</p>
			</div>
			<div class="flex flex-col gap-2">
				<label for="password" class="text-xs font-semibold text-slate-200">
					Password
					<span class="ml-1 font-mono font-normal text-slate-400">(min 4 chars)</span>
				</label>
				<div class="neu-well flex items-center rounded-xl px-3.5">
					<Lock class="mr-2.5 h-4 w-4 shrink-0 text-slate-400" />
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						minlength={4}
						maxlength={128}
						required
						autocomplete="new-password"
						placeholder="Enter password…"
						class="w-full bg-transparent text-sm text-white placeholder:text-slate-400"
					/>
					<button
						type="button"
						onclick={() => (showPassword = !showPassword)}
						class="ml-2 cursor-pointer rounded-lg text-slate-400 transition hover:text-white"
						aria-label={showPassword ? 'Hide password' : 'Show password'}
					>
						{#if showPassword}
							<EyeOff class="h-4 w-4" />
						{:else}
							<Eye class="h-4 w-4" />
						{/if}
					</button>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<label for="confirmPassword" class="text-xs font-semibold text-slate-200">
					Confirm Password
				</label>
				<div class="neu-well flex items-center rounded-xl px-3.5">
					<ShieldCheck class="mr-2.5 h-4 w-4 shrink-0 text-slate-400" />
					<input
						id="confirmPassword"
						name="confirmPassword"
						type={showPassword ? 'text' : 'password'}
						minlength={4}
						maxlength={128}
						required
						autocomplete="new-password"
						placeholder="Repeat password…"
						class="w-full bg-transparent text-sm text-white placeholder:text-slate-400"
					/>
				</div>
			</div>

			<button
				type="submit"
				disabled={submitting}
				class="neu-btn-accent mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-60"
			>
				<ShieldCheck class="h-4 w-4" />
				<span>{submitting ? 'Creating account...' : 'Create Account'}</span>
			</button>
		</form>
		<p class="text-center text-sm text-slate-400">
			Already registered? <a href={resolve('/login')} class="text-neu-cyan underline">Log in</a>
		</p>
	</section>
</main>
