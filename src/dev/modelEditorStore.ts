/**
 * modelEditorStore — state of the in-game dev tools (Dev tab): whether the
 * "Látvány" tuner is open, and the model editor's selection / gizmo mode.
 *
 * The model editor talks to the dev server (dev/modelEditorPlugin.ts): it
 * inspects the picked element's source and sends edits (move / scale /
 * rotate deltas in the element's own coordinate frame), which the server
 * writes straight into the model's .tsx file. Only works under `npm run dev`.
 */

import { useSyncExternalStore } from 'react';
import type * as THREE from 'three';

export type GizmoMode = 'translate' | 'rotate' | 'scale';
type V3 = [number, number, number];

/** What the dev server knows about one picked element. */
export interface ElemInfo {
  src: string;
  error?: string;
  tag?: string;
  host?: boolean;
  file?: string;
  line?: number;
  code?: string;
  /** Generated in a loop: an edit changes every copy. */
  repeated?: boolean;
  /** Component the element is written in, and how often that is used. */
  owner?: string | null;
  ownerUses?: number;
  canMove?: boolean;
  scaleAxes?: boolean[];
  rotateAxes?: boolean[];
}

export interface DevState {
  visualOpen: boolean;
  editorOn: boolean;
  mode: GizmoMode;
  /** Move step (model units = cells at 3×3 lot scale). */
  step: number;
  /** Picked element and its tagged ancestors, innermost first. */
  chain: ElemInfo[];
  index: number;
  status: string;
  busy: boolean;
  /** Bumped whenever the selection should be re-found in the scene. */
  wanted: { src: string; near: THREE.Vector3 | null } | null;
}

/** Whether the model editor can work at all (needs the Vite dev server). */
export const EDITOR_AVAILABLE = import.meta.env.DEV;

const STEPS = [0.005, 0.01, 0.05, 0.1];
export { STEPS as MOVE_STEPS };

let state: DevState = {
  visualOpen: false,
  editorOn: false,
  mode: 'translate',
  step: 0.01,
  chain: [],
  index: 0,
  status: '',
  busy: false,
  wanted: null,
};
const listeners = new Set<() => void>();

/** Scene objects of `state.chain` (same order); not reactive. */
export let chainObjects: THREE.Object3D[] = [];

function set(patch: Partial<DevState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useDev(): DevState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const getDev = () => state;

export function setVisualOpen(open: boolean): void {
  set({ visualOpen: open });
}

export function setEditorOn(on: boolean): void {
  set({ editorOn: on, chain: [], index: 0, status: '', wanted: null });
  chainObjects = [];
}

export function setMode(mode: GizmoMode): void {
  set({ mode });
}

export function setStep(step: number): void {
  set({ step });
}

export function setIndex(index: number): void {
  if (index < 0 || index >= state.chain.length) return;
  set({ index, status: '' });
}

export function clearSelection(): void {
  chainObjects = [];
  set({ chain: [], index: 0, wanted: null });
}

async function post<R>(url: string, body: unknown): Promise<R> {
  const res = await fetch(`/__model-editor${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as R;
}

/** The element picked by default: the innermost one that can be moved, is
 *  not inside a component used in several places (that would edit all of
 *  them) and is not the building's placement on the map (Industries.tsx —
 *  that moves every building of the kind); relaxed step by step if none. */
function defaultIndex(chain: ElemInfo[]): number {
  const placement = (c: ElemInfo) => !!c.file?.endsWith('/Industries.tsx');
  const rules: Array<(c: ElemInfo) => boolean> = [
    (c) => !!c.canMove && (c.ownerUses ?? 0) <= 1 && !placement(c),
    (c) => !!c.canMove && !placement(c),
    (c) => !!c.canMove,
  ];
  for (const ok of rules) {
    const i = chain.findIndex(ok);
    if (i >= 0) return i;
  }
  return 0;
}

/**
 * Select a picked object chain (innermost first). `keepSrc`: keep that
 * element selected if it is in the chain (re-selection after an edit).
 */
export async function selectChain(objs: THREE.Object3D[], keepSrc?: string): Promise<void> {
  if (!objs.length) return;
  const srcs = objs.map((o) => o.userData.src as string);
  try {
    const { items } = await post<{ items: ElemInfo[] }>('/inspect', { srcs });
    chainObjects = objs;
    const keep = keepSrc ? items.findIndex((it) => it.src === keepSrc) : -1;
    set({ chain: items, index: keep >= 0 ? keep : defaultIndex(items), wanted: null });
  } catch {
    set({ status: 'A dev szerver nem érhető el (npm run dev).' });
  }
}

/** Re-inspect the selected element (its source tag may have moved). */
async function refreshInfo(oldSrc: string, newSrc: string): Promise<void> {
  try {
    const { items } = await post<{ items: ElemInfo[] }>('/inspect', { srcs: [newSrc] });
    const i = state.chain.findIndex((c) => c.src === oldSrc);
    if (i < 0 || !items[0]) return;
    const chain = state.chain.slice();
    chain[i] = items[0];
    set({ chain });
  } catch {
    // The scene re-selection re-inspects anyway.
  }
}

/** Re-find the selected element in the scene (after HMR) by its source tag. */
export function want(src: string, near: THREE.Vector3 | null): void {
  set({ wanted: { src, near } });
}

export interface EditOp {
  move?: V3;
  scale?: V3;
  rotate?: V3;
}

/** Write an edit of the selected element into its source file. */
export async function editSelected(op: EditOp): Promise<boolean> {
  const cur = state.chain[state.index];
  if (!cur || state.busy) return false;
  set({ busy: true });
  try {
    const r = await post<{ ok: boolean; src?: string; error?: string }>('/edit', { src: cur.src, ...op });
    if (!r.ok) {
      set({ busy: false, status: r.error ?? 'Nem sikerült menteni' });
      return false;
    }
    set({ busy: false, status: `Mentve: ${cur.file}:${cur.line}` });
    const src = r.src ?? cur.src;
    want(src, null);
    // Show the new source right away (the scene catches up after HMR).
    void refreshInfo(cur.src, src);
    return true;
  } catch {
    set({ busy: false, status: 'A dev szerver nem érhető el (npm run dev).' });
    return false;
  }
}

export async function undoEdit(): Promise<void> {
  try {
    const r = await post<{ ok: boolean; error?: string }>('/undo', {});
    set({ status: r.ok ? 'Visszavonva' : (r.error ?? 'Nem sikerült') });
    const cur = state.chain[state.index];
    if (r.ok && cur) want(cur.src, null);
  } catch {
    set({ status: 'A dev szerver nem érhető el (npm run dev).' });
  }
}

export function setStatus(status: string): void {
  set({ status });
}
