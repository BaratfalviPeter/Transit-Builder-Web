/**
 * StaticBatch — draw-call reduction for the detailed building models.
 *
 * A model is hundreds of small meshes (boxes, rails, pipes…); each one is a
 * draw call. StaticBatch watches its subtree for a moment, then MERGES the
 * meshes into one mesh per material (+ shadow flag) — hierarchically: each
 * mesh goes into the HIGHEST ancestor it doesn't move relative to. Static
 * parts merge at the model root; the 60 parts of a swinging crane merge into
 * the crane's moving group (and so keep moving, and blinking, with it).
 *
 * The originals are kept (animations keep running on them) but moved to an
 * unrendered layer. They're re-checked twice a second: a part that starts to
 * move relative to its batch later (a crane that was just idle), toggles its
 * visibility, or is removed (hot reload) is taken back out and the batch is
 * rebuilt. Animated materials still work — the merged meshes share them.
 *
 * `enabled = false` (the dev model editor) restores the original meshes, so
 * every part stays pickable.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Unrendered layer the merged-away originals live on. */
const HIDDEN_LAYER = 31;
/** Seconds of watching before the first merge. */
const SETTLE = 1.2;
/** Seconds between re-checks of the merged originals. */
const CHECK = 0.5;

interface Member {
  mesh: THREE.Mesh;
  /** The node its batch hangs under. */
  host: THREE.Object3D;
  /** Mesh transform relative to `host` when merged. */
  matrix: THREE.Matrix4;
  /** Shown (incl. the nodes up to the host) when merged. */
  visible: boolean;
  mask: number;
}

interface State {
  t: number;
  sinceCheck: number;
  /** Local matrices of all nodes at the start, to spot movers. */
  seen: Map<THREE.Object3D, THREE.Matrix4>;
  members: Member[];
  merged: THREE.Mesh[];
  /** Nodes known to move (relative to their parent) or blink. */
  moving: WeakSet<THREE.Object3D>;
  built: boolean;
}

const tmpInv = new THREE.Matrix4();
const tmpRel = new THREE.Matrix4();

/** Same transform (within float noise)? */
function same(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  const x = a.elements, y = b.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(x[i] - y[i]) > 1e-5) return false;
  return true;
}

/** Transform of `o` relative to `host`. */
function relMatrix(o: THREE.Object3D, host: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  tmpInv.copy(host.matrixWorld).invert();
  return out.multiplyMatrices(tmpInv, o.matrixWorld);
}

/** Is `o` and every node up to (not incl.) `host` visible? */
function shownUpTo(o: THREE.Object3D, host: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p && p !== host; p = p.parent) if (!p.visible) return false;
  return true;
}

/**
 * Geometry ready to merge: non-indexed, position/normal/uv (+ vertex colour
 * for a vertexColors material — all of a batch share it) only, transformed.
 */
function prepared(mesh: THREE.Mesh, m: THREE.Matrix4): THREE.BufferGeometry | null {
  const src = mesh.geometry;
  if (!src.getAttribute('position')) return null;
  const g = src.index ? src.toNonIndexed() : src.clone();
  const keepColor = (mesh.material as THREE.Material).vertexColors && !!g.getAttribute('color');
  for (const name of Object.keys(g.attributes))
    if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(keepColor && name === 'color')) g.deleteAttribute(name);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  g.morphAttributes = {};
  g.clearGroups();
  g.applyMatrix4(m);
  return g;
}

