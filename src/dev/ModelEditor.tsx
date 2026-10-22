/**
 * ModelEditor — the in-canvas half of the dev model editor.
 *
 *   - <EditorPick> wraps the industry models: with the editor on, a click
 *     picks the clicked element and its source-tagged ancestors (the tags come
 *     from dev/modelEditorPlugin.ts) and selects one of them.
 *   - <EditorGizmo> outlines the selection and shows a move / rotate / scale
 *     gizmo. Dragging previews the change live; on release the delta (in the
 *     element's own coordinate frame) is written into the source file, and
 *     HMR reloads the model with the new numbers.
 *
 * The gizmo drives a PROXY object at the pivot, not the element itself, so a
 * component call (whose tag sits on an invisible wrapper group at the
 * parent's origin) can still be scaled / rotated around its own centre.
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import {
  EDITOR_AVAILABLE,
  chainObjects,
  clearSelection,
  editSelected,
  getDev,
  selectChain,
  setIndex,
  setMode,
  setStatus,
  undoEdit,
  useDev,
  type EditOp,
} from './modelEditorStore';

/** The group that holds every pickable model (set by <EditorPick>). */
let pickRoot: THREE.Object3D | null = null;
/** Time of the last gizmo drag end: a click right after it isn't a pick. */
let lastDrag = 0;

function isUnder(o: THREE.Object3D, root: THREE.Object3D | null): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** Tagged objects from `o` up to (not including) the pick root. */
function tagChain(o: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  for (let p: THREE.Object3D | null = o; p && p !== pickRoot; p = p.parent) if (p.userData.src) out.push(p);
  return out;
}

export function EditorPick({ children }: { children: ReactNode }) {
  const dev = useDev();
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    pickRoot = ref.current;
  });
  if (!EDITOR_AVAILABLE) return <>{children}</>;
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4 || performance.now() - lastDrag < 250) return;
    e.stopPropagation();
    const chain = tagChain(e.object);
    if (chain.length) void selectChain(chain);
  };
  return (
    <group ref={ref} onClick={dev.editorOn ? onClick : undefined}>
      {children}
    </group>
  );
}

