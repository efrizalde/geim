<script lang="ts">
	import type { Snippet } from 'svelte';
	import gsap from 'gsap';
	import type { TierMetadata } from '#lib/server/providers/valorant/assets.js';
	import { resolveRaritySpec, type RarityVisualSpec } from '#lib/rarity.js';

	interface Props {
		tier: TierMetadata | null | undefined;
		class?: string;
		children: Snippet<[RarityVisualSpec]>;
	}

	let { tier, class: className = '', children }: Props = $props();

	let cardEl = $state<HTMLElement | null>(null);
	let active = $state(false);
	let reducedMotion = $state(false);
	$effect(() => {
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => (reducedMotion = media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});

	const spec = $derived(resolveRaritySpec(tier));

	const conicGradientStyle = $derived.by(() => {
		if (spec.rank === 5) {
			// Sovereign Radiant Gold + Prismatic Cyan/Magenta
			return `conic-gradient(from 0deg, transparent 0deg, ${spec.primaryHex} 55deg, #ffffff 80deg, ${spec.tertiaryHex} 125deg, transparent 180deg, ${spec.secondaryHex} 245deg, #f472b6 290deg, ${spec.primaryHex} 335deg, transparent 360deg)`;
		}
		if (spec.rank === 4) {
			// Blazing Solar Flame + VALORANT Crimson
			return `conic-gradient(from 0deg, transparent 0deg, ${spec.primaryHex} 65deg, #fff7ed 92deg, ${spec.tertiaryHex} 140deg, transparent 195deg, ${spec.secondaryHex} 265deg, ${spec.primaryHex} 325deg, transparent 360deg)`;
		}
		// Premium Nebula Magenta-Violet
		return `conic-gradient(from 0deg, transparent 0deg, ${spec.primaryHex} 75deg, ${spec.tertiaryHex} 135deg, transparent 210deg, ${spec.secondaryHex} 300deg, transparent 360deg)`;
	});

	// Continuous GSAP breathing, plasma border, foil sweep, halo & particle orchestration
	$effect(() => {
		const el = cardEl;
		const currentSpec = spec;
		if (!el || !active || typeof window === 'undefined') return;

		if (reducedMotion || currentSpec.rank === 0) return;

		const tweens: gsap.core.Tween[] = [];
		const phaseOffset = 0;

		const ctx = gsap.context(() => {
			const auras = gsap.utils.toArray<HTMLElement>('[data-rarity-aura]');
			if (auras.length > 0 && currentSpec.breathDurationSec > 0) {
				const minOp = 0.22 + currentSpec.rank * 0.06;
				const maxOp = Math.min(1, 0.45 + currentSpec.rank * 0.11);
				tweens.push(
					gsap.fromTo(
						auras,
						{ opacity: minOp, scale: 0.94 },
						{
							opacity: maxOp,
							scale: 1.08,
							duration: currentSpec.breathDurationSec,
							delay: phaseOffset,
							repeat: -1,
							yoyo: true,
							ease: 'sine.inOut'
						}
					)
				);
			}

			const floats = gsap.utils.toArray<HTMLElement>('[data-rarity-float]');
			if (floats.length > 0 && currentSpec.floatAmplitudePx > 0) {
				const rot =
					currentSpec.rank >= 5
						? -1.2
						: currentSpec.rank >= 4
							? -0.9
							: currentSpec.rank >= 3
								? -0.55
								: 0;
				tweens.push(
					gsap.to(floats, {
						y: -currentSpec.floatAmplitudePx,
						rotation: rot,
						duration: currentSpec.breathDurationSec * 0.95,
						delay: phaseOffset,
						repeat: -1,
						yoyo: true,
						ease: 'sine.inOut'
					})
				);
			}

			const conics = gsap.utils.toArray<HTMLElement>('[data-rarity-conic]');
			if (conics.length > 0 && currentSpec.hasAnimatedBorder) {
				tweens.push(
					gsap.to(conics, {
						rotation: 360,
						duration: currentSpec.rank === 5 ? 5.2 : currentSpec.rank === 4 ? 6.8 : 9.2,
						repeat: -1,
						ease: 'none'
					})
				);
			}

			const foils = gsap.utils.toArray<HTMLElement>('[data-rarity-foil]');
			if (foils.length > 0 && currentSpec.hasFoilShimmer) {
				tweens.push(
					gsap.fromTo(
						foils,
						{ xPercent: -140 },
						{
							xPercent: 140,
							duration: currentSpec.rank === 5 ? 3.0 : 3.8,
							delay: phaseOffset,
							repeat: -1,
							repeatDelay: currentSpec.rank === 5 ? 0.8 : 1.6,
							ease: 'power2.inOut'
						}
					)
				);
			}

			const halos = gsap.utils.toArray<HTMLElement>('[data-rarity-halo]');
			if (halos.length > 0 && currentSpec.hasHaloRing) {
				tweens.push(
					gsap.to(halos, {
						rotation: 360,
						duration: currentSpec.rank === 5 ? 15 : 22,
						repeat: -1,
						ease: 'none'
					})
				);
			}

			const motes = gsap.utils.toArray<HTMLElement>('[data-rarity-mote]');
			motes.forEach((mote, i) => {
				const dur = 1.9 + (i % 4) * 0.55;
				const rise = 48 + (i % 5) * 12 + currentSpec.rank * 4;
				const drift = (i % 2 === 0 ? 1 : -1) * (6 + (i % 3) * 5);
				tweens.push(
					gsap.fromTo(
						mote,
						{ y: 10, x: 0, opacity: 0, scale: 0.45 },
						{
							y: -rise,
							x: drift,
							opacity: currentSpec.rank >= 4 ? 0.92 : 0.72,
							scale: currentSpec.rank >= 5 ? 1.3 : 1.05,
							duration: dur,
							delay: (i * 0.31) % 2.4,
							repeat: -1,
							ease: 'power1.out',
							onRepeat() {
								gsap.set(mote, { opacity: 0 });
							}
						}
					)
				);
			});
		}, el);

		const io = new IntersectionObserver(
			(entries) => {
				const visible = entries[0]?.isIntersecting ?? true;
				for (const t of tweens) {
					if (visible) t.resume();
					else t.pause();
				}
			},
			{ rootMargin: '80px' }
		);
		io.observe(el);

		return () => {
			io.disconnect();
			ctx.revert();
		};
	});

	// Interactive GSAP 3D perspective tilt + cursor glare
	let quickRotX: gsap.QuickToFunc | null = null;
	let quickRotY: gsap.QuickToFunc | null = null;
	let quickLift: gsap.QuickToFunc | null = null;

	$effect(() => {
		const el = cardEl;
		if (!el || typeof window === 'undefined') return;
		if (reducedMotion) return;

		gsap.set(el, { transformPerspective: 960 });
		quickRotX = gsap.quickTo(el, 'rotationX', { duration: 0.35, ease: 'power3.out' });
		quickRotY = gsap.quickTo(el, 'rotationY', { duration: 0.35, ease: 'power3.out' });
		quickLift = gsap.quickTo(el, 'y', { duration: 0.28, ease: 'power2.out' });

		return () => {
			quickRotX = null;
			quickRotY = null;
			quickLift = null;
		};
	});

	function handlePointerMove(e: PointerEvent) {
		const el = cardEl;
		if (!el || e.pointerType === 'touch') return;
		const rect = el.getBoundingClientRect();
		const nx = (e.clientX - rect.left) / Math.max(1, rect.width);
		const ny = (e.clientY - rect.top) / Math.max(1, rect.height);

		el.style.setProperty('--gx', `${(nx * 100).toFixed(1)}%`);
		el.style.setProperty('--gy', `${(ny * 100).toFixed(1)}%`);
		el.style.setProperty('--glare-opacity', String(0.08 + spec.rank * 0.045));

		const maxTilt = spec.tiltMaxDeg;
		quickRotY?.((nx - 0.5) * maxTilt * 2);
		quickRotX?.((0.5 - ny) * maxTilt * 1.7);
		quickLift?.(-3 - spec.rank * 0.45);
	}

	function handlePointerLeave() {
		const el = cardEl;
		if (el) {
			el.style.setProperty('--glare-opacity', '0');
		}
		quickRotX?.(0);
		quickRotY?.(0);
		quickLift?.(0);
	}
</script>

<article
	bind:this={cardEl}
	data-rarity={spec.key}
	onpointerenter={(event) => {
		if (event.pointerType !== 'touch') active = true;
	}}
	onfocusin={() => (active = true)}
	onfocusout={(event) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) active = false;
	}}
	onpointermove={handlePointerMove}
	onpointerleave={(event) => {
		if (!event.currentTarget.contains(document.activeElement)) active = false;
		handlePointerLeave();
	}}
	class="glass-card rarity-card group relative flex flex-col justify-between rounded-2xl {className}"
	style="border-color: {spec.borderBaseRgba};"
