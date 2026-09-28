<script lang="ts">
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import type { SceneModel } from '../../core/scene';
  import { applyStyle, buildObjects, disposeObjects, type SceneObjects } from './meshes';

  /** A small, fixed three-quarter view of the whole insert: solid trays, game box outline on. */
  let { model, dark, items = true, onopen }: { model: SceneModel; dark: boolean; items?: boolean; onopen: () => void } = $props();

  const W = 176;
  const H = 132;
  let host: HTMLButtonElement;
  let failed = $state(false);
  let renderer: THREE.WebGLRenderer | undefined;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, W / H, 1, 20000);
  let objects: SceneObjects | undefined;

  onMount(() => {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      failed = true;
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a2, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.6, 1, 0.8);
    scene.add(sun);
    return () => {
      if (objects) disposeObjects(objects);
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  });

  function draw(m: SceneModel, isDark: boolean, showItems: boolean) {
    if (!renderer) return;
    if (objects) disposeObjects(objects);
    objects = buildObjects(m, isDark);
    for (const t of objects.trays) applyStyle(t, 'solid', showItems);
    scene.add(objects.root);
    const target = new THREE.Vector3(0, m.box.h / 2, 0);
    const radius = 0.5 * Math.hypot(m.box.w, m.box.d, m.box.h);
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.98;
    camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, THREE.MathUtils.degToRad(58), THREE.MathUtils.degToRad(35))));
    camera.lookAt(target);
    renderer.render(scene, camera);
  }

  // Redraw shortly after edits stop, not on every frame of a drag.
  $effect(() => {
    const m = model;
    const isDark = dark;
    const showItems = items;
    const id = setTimeout(() => draw(m, isDark, showItems), objects ? 150 : 0);
    return () => clearTimeout(id);
  });
</script>

<button class="thumb" bind:this={host} onclick={onopen} data-tip="Open the 3D view" aria-label="Open the 3D view">
  {#if failed}<span class="fallback">3D</span>{/if}
</button>

<style>
  .thumb {
    display: block;
    width: 176px;
    height: 132px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: color-mix(in srgb, var(--panel) 85%, transparent);
    overflow: hidden;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  }
  .thumb:hover {
    border-color: var(--accent);
  }
  .thumb :global(canvas) {
    display: block;
  }
  .fallback {
    color: var(--muted);
  }
</style>