interface Snap {
  pos0: THREE.Vector3;
  q0: THREE.Quaternion;
  s0: THREE.Vector3;
  proxyPos0: THREE.Vector3;
  proxyQ0: THREE.Quaternion;
  parentInv: THREE.Matrix4;
  parentQ: THREE.Quaternion;
  /** Pivot in the parent's frame. */
  cL: THREE.Vector3;
  wrap: boolean;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function EditorGizmo() {
  const dev = useDev();
  const proxy = useMemo(() => new THREE.Object3D(), []);
  const box = useMemo(() => new THREE.BoxHelper(new THREE.Object3D(), '#ffc83d'), []);
  const snap = useRef<Snap | null>(null);
  const lastPos = useRef(new THREE.Vector3());
  const seeking = useRef<{ src: string; since: number } | null>(null);
  const selecting = useRef(false);
  const dragging = useRef(false);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  const info = dev.chain[dev.index];
  const target: THREE.Object3D | undefined = dev.editorOn ? chainObjects[dev.index] : undefined;

  /** Put the proxy on the target's pivot and remember the starting state. */
  const setup = () => {
    snap.current = null;
    if (!target?.parent) return;
    target.updateWorldMatrix(true, true);
    const parent = target.parent;
    const wrap = !!target.userData.wrap;
    const parentQ = parent.getWorldQuaternion(new THREE.Quaternion());
    const pivot = wrap
      ? new THREE.Box3().setFromObject(target).getCenter(new THREE.Vector3())
      : target.getWorldPosition(new THREE.Vector3());
    proxy.position.copy(pivot);
    proxy.quaternion.copy(wrap ? parentQ : target.getWorldQuaternion(new THREE.Quaternion()));
    proxy.scale.set(1, 1, 1);
    proxy.updateMatrixWorld();
    snap.current = {
      pos0: target.position.clone(),
      q0: target.quaternion.clone(),
      s0: target.scale.clone(),
      proxyPos0: pivot.clone(),
      proxyQ0: proxy.quaternion.clone(),
      parentInv: parent.matrixWorld.clone().invert(),
      parentQ,
      cL: parent.worldToLocal(pivot.clone()),
      wrap,
    };
  };

  useEffect(setup, [target, dev.mode, info?.src]);

  const restore = () => {
    const s = snap.current;
    if (!target || !s) return;
    target.position.copy(s.pos0);
    target.quaternion.copy(s.q0);
    target.scale.copy(s.s0);
  };

  /** Live preview: carry the proxy's change over to the target. */
  const onChange = () => {
    const s = snap.current;
    if (!target || !s) return;
    if (dev.mode === 'translate') {
      const a = s.proxyPos0.clone().applyMatrix4(s.parentInv);
      const b = proxy.position.clone().applyMatrix4(s.parentInv);
      target.position.copy(s.pos0).add(b.sub(a));
    } else if (dev.mode === 'rotate') {
      const qW = proxy.quaternion.clone().multiply(s.proxyQ0.clone().invert());
      const qL = s.parentQ.clone().invert().multiply(qW).multiply(s.parentQ);
      target.quaternion.copy(qL).multiply(s.q0);
      if (s.wrap) target.position.copy(s.pos0).sub(s.cL).applyQuaternion(qL).add(s.cL);
    } else {
      const f = proxy.scale;
      target.scale.copy(s.s0).multiply(f);
      if (s.wrap) target.position.copy(s.pos0).sub(s.cL).multiply(f).add(s.cL);
    }
  };

  /** Drag finished: write the change into the source. */
  const onRelease = async () => {
    lastDrag = performance.now();
    try {
      await save();
    } finally {
      // Only now may the gizmo follow the element again (see useFrame).
      dragging.current = false;
    }
  };

  const save = async () => {
    const s = snap.current;
    if (!target || !s) return;
    let op: EditOp | null = null;
    if (dev.mode === 'translate') {
      // Whole steps only, so the source gets tidy numbers.
      const d = target.position.clone().sub(s.pos0).divideScalar(dev.step).round().multiplyScalar(dev.step);
      if (d.length() > 1e-6) op = { move: [d.x, d.y, d.z] };
    } else if (dev.mode === 'scale') {
      const f = proxy.scale;
      if (Math.abs(f.x - 1) + Math.abs(f.y - 1) + Math.abs(f.z - 1) > 1e-6) op = { scale: [f.x, f.y, f.z] };
    } else {
      const e1 = new THREE.Euler().setFromQuaternion(target.quaternion);
      const e0 = new THREE.Euler().setFromQuaternion(s.q0);
      const d: [number, number, number] = [wrapAngle(e1.x - e0.x), wrapAngle(e1.y - e0.y), wrapAngle(e1.z - e0.z)];
      if (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) > 1e-6) op = { rotate: d };
    }
    if (!op) return setup();
    const ok = await editSelected(op);
    // A wrapper's change now lives in the source (HMR re-renders the inside);
    // a failed save goes back to where it was.
    if (!ok || s.wrap) restore();
    setup();
  };

