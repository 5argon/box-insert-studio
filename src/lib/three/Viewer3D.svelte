<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
  import type { SceneModel } from '../../core/scene';
  import { applyStyle, buildObjects, disposeObjects, type Preset, type SceneObjects, type TrayStyle } from './meshes';

  let {
    model,
    styleOf,
    outer,
    ortho,
    dark,
    items = true,
  }: {
    model: SceneModel;
    /** Style for each tray key. */
    styleOf: (key: string, layerId: string) => TrayStyle;
    outer: boolean;
    ortho: boolean;
    /** Dark theme: lighter lines. */
    dark: boolean;
    /** Show simulated items. */
    items?: boolean;
  } = $props();

  let host: HTMLDivElement;
  let failed = $state(false);

  let renderer: THREE.WebGLRenderer | undefined;
  const scene = new THREE.Scene();
  const persp = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -20000, 20000);
  let controls: OrbitControls | undefined;
  let objects: SceneObjects | undefined;
  let size = { w: 1, h: 1 };
  const target = new THREE.Vector3();
  let framed = false;

  const camera = () => (ortho ? orthoCam : persp);

  /** Radius of a sphere holding the whole box, for framing and zoom limits. */
  const radius = $derived(0.5 * Math.hypot(model.box.w, model.box.d, model.box.h));

  // Redraw only while something moves: interaction, damping, or a scene change.
  let running = false;
  let interacting = false;
  function tick() {
    const moved = controls?.update() ?? false;
    render();
    if (moved || interacting) requestAnimationFrame(tick);
    else running = false;
  }
  function kick() {
    if (running) return;
    running = true;
    requestAnimationFrame(tick);
  }

  function render() {
    if (renderer) renderer.render(scene, camera());
  }

  function fitOrtho() {
    const aspect = size.w / size.h;
    const half = radius * 1.15;
    orthoCam.left = -half * aspect;
    orthoCam.right = half * aspect;
    orthoCam.top = half;
    orthoCam.bottom = -half;
    orthoCam.updateProjectionMatrix();
  }

  /** Put the camera at an azimuth and tilt (degrees; tilt 0 = looking straight down) around the box centre. */
  export function preset(name: Preset) {
    const angles: Record<Preset, [number, number]> = { iso: [35, 58], top: [0, 0], front: [0, 90], side: [90, 90] };
    const [az, tilt] = angles[name];
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(persp.fov / 2)) * 1.08;
    const offset = new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, THREE.MathUtils.degToRad(Math.max(tilt, 0.01)), THREE.MathUtils.degToRad(az)));
    for (const cam of [persp, orthoCam]) {
      cam.position.copy(target).add(offset);
      cam.lookAt(target);
    }
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();
    controls?.update();
    kick();
  }

  onMount(() => {
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      failed = true;
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b0a2, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(0.6, 1, 0.8);
    scene.add(sun);

    controls = new OrbitControls(camera(), renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    // From straight down to level with the box: never underneath it.
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI / 2;
    controls.addEventListener('start', () => {
      interacting = true;
      kick();
    });
    controls.addEventListener('end', () => {
      interacting = false;
      kick();
    });
    controls.addEventListener('change', kick);

    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
      renderer!.setSize(size.w, size.h, false);
      persp.aspect = size.w / size.h;
      persp.updateProjectionMatrix();
      fitOrtho();
      kick();
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      controls?.dispose();
      if (objects) disposeObjects(objects);
      renderer?.dispose();
      renderer?.domElement.remove();
    };
  });

  // Rebuild the geometry whenever the design changes.
  $effect(() => {
    const m = model;
    const isDark = dark;
    if (!renderer) return;
    if (objects) disposeObjects(objects);
    objects = buildObjects(m, isDark);
    scene.add(objects.root);
    target.set(0, m.box.h / 2, 0);
    if (controls) {
      controls.target.copy(target);
      controls.minDistance = radius * 0.6;
      controls.maxDistance = radius * 8;
      controls.minZoom = 0.3;
      controls.maxZoom = 6;
    }
    fitOrtho();
    untrack(applyAll);
    if (!framed) {
      framed = true;
      untrack(() => preset('iso'));
    }
    controls?.update();
    kick();
  });

  function applyAll() {
    if (!objects) return;
    objects.outer.visible = outer;
    for (const t of objects.trays) applyStyle(t, styleOf(t.key, t.layerId), items);
  }

  // Restyle without rebuilding when view settings change.
  $effect(() => {
    void [outer, styleOf, items];
    applyAll();
    kick();
  });

  // Switch between perspective and orthographic, keeping the view.
  $effect(() => {
    const cam = camera();
    if (!controls) return;
    const other = cam === persp ? orthoCam : persp;
    cam.position.copy(other.position);
    cam.quaternion.copy(other.quaternion);
    controls.object = cam;
    controls.update();
    kick();
  });
</script>

<div class="viewer" bind:this={host}>
  {#if failed}
    <p class="fallback">This browser could not start WebGL, which the 3D view needs.</p>
  {/if}
</div>

<style>
  .viewer {
    position: absolute;
    inset: 0;
    touch-action: none;
  }
  .viewer :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
    cursor: grab;
  }
  .viewer :global(canvas:active) {
    cursor: grabbing;
  }
  .fallback {
    margin: 40px;
    color: var(--muted);
  }
</style>
