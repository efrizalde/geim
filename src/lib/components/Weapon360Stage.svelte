<script lang="ts">
	import {
		FlipHorizontal2,
		Pause,
		Play,
		Rotate3d,
		RotateCcw,
		ZoomIn,
		ZoomOut
	} from '@lucide/svelte';
	import gsap from 'gsap';
	import * as THREE from 'three';
	import type { TierMetadata } from '#lib/server/providers/valorant/assets.js';
	import { resolveRaritySpec, toProxiedValorantMediaUrl } from '#lib/rarity.js';

	interface Props {
		imageUrl: string | null;
		label: string;
		tier?: TierMetadata | null;
	}

	let { imageUrl, label, tier = null }: Props = $props();

	const spec = $derived(resolveRaritySpec(tier));

	let stageEl = $state<HTMLDivElement | null>(null);
	let isDragging = $state(false);
	let autoSpin = $state(true);
	let reducedMotion = $state(false);
	let requestRender = () => {};
	let loadingTexture = $state(false);
	let webglFallback = $state(false);

	const DEFAULT_YAW = 0;
	const DEFAULT_PITCH = 0;
	const DEFAULT_ZOOM = 1;
	const IDLE_RETURN_DELAY_MS = 3_000;

	// Live telemetry for HUD + CSS 3D fallback
	let displayYawDeg = $state(0);
	let displayPitchDeg = $state(0);
	let displayZoom = $state(1);

	// Mutable physics & idle state shared with RAF loop
	const control = {
		targetYaw: DEFAULT_YAW,
		currentYaw: DEFAULT_YAW,
		velYaw: 0,
		targetPitch: DEFAULT_PITCH,
		currentPitch: DEFAULT_PITCH,
		velPitch: 0,
		targetZoom: DEFAULT_ZOOM,
		currentZoom: DEFAULT_ZOOM,
		dragging: false,
		idlePaused: false,
		returningToDefault: false,
		lastX: 0,
		lastY: 0
	};

	let idleTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const media = window.matchMedia('(prefers-reduced-motion: reduce)');
		const update = () => {
			reducedMotion = media.matches;
			if (media.matches) autoSpin = false;
			requestRender();
		};
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	});

	function clearIdleTimer() {
		if (idleTimer !== null) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
	}

	function syncFallbackTelemetry() {
		requestRender();
		if (!webglFallback) return;
		const rawDeg = Math.round((control.targetYaw * 180) / Math.PI) % 360;
		displayYawDeg = (rawDeg + 360) % 360;
		displayPitchDeg = Math.round((control.targetPitch * 180) / Math.PI);
		displayZoom = Number(control.targetZoom.toFixed(2));
	}

	function returnToDefaultPose(durationSec = 0.68) {
		clearIdleTimer();
		gsap.killTweensOf(control);
		control.velYaw = 0;
		control.velPitch = 0;
		control.returningToDefault = true;

		// Shortest angular path back to DEFAULT_YAW so multiple full turns don't unwind wildly
		const turns = Math.round((control.targetYaw - DEFAULT_YAW) / (Math.PI * 2));
		const nearestDefaultYaw = DEFAULT_YAW + turns * Math.PI * 2;

		gsap.to(control, {
			targetYaw: nearestDefaultYaw,
			targetPitch: DEFAULT_PITCH,
			targetZoom: DEFAULT_ZOOM,
			duration: durationSec,
			ease: 'power3.inOut',
			onUpdate: syncFallbackTelemetry,
			onComplete: () => {
				const residual = control.currentYaw - nearestDefaultYaw;
				control.targetYaw = DEFAULT_YAW;
				control.currentYaw = DEFAULT_YAW + residual;
				control.returningToDefault = false;
				control.idlePaused = false;
				syncFallbackTelemetry();
			}
		});
	}

	function scheduleIdleReset() {
		clearIdleTimer();
		if (reducedMotion) return;
		idleTimer = setTimeout(() => {
			idleTimer = null;
			if (!control.dragging) {
				returnToDefaultPose(0.68);
			}
		}, IDLE_RETURN_DELAY_MS);
	}

	function toSafeTextureUrl(rawUrl: string): string {
		return toProxiedValorantMediaUrl(rawUrl) ?? rawUrl;
	}

	function createSoftSparkTexture(): THREE.CanvasTexture {
		const canvas = document.createElement('canvas');
		canvas.width = 64;
		canvas.height = 64;
		const ctx = canvas.getContext('2d');
		if (ctx) {
			const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
			grad.addColorStop(0, 'rgba(255,255,255,1)');
			grad.addColorStop(0.35, 'rgba(255,255,255,0.65)');
			grad.addColorStop(1, 'rgba(255,255,255,0)');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, 64, 64);
		}
		const tex = new THREE.CanvasTexture(canvas);
		tex.needsUpdate = true;
		return tex;
	}

	function disposeObjectTree(root: THREE.Object3D) {
		root.traverse((obj) => {
			if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
				obj.geometry?.dispose();
				const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
				for (const m of mats) {
					if (!m) continue;
					if ('map' in m && m.map instanceof THREE.Texture) {
						m.map.dispose();
					}
					m.dispose();
				}
			}
		});
	}

	// Shared Three.js scene handles for reactive texture & rarity updates
	let threeHandles = $state<{
		renderer: THREE.WebGLRenderer;
		weaponHolder: THREE.Group;
		rarityLight: THREE.PointLight;
		rimLight: THREE.PointLight;
		outerRingMat: THREE.MeshBasicMaterial;
		innerRingMat: THREE.LineBasicMaterial;
		sparksMat: THREE.PointsMaterial;
	} | null>(null);

	// 1. Initialize Three.js Studio Scene, Pedestal Rings, Starfield & Render Loop
	$effect(() => {
		const container = stageEl;
		if (!container || typeof window === 'undefined') return;

		let renderer: THREE.WebGLRenderer;
		try {
			renderer = new THREE.WebGLRenderer({
				antialias: true,
				alpha: true,
				powerPreference: 'high-performance'
			});
		} catch {
			webglFallback = true;
			return;
		}

		renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.15;

		const initW = Math.max(1, container.clientWidth);
		const initH = Math.max(1, container.clientHeight);
		renderer.setSize(initW, initH);
		renderer.domElement.className = 'h-full w-full block select-none';
		container.appendChild(renderer.domElement);

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(36, initW / initH, 0.1, 60);
		camera.position.set(0, 0.14, 6.2);

		// Studio 4-Point Lighting Rig
		const ambient = new THREE.AmbientLight('#f8fafc', 1.45);
		scene.add(ambient);

		const keyLight = new THREE.DirectionalLight('#ffffff', 2.1);
		keyLight.position.set(3.2, 4.5, 5.5);
		scene.add(keyLight);

		const backFill = new THREE.DirectionalLight('#cbd5e1', 1.35);
		backFill.position.set(-3.5, 2.2, -5.0);
		scene.add(backFill);

		const rarityLight = new THREE.PointLight(spec.primaryHex, 3.4, 14, 1.5);
		rarityLight.position.set(0, -1.3, 1.8);
		scene.add(rarityLight);

		const rimLight = new THREE.PointLight(spec.secondaryHex, 2.6, 14, 1.5);
		rimLight.position.set(-2.8, 1.8, 2.6);
		scene.add(rimLight);

		// Weapon Root Pivot (receives 360° yaw & pitch) + Inner Floating Holder
		const weaponPivot = new THREE.Group();
		weaponPivot.position.set(0, 0.12, 0);
		scene.add(weaponPivot);

		const weaponHolder = new THREE.Group();
		weaponPivot.add(weaponHolder);

		// Holographic Rarity Turntable Pedestal
		const pedestalGroup = new THREE.Group();
		pedestalGroup.position.set(0, -1.28, 0);
		scene.add(pedestalGroup);

		const outerRingGeo = new THREE.RingGeometry(1.95, 2.02, 72);
		outerRingGeo.rotateX(-Math.PI / 2);
		const outerRingMat = new THREE.MeshBasicMaterial({
			color: spec.primaryHex,
			transparent: true,
			opacity: 0.42,
			side: THREE.DoubleSide
		});
		const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
		pedestalGroup.add(outerRingMesh);

		// Segmented inner telemetry ring
		const dashPts: THREE.Vector3[] = [];
		const segs = 64;
		for (let i = 0; i < segs; i++) {
			const angle = (i / segs) * Math.PI * 2;
			dashPts.push(new THREE.Vector3(Math.cos(angle) * 1.42, 0, Math.sin(angle) * 1.42));
		}
		const innerRingGeo = new THREE.BufferGeometry().setFromPoints(dashPts);
		const innerRingMat = new THREE.LineBasicMaterial({
			color: spec.secondaryHex,
			transparent: true,
			opacity: 0.35
		});
		const innerRingLoop = new THREE.LineLoop(innerRingGeo, innerRingMat);
		pedestalGroup.add(innerRingLoop);

		// Ambient 3D Floating Starfield Sparks
		const sparkCount = 44;
		const sparkPositions = new Float32Array(sparkCount * 3);
		for (let i = 0; i < sparkCount; i++) {
			const r = 1.4 + Math.random() * 2.4;
			const theta = Math.random() * Math.PI * 2;
			sparkPositions[i * 3] = Math.cos(theta) * r;
			sparkPositions[i * 3 + 1] = (Math.random() - 0.42) * 2.6;
			sparkPositions[i * 3 + 2] = Math.sin(theta) * r * 0.7;
		}
		const sparksGeo = new THREE.BufferGeometry();
		sparksGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
		const sparkSprite = createSoftSparkTexture();
		const sparksMat = new THREE.PointsMaterial({
			color: spec.primaryHex,
			size: 0.085,
			map: sparkSprite,
			transparent: true,
			opacity: 0.65,
			depthWrite: false,
			blending: THREE.AdditiveBlending
		});
		const sparksPoints = new THREE.Points(sparksGeo, sparksMat);
		scene.add(sparksPoints);

		threeHandles = {
			renderer,
			weaponHolder,
			rarityLight,
			rimLight,
			outerRingMat,
			innerRingMat,
			sparksMat
		};

		const ro = new ResizeObserver(() => {
			const w = Math.max(1, container.clientWidth);
			const h = Math.max(1, container.clientHeight);
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
			requestRender();
		});
		ro.observe(container);

		let rafId = 0;
		let lastTime = performance.now();
		let hudTick = 0;
		let visible = true;
		const scheduleFrame = () => {
			if (!rafId && visible && !document.hidden) rafId = requestAnimationFrame(tick);
		};
		requestRender = scheduleFrame;
		const visibility = new IntersectionObserver(([entry]) => {
			visible = entry.isIntersecting;
			if (visible) {
				lastTime = performance.now();
				scheduleFrame();
			} else {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
		});
		visibility.observe(container);
		const onVisibilityChange = () => {
			if (document.hidden) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			} else {
				lastTime = performance.now();
				scheduleFrame();
			}
		};
		document.addEventListener('visibilitychange', onVisibilityChange);

		const tick = (now: number) => {
			rafId = 0;
			const dt = Math.min(0.05, (now - lastTime) / 1000);
			lastTime = now;
			const elapsed = now * 0.001;

			if (!control.dragging && !control.returningToDefault) {
				if (Math.abs(control.velYaw) > 0.0002 || Math.abs(control.velPitch) > 0.0002) {
					control.targetYaw += control.velYaw;
					control.targetPitch = Math.max(
						-0.85,
						Math.min(0.85, control.targetPitch + control.velPitch)
					);
					control.velYaw *= 0.92;
					control.velPitch *= 0.9;
				} else if (!control.idlePaused && autoSpin) {
					control.targetYaw += dt * 0.52;
				}
			}

			control.currentYaw += (control.targetYaw - control.currentYaw) * 0.16;
			control.currentPitch += (control.targetPitch - control.currentPitch) * 0.16;
			control.currentZoom += (control.targetZoom - control.currentZoom) * 0.16;

			weaponPivot.rotation.y = control.currentYaw;
			weaponPivot.rotation.x = control.currentPitch;

			// Gentle showroom levitation
			if (autoSpin) weaponHolder.position.y = Math.sin(elapsed * 1.8) * 0.055;

			// Camera zoom distance
			camera.position.z = 6.2 / control.currentZoom;
			camera.lookAt(0, 0.05, 0);

			// Orbiting rim highlight + pedestal & starfield drift
			if (autoSpin) {
				rimLight.position.x = Math.cos(elapsed * 0.9) * 3.2;
				rimLight.position.z = Math.sin(elapsed * 0.9) * 2.8 + 1.4;
				pedestalGroup.rotation.y = -control.currentYaw * 0.5 + elapsed * 0.18;
				sparksPoints.rotation.y = elapsed * 0.08;
			}

			renderer.render(scene, camera);

			hudTick = (hudTick + 1) % 3;
			if (hudTick === 0) {
				const rawDeg = Math.round((control.currentYaw * 180) / Math.PI) % 360;
				displayYawDeg = (rawDeg + 360) % 360;
				displayPitchDeg = Math.round((control.currentPitch * 180) / Math.PI);
				displayZoom = Number(control.currentZoom.toFixed(2));
			}
			if (
				autoSpin ||
				control.dragging ||
				control.returningToDefault ||
				gsap.isTweening(control) ||
				Math.abs(control.velYaw) > 0.0002 ||
				Math.abs(control.velPitch) > 0.0002 ||
				Math.abs(control.targetYaw - control.currentYaw) > 0.0005 ||
				Math.abs(control.targetPitch - control.currentPitch) > 0.0005 ||
				Math.abs(control.targetZoom - control.currentZoom) > 0.0005
			)
				scheduleFrame();
		};

		scheduleFrame();

		return () => {
			clearIdleTimer();
			gsap.killTweensOf(control);
			cancelAnimationFrame(rafId);
			ro.disconnect();
			visibility.disconnect();
			document.removeEventListener('visibilitychange', onVisibilityChange);
			requestRender = () => {};
			threeHandles = null;
			sparkSprite.dispose();
			disposeObjectTree(scene);
			renderer.dispose();
			renderer.domElement.remove();
		};
	});

	// 2. Reactively update Rarity Lighting / Pedestal Colors
	$effect(() => {
		const h = threeHandles;
		if (!h) return;
		h.rarityLight.color.set(spec.primaryHex);
		h.rarityLight.intensity = 2.4 + spec.rank * 0.55;
		h.rimLight.color.set(spec.secondaryHex);
		h.outerRingMat.color.set(spec.primaryHex);
		h.innerRingMat.color.set(spec.secondaryHex);
		h.sparksMat.color.set(spec.primaryHex);
		requestRender();
	});

	// 3. Reactively Load & Extrude High-Res Weapon Texture into Volumetric 3D Silhouette
	$effect(() => {
		const h = threeHandles;
		const rawUrl = imageUrl;
		if (!h) return;

		// Clear previous weapon meshes if url becomes null
		if (!rawUrl) {
			while (h.weaponHolder.children.length > 0) {
				const child = h.weaponHolder.children[0];
				disposeObjectTree(child);
				h.weaponHolder.remove(child);
			}
			requestRender();
			return;
		}

		let cancelled = false;
		loadingTexture = true;

		const loader = new THREE.TextureLoader();
		loader.setCrossOrigin('anonymous');

		loader.load(
			toSafeTextureUrl(rawUrl),
			(frontTex) => {
				if (cancelled) {
					frontTex.dispose();
					return;
				}
				loadingTexture = false;

				frontTex.colorSpace = THREE.SRGBColorSpace;
				frontTex.anisotropy = h.renderer.capabilities.getMaxAnisotropy();
				frontTex.generateMipmaps = true;
				frontTex.minFilter = THREE.LinearMipmapLinearFilter;
				frontTex.magFilter = THREE.LinearFilter;

				// Clear previous weapon group
				while (h.weaponHolder.children.length > 0) {
					const old = h.weaponHolder.children[0];
					disposeObjectTree(old);
					h.weaponHolder.remove(old);
				}

				const img = frontTex.image as
					| { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number }
					| undefined;
				const iw = img?.naturalWidth || img?.width || 1024;
				const ih = img?.naturalHeight || img?.height || 360;
				const aspect = Math.max(0.5, iw / Math.max(1, ih));

				let planeW = 4.65;
				let planeH = planeW / aspect;
				if (planeH > 2.35) {
					planeH = 2.35;
					planeW = planeH * aspect;
				}

				const modelGroup = new THREE.Group();
				const halfDepth = 0.042;

				// A) Front High-Res Specular Plate (+Z)
				const frontGeo = new THREE.PlaneGeometry(planeW, planeH);
				const frontMat = new THREE.MeshStandardMaterial({
					map: frontTex,
					transparent: true,
					alphaTest: 0.025,
					roughness: 0.28,
					metalness: 0.36
				});
				const frontMesh = new THREE.Mesh(frontGeo, frontMat);
				frontMesh.position.z = halfDepth;
				modelGroup.add(frontMesh);

				// B) Back High-Res Aligned Silhouette Plate (-Z, flipped UVs so reverse side matches silhouette 1:1!)
				const backTex = frontTex.clone();
				backTex.colorSpace = THREE.SRGBColorSpace;
				backTex.wrapS = THREE.RepeatWrapping;
				backTex.repeat.x = -1;
				backTex.offset.x = 1;
				backTex.needsUpdate = true;

				const backGeo = new THREE.PlaneGeometry(planeW, planeH);
				const backMat = new THREE.MeshStandardMaterial({
					map: backTex,
					transparent: true,
					alphaTest: 0.025,
					roughness: 0.32,
					metalness: 0.36
				});
				const backMesh = new THREE.Mesh(backGeo, backMat);
				backMesh.rotation.y = Math.PI;
				backMesh.position.z = -halfDepth;
				modelGroup.add(backMesh);

				// C) 18 Stacked Gunmetal + Rarity-Rimmed Extrusion Slices for Solid 90°/270° Edge Thickness
				const sliceCount = 18;
				const sliceMat = new THREE.MeshStandardMaterial({
					map: frontTex,
					color: new THREE.Color('#1e293b'),
					emissive: new THREE.Color(spec.primaryHex),
					emissiveIntensity: 0.25 + spec.rank * 0.08,
					transparent: true,
					alphaTest: 0.14,
					roughness: 0.45,
					metalness: 0.75,
					side: THREE.DoubleSide
				});
				const sharedSliceGeo = new THREE.PlaneGeometry(planeW, planeH);

				for (let i = 1; i <= sliceCount; i++) {
					const t = i / (sliceCount + 1);
					const z = -halfDepth + t * (halfDepth * 2);
					const sliceMesh = new THREE.Mesh(sharedSliceGeo, sliceMat);
					sliceMesh.position.z = z;
					modelGroup.add(sliceMesh);
				}

				h.weaponHolder.add(modelGroup);
				requestRender();

				// Crisp GSAP showcase pop + subtle spin flourish on skin/variant swap
				if (!reducedMotion)
					gsap.fromTo(
						modelGroup.scale,
						{ x: 0.86, y: 0.86, z: 0.86 },
						{ x: 1, y: 1, z: 1, duration: 0.45, ease: 'back.out(1.6)', onUpdate: requestRender }
					);
			},
			undefined,
			() => {
				if (!cancelled) {
					loadingTexture = false;
					webglFallback = true;
				}
			}
		);

		return () => {
			cancelled = true;
		};
	});

	// Pointer Drag & Wheel Zoom Handlers (works for both WebGL & CSS 3D fallback)
	function onPointerDown(e: PointerEvent) {
		if ((e.target as HTMLElement | null)?.closest('button')) return;
		clearIdleTimer();
		gsap.killTweensOf(control);
		control.dragging = true;
		control.idlePaused = true;
		control.returningToDefault = false;
		isDragging = true;
		control.velYaw = 0;
		control.velPitch = 0;
		control.lastX = e.clientX;
		control.lastY = e.clientY;
		requestRender();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!control.dragging) return;
		const dx = e.clientX - control.lastX;
		const dy = e.clientY - control.lastY;
		control.lastX = e.clientX;
		control.lastY = e.clientY;

		const yawStep = dx * 0.011;
		const pitchStep = dy * 0.008;

		control.targetYaw += yawStep;
		control.targetPitch = Math.max(-0.85, Math.min(0.85, control.targetPitch + pitchStep));
		control.velYaw = yawStep * 0.45;
		control.velPitch = pitchStep * 0.35;

		syncFallbackTelemetry();
	}

	function onPointerUp(e: PointerEvent) {
		if (!control.dragging) return;
		control.dragging = false;
		isDragging = false;
		requestRender();
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch {
			// Ignore if already released
		}
		scheduleIdleReset();
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		gsap.killTweensOf(control);
		control.idlePaused = true;
		control.returningToDefault = false;
		const next = control.targetZoom - e.deltaY * 0.0012;
		control.targetZoom = Math.max(0.65, Math.min(1.85, next));
		syncFallbackTelemetry();
		scheduleIdleReset();
	}

	function stepZoom(delta: number) {
		clearIdleTimer();
		gsap.killTweensOf(control);
		control.idlePaused = true;
		control.returningToDefault = false;
		gsap.to(control, {
			targetZoom: Math.max(0.65, Math.min(1.85, control.targetZoom + delta)),
			duration: 0.3,
			ease: 'power2.out',
			onUpdate: syncFallbackTelemetry,
			onComplete: scheduleIdleReset
		});
	}

	function flip180() {
		clearIdleTimer();
		gsap.killTweensOf(control);
		control.idlePaused = true;
		control.returningToDefault = false;
		control.velYaw = 0;
		gsap.to(control, {
			targetYaw: control.targetYaw + Math.PI,
			duration: 0.65,
			ease: 'power3.inOut',
			onUpdate: syncFallbackTelemetry,
			onComplete: scheduleIdleReset
		});
	}

	function spinFull360() {
		clearIdleTimer();
		gsap.killTweensOf(control);
		control.idlePaused = true;
		control.returningToDefault = false;
		control.velYaw = 0;
		gsap.to(control, {
			targetYaw: control.targetYaw + Math.PI * 2,
			duration: 1.05,
			ease: 'power2.inOut',
			onUpdate: syncFallbackTelemetry,
			onComplete: scheduleIdleReset
		});
	}

	function toggleAutoSpin() {
		autoSpin = !autoSpin;
		requestRender();
		if (!autoSpin) {
			// When turning Auto-Spin OFF while off-center, return to default pose after 3s of no activity
			control.idlePaused = true;
			scheduleIdleReset();
		} else if (control.idlePaused) {
			scheduleIdleReset();
		}
	}

	function resetCamera() {
		returnToDefaultPose(0.5);
	}