  // Keep the selection alive across HMR (the edited model re-mounts) and
  // follow the element to its new source position after an edit.
  useFrame(() => {
    const d = getDev();
    if (!d.editorOn) return;
    const cur = chainObjects[d.index];
    if (cur && isUnder(cur, pickRoot)) {
      cur.getWorldPosition(lastPos.current);
      box.setFromObject(cur);
      // The element moved without the gizmo (HMR applied a saved edit):
      // put the gizmo back on it.
      const s = snap.current;
      if (s && cur === target && !dragging.current) {
        const pivot = s.wrap ? new THREE.Box3().setFromObject(cur).getCenter(tmp) : cur.getWorldPosition(tmp);
        if (pivot.distanceTo(s.proxyPos0) > 1e-4) setup();
      }
    }
    const wanted = d.wanted?.src ?? (cur && !isUnder(cur, pickRoot) ? d.chain[d.index]?.src : null);
    if (!wanted) {
      seeking.current = null;
      return;
    }
    const now = performance.now();
    if (seeking.current?.src !== wanted) seeking.current = { src: wanted, since: now };
    if (now - seeking.current.since < 120) return; // let HMR land first
    let best: THREE.Object3D | null = null;
    let bestD = Infinity;
    const p = new THREE.Vector3();
    pickRoot?.traverse((o) => {
      if (o.userData.src !== wanted) return;
      const dist = o.getWorldPosition(p).distanceTo(d.wanted?.near ?? lastPos.current);
      if (dist < bestD) {
        bestD = dist;
        best = o;
      }
    });
    const found = best as THREE.Object3D | null;
    if (found) {
      seeking.current = null;
      if ((found !== cur || d.wanted) && !selecting.current) {
        selecting.current = true;
        void selectChain(tagChain(found), wanted).finally(() => (selecting.current = false));
      }
    } else if (now - seeking.current.since > 5000) {
      seeking.current = null;
      clearSelection();
      setStatus('A kijelölt elem eltűnt — kattints rá újra.');
    }
  });

  // Keys: 1 / 2 / 3 = move / rotate / scale, PageUp / PageDown = parent /
  // child element, Esc = deselect, Ctrl+Z = undo the last saved edit.
  useEffect(() => {
    if (!dev.editorOn) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const d = getDev();
      if (e.code === 'Digit1') setMode('translate');
      else if (e.code === 'Digit2') setMode('rotate');
      else if (e.code === 'Digit3') setMode('scale');
      else if (e.code === 'PageUp') setIndex(d.index + 1);
      else if (e.code === 'PageDown') setIndex(d.index - 1);
      else if (e.code === 'Escape') clearSelection();
      else if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) void undoEdit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dev.editorOn]);

  if (!dev.editorOn || !target || !info) return null;

  // Snap steps are in model units; the gizmo works in world units.
  const ws = target.parent ? target.parent.getWorldScale(new THREE.Vector3()).x : 1;
  const axes =
    dev.mode === 'translate'
      ? [!!info.canMove, !!info.canMove, !!info.canMove]
      : dev.mode === 'scale'
        ? (info.scaleAxes ?? [false, false, false])
        : (info.rotateAxes ?? [false, false, false]);

  return (
    <>
      <primitive object={box} />
      <primitive object={proxy} />
      {axes.some(Boolean) && (
        <TransformControls
          object={proxy}
          mode={dev.mode}
          space="local"
          showX={axes[0]}
          showY={axes[1]}
          showZ={axes[2]}
          size={0.8}
          translationSnap={dev.step * ws}
          rotationSnap={THREE.MathUtils.degToRad(15)}
          scaleSnap={0.05}
          onMouseDown={() => (dragging.current = true)}
          onObjectChange={onChange}
          onMouseUp={() => void onRelease()}
        />
      )}
    </>
  );
}

/** Nudge the selection by one step along an axis (panel buttons). */
export function nudge(axis: 0 | 1 | 2, sign: 1 | -1): void {
  const d = getDev();
  const v: [number, number, number] = [0, 0, 0];
  if (d.mode === 'translate') {
    v[axis] = d.step * sign;
    void editSelected({ move: v });
  } else if (d.mode === 'rotate') {
    v[axis] = THREE.MathUtils.degToRad(15) * sign;
    void editSelected({ rotate: v });
  } else {
    const f: [number, number, number] = [1, 1, 1];
    f[axis] = sign > 0 ? 1.05 : 1 / 1.05;
    void editSelected({ scale: f });
  }
}
