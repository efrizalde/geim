<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Eye, EyeOff, KeyRound, Lock, User } from '@lucide/svelte';
	import BrandLogo from '#lib/components/BrandLogo.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	let showPassword = $state(false);
	let submitting = $state(false);
</script>

<svelte:head>
	<title>Log In | g.</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
	<section class="glass-neu flex flex-col gap-6 rounded-2xl p-7 sm:p-8">
		<div class="flex items-center gap-4">
			<BrandLogo size="lg" />
			<div>
				<span class="font-mono text-[10px] font-semibold tracking-widest text-amber-300 uppercase">
					Your Game Accounts
				</span>
				<h1 class="font-display text-xl font-bold text-white">
					Log in to geim<span class="text-neu-accent">.</span>
				</h1>
			</div>
		</div>

		<p class="text-sm leading-relaxed text-slate-400">
			Use your geim username and password to access your saved Riot accounts. Existing vault owners
			can log in with the username <strong class="text-slate-200">owner</strong>.
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
						required
						autocomplete="username"
						autocapitalize="none"
						spellcheck={false}
						minlength={3}
						maxlength={32}
						placeholder="Enter username…"
						class="w-full bg-transparent text-sm text-white placeholder:text-slate-400"
					/>
				</div>
			</div>
			<div class="flex flex-col gap-2">
				<label for="password" class="text-xs font-semibold text-slate-200">Password</label>
				<div class="neu-well flex items-center rounded-xl px-3.5">
					<Lock class="mr-2.5 h-4 w-4 shrink-0 text-slate-400" />
					<input
						id="password"
						name="password"
						type={showPassword ? 'text' : 'password'}
						minlength={4}
						maxlength={128}
						required
						autocomplete="current-password"
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

			<button
				type="submit"
				disabled={submitting}
				class="neu-btn-accent mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-60"
			>
				<KeyRound class="h-4 w-4" />
				<span>{submitting ? 'Logging in...' : 'Log In'}</span>
			</button>
		</form>
		<p class="text-center text-sm text-slate-400">
			New to geim? <a href={resolve('/register')} class="text-neu-cyan underline"
				>Create an account</a
			>
		</p>
	</section>
</main>