>
	<!-- Clipped Ambient & Border FX Layer (keeps outer overflow visible for StarLevelIndicator tooltips!) -->
	<div class="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
		<!-- Top Specular Edge Hairline -->
		<div
			class="absolute inset-x-0 top-0 h-[1.5px]"
			style="background: linear-gradient(90deg, transparent 5%, {spec.primaryHex} 50%, transparent 95%); opacity: {0.45 +
				spec.rank * 0.1};"
		></div>

		<!-- Breathing Card Ambient Underglow (Tier 1+) -->
		{#if spec.rank >= 1}
			<div
				data-rarity-aura
				class="absolute -inset-6 rounded-3xl"
				style="opacity: 0.45; background: radial-gradient(circle at 50% 0%, {spec.glowRgba} 0%, transparent 62%), radial-gradient(circle at 50% 100%, {spec.glowRgba} 0%, transparent 68%);"
			></div>
		{/if}

		<!-- Animated Rotating Conic Energy Border (Tier 3 Premium, Tier 4 Exclusive, Tier 5 Ultra) -->
		{#if spec.hasAnimatedBorder}
			<div
				style="--idle-border-low: {spec.rank === 5 ? 0.62 : spec.rank === 4 ? 0.5 : 0.35}; --idle-border-high: {spec.rank === 5 ? 0.85 : spec.rank === 4 ? 0.7 : 0.5};"
				class="rarity-conic-mask absolute inset-0 rounded-2xl transition-opacity duration-300 {spec.rank ===
				5
					? 'opacity-85 group-hover:opacity-100'
					: spec.rank === 4
						? 'opacity-70 group-hover:opacity-95'
						: 'opacity-50 group-hover:opacity-85'}"
			>
				<div
					data-rarity-conic
					class="absolute top-1/2 left-1/2 aspect-square w-[220%] -translate-x-1/2 -translate-y-1/2"
					style="background: {conicGradientStyle};"
				></div>
			</div>
		{/if}

		<!-- Tactical Corner Bevel Brackets (Tier 2+ escalating sharpness) -->
		{#if spec.rank >= 2}
			<span
				class="absolute top-1.5 left-1.5 h-2.5 w-2.5 rounded-tl-md border-t border-l transition-opacity duration-300"
				style="border-color: {spec.primaryHex}; opacity: {0.35 + spec.rank * 0.1};"
			></span>
			<span
				class="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-tr-md border-t border-r transition-opacity duration-300"
				style="border-color: {spec.primaryHex}; opacity: {0.35 + spec.rank * 0.1};"
			></span>
			{#if spec.rank >= 4}
				<span
					class="absolute bottom-1.5 left-1.5 h-2.5 w-2.5 rounded-bl-md border-b border-l"
					style="border-color: {spec.secondaryHex}; opacity: {0.3 + spec.rank * 0.1};"
				></span>
				<span
					class="absolute right-1.5 bottom-1.5 h-2.5 w-2.5 rounded-br-md border-r border-b"
					style="border-color: {spec.secondaryHex}; opacity: {0.3 + spec.rank * 0.1};"
				></span>
			{/if}
		{/if}

		<!-- Dynamic Pointer Specular Holographic Glare -->
		<div
			class="absolute inset-0 transition-opacity duration-200"
			style="opacity: var(--glare-opacity, 0); background: radial-gradient(circle 190px at var(--gx, 50%) var(--gy, 50%), {spec.rank ===
			5
				? 'rgba(255, 244, 180, 0.55)'
				: 'rgba(255, 255, 255, 0.42)'}, {spec.glowRgba} 45%, transparent 78%); mix-blend-mode: screen;"
		></div>
	</div>

	{@render children(spec)}
</article>