export function StaticBatch({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const root = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  const st = useRef<State>({ t: 0, sinceCheck: 0, seen: new Map(), members: [], merged: [], moving: new WeakSet(), built: false });

  const unmerge = () => {
    const s = st.current;
    for (const m of s.merged) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    for (const mb of s.members) mb.mesh.layers.mask = mb.mask;
    s.merged = [];
    s.members = [];
    s.built = false;
    // Shadows are baked once (see ShadowController): re-bake with the parts back.
    gl.shadowMap.needsUpdate = true;
  };

  /** Nodes whose local matrix differs from when we first saw them. */
  const markMovers = () => {
    const s = st.current;
    for (const [node, m] of s.seen) if (!same(node.matrix, m)) s.moving.add(node);
  };

  /** Highest ancestor (≤ root) the mesh doesn't move relative to, or null. */
  const hostOf = (mesh: THREE.Mesh, r: THREE.Object3D): THREE.Object3D | null => {
    const s = st.current;
    if (s.moving.has(mesh)) return null;
    let cur = mesh.parent;
    while (cur && cur !== r && !s.moving.has(cur)) cur = cur.parent;
    return cur;
  };

  const build = () => {
    const r = root.current;
    const s = st.current;
    if (!r) return;
    r.updateMatrixWorld(true);
    markMovers();
    const groups = new Map<string, { host: THREE.Object3D; mat: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[] }>();
    const members: Member[] = [];
    r.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.userData.batched) return;
      if (Array.isArray(mesh.material)) return;
      const host = hostOf(mesh, r);
      if (!host) return;
      const visible = shownUpTo(mesh, host);
      if (!visible) return; // hidden right now: leave it to its own toggling
      const m = relMatrix(mesh, host, new THREE.Matrix4());
      const g = prepared(mesh, m);
      if (!g) return;
      const mat = mesh.material as THREE.Material;
      const key = `${host.uuid}|${mat.uuid}|${mesh.castShadow ? 1 : 0}`;
      let grp = groups.get(key);
      if (!grp) groups.set(key, (grp = { host, mat, cast: mesh.castShadow, recv: false, geos: [] }));
      grp.recv ||= mesh.receiveShadow;
      grp.geos.push(g);
      members.push({ mesh, host, matrix: m, visible, mask: mesh.layers.mask });
    });
    const merged: THREE.Mesh[] = [];
    for (const grp of groups.values()) {
      const geo = mergeGeometries(grp.geos, false);
      grp.geos.forEach((g) => g.dispose());
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, grp.mat);
      mesh.castShadow = grp.cast;
      mesh.receiveShadow = grp.recv;
      mesh.userData.batched = true;
      mesh.matrixAutoUpdate = false;
      grp.host.add(mesh);
      mesh.updateMatrixWorld(true);
      merged.push(mesh);
    }
    for (const mb of members) mb.mesh.layers.set(HIDDEN_LAYER);
    s.members = members;
    s.merged = merged;
    s.built = true;
    gl.shadowMap.needsUpdate = true; // the merged meshes cast the shadows now
  };

  useFrame((_, dt) => {
    const r = root.current;
    const s = st.current;
    if (!r) return;
    if (!enabled) {
      if (s.built) unmerge();
      s.t = 0;
      s.seen.clear();
      return;
    }
    s.t += dt;
    if (!s.built) {
      // Note every node's local transform, then merge after a while.
      if (s.seen.size === 0) r.traverse((o) => o !== r && !o.userData.batched && s.seen.set(o, o.matrix.clone()));
      if (s.t >= SETTLE) build();
      return;
    }
    s.sinceCheck += dt;
    if (s.sinceCheck < CHECK) return;
    s.sinceCheck = 0;
    // A merged part moved relative to its batch, blinked or vanished: mark
    // the nodes in between as moving, take it out and rebuild.
    let stale = false;
    for (const mb of s.members) {
      const gone = !isUnder(mb.mesh, mb.host) || !isUnder(mb.host, r);
      if (gone) {
        stale = true;
        continue;
      }
      if (shownUpTo(mb.mesh, mb.host) !== mb.visible || !same(relMatrix(mb.mesh, mb.host, tmpRel), mb.matrix)) {
        for (let p: THREE.Object3D | null = mb.mesh; p && p !== mb.host; p = p.parent) s.moving.add(p);
        stale = true;
      }
    }
    if (stale) {
      unmerge();
      s.seen.clear();
      r.traverse((o) => o !== r && !o.userData.batched && s.seen.set(o, o.matrix.clone()));
      build();
    }
  });

  useEffect(() => () => unmerge(), []);

  return <group ref={root}>{children}</group>;
}

function isUnder(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}