</script>

<div
	role="application"
	aria-label="Interactive 360 degree weapon viewer for {label}. Drag horizontally or vertically to rotate 360 degrees, scroll to zoom."
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
	onwheel={onWheel}
	class="relative aspect-16/10 w-full touch-none overflow-hidden select-none sm:aspect-video {isDragging
		? 'cursor-grabbing'
		: 'cursor-grab'}"
	style="background: radial-gradient(ellipse at 50% 48%, {spec.glowStrongRgba} 0%, rgba(11, 16, 28, 0.94) 55%, #05070d 100%);"
>
	<!-- Subtle Architectural Tactical Grid Backdrop -->
	<div
		class="pointer-events-none absolute inset-0 opacity-25"
		style="background-image: linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px); background-size: 36px 36px;"
	></div>

	<!-- Three.js WebGL Stage Container -->
	{#if !webglFallback}
		<div bind:this={stageEl} class="absolute inset-0"></div>
	{:else}
		<!-- Graceful CSS 3D Preserve-3D Turntable Fallback -->
		<div class="absolute inset-0 flex items-center justify-center p-8" style="perspective: 1100px;">
			{#if imageUrl}
				<img
					src={imageUrl}
					alt={label}
					draggable="false"
					class="max-h-56 w-full object-contain drop-shadow-[0_24px_32px_rgba(0,0,0,0.88)]"
					style="transform: scale({displayZoom}) rotateX({-displayPitchDeg}deg) rotateY({displayYawDeg}deg);"
				/>
			{/if}
		</div>
	{/if}

	<!-- Loading Shimmer Pill -->
	{#if loadingTexture}
		<div
			class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 backdrop-blur-[2px]"
		>
			<span
				class="rounded-full border border-white/15 bg-[#090d16]/90 px-3.5 py-1.5 font-mono text-[11px] font-semibold text-neu-cyan shadow-lg"
			>
				Loading High-Res 360° Render…
			</span>
		</div>
	{/if}

	<!-- Top-Left Live 360° Telemetry HUD -->
	<div class="pointer-events-none absolute top-3 left-3 z-20 flex flex-wrap items-center gap-2">
		<span
			class="inline-flex items-center gap-1.5 rounded-xl border bg-[#070a12]/85 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-white uppercase backdrop-blur-md"
			style="border-color: {spec.borderBaseRgba};"
		>
			<Rotate3d class="h-3.5 w-3.5" style="color: {spec.primaryHex}" />
			<span>360° Studio</span>
		</span>

		<span
			class="hidden rounded-xl border border-white/10 bg-[#070a12]/75 px-2.5 py-1 font-mono text-[10px] text-slate-300 tabular-nums backdrop-blur-md sm:inline-block"
		>
			YAW {String(displayYawDeg).padStart(3, '0')}° · PITCH {displayPitchDeg >= 0
				? `+${displayPitchDeg}`
				: displayPitchDeg}° · {displayZoom.toFixed(1)}×
		</span>
	</div>

	<!-- Top-Right Drag Hint -->
	<div
		class="pointer-events-none absolute top-3 right-3 z-20 hidden rounded-xl border border-white/10 bg-[#070a12]/75 px-2.5 py-1 font-mono text-[10px] text-slate-400 backdrop-blur-md md:block"
	>
		Drag to rotate 360° · Scroll to zoom
	</div>

	<!-- Bottom Floating Tactile Camera & Turntable Controls -->
	<div
		class="pointer-events-none absolute right-3 bottom-3 left-3 z-20 flex flex-wrap items-center justify-between gap-2"
	>
		<div class="pointer-events-auto flex items-center gap-1.5">
			<button
				type="button"
				onclick={toggleAutoSpin}
				data-active={autoSpin}
				class="neu-btn flex cursor-pointer items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-mono text-[10px] font-bold"
				title={autoSpin ? 'Pause 360° turntable' : 'Start 360° turntable'}
			>
				{#if autoSpin}
					<Pause class="h-3 w-3 text-neu-cyan" />
					<span>Auto-Spin</span>
				{:else}
					<Play class="h-3 w-3 text-slate-300" />
					<span>Auto-Spin</span>
				{/if}
			</button>

			<button
				type="button"
				onclick={spinFull360}
				class="neu-btn flex cursor-pointer items-center gap-1 rounded-xl px-2.5 py-1.5 font-mono text-[10px] font-bold"
				title="Perform a full 360° showcase spin"
			>
				<Rotate3d class="h-3 w-3 text-amber-300" />
				<span>360° Spin</span>
			</button>

			<button
				type="button"
				onclick={flip180}
				class="neu-btn hidden cursor-pointer items-center gap-1 rounded-xl px-2.5 py-1.5 font-mono text-[10px] font-bold sm:flex"
				title="Flip weapon 180° to inspect reverse side"
			>
				<FlipHorizontal2 class="h-3 w-3 text-slate-300" />
				<span>Flip 180°</span>
			</button>
		</div>

		<div class="pointer-events-auto flex items-center gap-1">
			<button
				type="button"
				onclick={() => stepZoom(-0.22)}
				class="neu-btn cursor-pointer rounded-xl p-1.5 text-slate-300 hover:text-white"
				title="Zoom out"
				aria-label="Zoom out"
			>
				<ZoomOut class="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onclick={() => stepZoom(0.22)}
				class="neu-btn cursor-pointer rounded-xl p-1.5 text-slate-300 hover:text-white"
				title="Zoom in"
				aria-label="Zoom in"
			>
				<ZoomIn class="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onclick={resetCamera}
				class="neu-btn cursor-pointer rounded-xl p-1.5 text-slate-300 hover:text-white"
				title="Reset camera angle & zoom"
				aria-label="Reset camera"
			>
				<RotateCcw class="h-3.5 w-3.5" />
			</button>
		</div>
	</div>
</div>
