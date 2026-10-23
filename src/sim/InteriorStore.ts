/**
 * InteriorStore — the layouts of all industry interiors (see interior.ts) and
 * which one is open in the micro view. Observable, immutable snapshots (for
 * useSyncExternalStore), pure TypeScript. Money is handled by the caller.
 */

import type { CellType } from './terrain';
import { interiorKey, MACHINES, type Interior, type Machine, type MachineKind, type Rot } from './interior';

type Listener = () => void;

export interface InteriorSnapshot {
  /** The open interior (micro view), or null when the map is shown. */
  open: Interior | null;
}

export class InteriorStore {
  private interiors = new Map<string, Interior>();
  private openKey: string | null = null;
  private nextId = 1;
  private snap: InteriorSnapshot = { open: null };
  private readonly listeners = new Set<Listener>();

  getSnapshot(): InteriorSnapshot {
    return this.snap;
  }

  /** The interior of an industry (an empty one the first time). */
  get(anchor: readonly [number, number], type: CellType): Interior {
    const key = interiorKey(anchor);
    let it = this.interiors.get(key);
    if (!it || it.type !== type) {
      it = { anchor: [anchor[0], anchor[1]], type, machines: [] };
      this.interiors.set(key, it);
    }
    return it;
  }

  open(anchor: readonly [number, number], type: CellType): void {
    this.get(anchor, type);
    this.openKey = interiorKey(anchor);
    this.publish();
  }

  close(): void {
    if (this.openKey === null) return;
    this.openKey = null;
    this.publish();
  }

  /** Add a machine to the open interior (rules are checked by the caller). */
  place(kind: MachineKind, x: number, z: number, rot: Rot): Machine | null {
    const it = this.snap.open;
    if (!it) return null;
    const m: Machine = { id: this.nextId++, kind, x, z, rot };
    this.update({ ...it, machines: it.machines.concat(m) });
    return m;
  }

  /** Turn a placed conveyor (e.g. while drag-laying a belt line). */
  setRot(id: number, rot: Rot): void {
    const it = this.snap.open;
    if (!it) return;
    const m = it.machines.find((q) => q.id === id);
    if (!m || m.rot === rot) return;
    this.update({ ...it, machines: it.machines.map((q) => (q.id === id ? { ...q, rot } : q)) });
  }

  /** Remove a machine from the open interior; returns it (for the refund). */
  remove(id: number): Machine | null {
    const it = this.snap.open;
    const m = it?.machines.find((q) => q.id === id) ?? null;
    if (!it || !m) return null;
    this.update({ ...it, machines: it.machines.filter((q) => q.id !== id) });
    return m;
  }

  /** Half the price back when a machine is removed. */
  static refundOf(m: Machine): number {
    return Math.floor(MACHINES[m.kind].cost / 2);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private update(it: Interior): void {
    this.interiors.set(interiorKey(it.anchor), it);
    this.publish();
  }

  private publish(): void {
    this.snap = { open: this.openKey ? (this.interiors.get(this.openKey) ?? null) : null };
    for (const l of this.listeners) l();
  }
}
