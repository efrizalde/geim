<script lang="ts">
	import { tick } from 'svelte';
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
	class="geim-dialog mt-auto mb-0 max-h-[94dvh] w-full max-w-4xl overflow-y-auto overscroll-contain rounded-t-2xl bg-transparent p-0 text-slate-200 sm:m-auto sm:max-h-[92dvh] sm:w-[calc(100%_-_1.5rem)] sm:rounded-2xl"
>
	{#if Inspector}
		<Inspector {target} onClose={() => dialog.close()} />
	{:else}
		<div class="glass-neu flex items-center justify-between gap-4 rounded-2xl p-6">
			<p role="status">
				{failed ? 'Could not load the inspector. Close and try again.' : 'Loading inspector…'}
			</p>
			<button type="button" class="neu-btn min-h-11 rounded-xl px-4" onclick={() => dialog.close()}
				>Close</button
			>
		</div>
	{/if}
</dialog>
