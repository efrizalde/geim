<script lang="ts">
	import { tick } from 'svelte';
	import { X } from '@lucide/svelte';
	import type { SkinInspectorPayload } from './SkinInspectorModal.svelte';

	let { target, onClose }: { target: SkinInspectorPayload; onClose: () => void } = $props();
	let dialog: HTMLDialogElement;
	let Inspector = $state<typeof import('./SkinInspectorModal.svelte').default | null>(null);
	let failed = $state(false);

	$effect(() => {
		let cancelled = false;
		dialog.showModal();
		import('./SkinInspectorModal.svelte')
			.then(async (module) => {
				if (cancelled) return;
				Inspector = module.default;
				await tick();
				if (!cancelled)
					dialog
						.querySelector<HTMLButtonElement>(
							window.matchMedia('(min-width: 640px)').matches
								? '[data-inspector-close="desktop"]'
								: '[data-inspector-close="mobile"]'
						)
						?.focus();
			})
			.catch(() => {
				if (!cancelled) failed = true;
			});
		return () => {
			cancelled = true;
		};
	});
</script>

<dialog
	bind:this={dialog}
	onclose={onClose}
	onclick={(event) => {
		if (event.target === dialog) dialog.close();
	}}
	aria-label="{target.skinName} 360 degree and level inspector"
	class="geim-dialog m-auto max-h-[92dvh] w-[calc(100%_-_1.5rem)] max-w-4xl overflow-y-auto overscroll-contain rounded-2xl bg-transparent p-0 text-slate-200"
>
	{#if Inspector}
		<Inspector {target} onClose={() => dialog.close()} />
	{:else}
		<div class="glass-neu rounded-2xl p-4 sm:p-6">
			<div class="flex items-start justify-between gap-4">
				{#if failed}
					<p role="alert" class="text-sm text-slate-200">
						Could not load the inspector. Close and try again.
					</p>
				{:else}
					<div
						role="status"
						aria-label="Loading weapon inspector"
						class="flex flex-1 flex-col gap-2 pt-1"
					>
						<span class="inspector-shimmer h-3 w-28 rounded"></span>
						<span class="inspector-shimmer h-6 w-48 max-w-full rounded"></span>
					</div>
				{/if}
				<button
					type="button"
					class="neu-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
					aria-label="Close inspector"
					onclick={() => dialog.close()}><X class="h-5 w-5" /></button
				>
			</div>
			{#if !failed}
				<div aria-hidden="true" class="mt-4 flex flex-col gap-4">
					<div class="inspector-shimmer h-9 w-44 max-w-full rounded-xl"></div>
					<div class="inspector-shimmer aspect-video w-full rounded-xl"></div>
					<div class="flex gap-2">
						<span class="inspector-shimmer h-11 w-11 rounded-xl"></span><span
							class="inspector-shimmer h-11 w-11 rounded-xl"
						></span><span class="inspector-shimmer h-11 w-11 rounded-xl"></span>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</dialog>

<style>
	.inspector-shimmer {
		background: linear-gradient(90deg, #1b2433, #303c4e, #1b2433);
		background-size: 200% 100%;
	}
	@media (prefers-reduced-motion: no-preference) {
		.inspector-shimmer {
			animation: shimmer 1.5s linear infinite;
		}
	}
	@keyframes shimmer {
		to {
			background-position: -200% 0;
		}
	}
</style>
