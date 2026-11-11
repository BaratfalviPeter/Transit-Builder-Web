/**
 * TerrainStore — a mutable, observable wrapper around a generated TerrainMap.
 *
 * Pure TypeScript (no React/Three). It owns the authoritative grid and exposes
 * imperative mutations (currently: build a road). A cached, immutable snapshot
 * is published on every change so React consumers get a stable reference
 * between mutations (safe for useSyncExternalStore).
 *
 * Grid indexing matches `generateTerrain`: cells[x][z], x,z in [0, size).
 */

import type { RoadKind } from './roads';
import { DEPOT_SIZE, depotCells, depotProblem, depotTracks, type DepotRot } from './depot';
import { MAX_REFINERY_UNITS, OIL_START_BAYS, OIL_START_TRACKS, isOilLot, oilCells, oilDepotProblem, oilGrown, oilStub, oilTrackColumn, oilTracks, oilUpgradeProblem } from './oilDepot';
import { pipeCellOk } from './pipes';
import { cellIndex, controlProblem, type ControlKind } from './traffic';
import { nextSignalMode, signalIndexNear, signalSpot } from './signals';
import {
  CellType,
  MAX_GEN_LEVEL,
  canBuildRoadAt,
  canBulldoze,
  canClearProps,
  cellKey,
  generateTerrain,
  HILL_STEP,
  SPECIAL_BUILDINGS,
  type GenerateOptions,
  type TerrainMap,
} from './terrain';
import { addEdge, cutAtCell, EMPTY_NET, hasRailAt, railIndex, roadCrossingAxis, splitAtPoint, type RailNet } from './railNet';
import type { RailPlan } from './railRoute';
import { axisOf, interiorAt, interiorOf, isUnderpass, TUNNEL_COVER, levelAt, structureAt, structureProblem, structureStep, trenchAt, type Structure, type StructureKind } from './structures';
import { stationAt, stationGeom, stationProblem, stopKind, type Side, type Station, type StopKind, type StopRole } from './stations';

type Listener = () => void;

/** Lowest a cell may be dug (in cellSize units) — one step below ground. */
const MIN_HEIGHT = -HILL_STEP;
/** Highest a cell may be raised (one step above the tallest generated peak). */
const MAX_HEIGHT = (MAX_GEN_LEVEL + 1) * HILL_STEP;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class TerrainStore {
  private map: TerrainMap;
  private readonly listeners = new Set<Listener>();
  private roadCount = 0;
  private industryCount = 0;

  constructor(options: GenerateOptions = {}) {
    this.map = generateTerrain(options);
    // Count the special buildings placed by the auto-spawn pass at gen time.
    this.industryCount = this.countSpecialBuildings();
  }

  /** Current immutable map snapshot (stable until the next mutation). */
  getMap(): TerrainMap {
    return this.map;
  }

  /** Number of Road cells currently on the map. */
  getRoadCount(): number {
    return this.roadCount;
  }

  /**
   * Number of auto-generated special buildings (lumber mills, mines, power
   * plants, factories).
   */
  getIndustryCount(): number {
    return this.industryCount;
  }

  /** True if `(x, z)` is in bounds. */
  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.map.size && z < this.map.size;
  }

  /** The cell type at `(x, z)`, or null if out of bounds. */
  cellAt(x: number, z: number): CellType | null {
    if (!this.inBounds(x, z)) return null;
    return this.map.cells[x][z];
  }

  /**
   * Build a road on `(x, z)` if the rules allow it: Empty ground, or a Hill
   * cell whose slope is flat or a single straight ramp (OpenTTD-style — corner
   * and peak cells are rejected). Returns true if a road was placed; the cell's
   * height is preserved so a road on a hill keeps the hill's elevation.
   */
  buildRoad(x: number, z: number): boolean {
    if (!canBuildRoadAt(this.map, x, z)) return false;

    this.applyCell(x, z, CellType.Road);
    this.roadCount += 1;
    this.emit();
    return true;
  }

  /**
   * Build a whole planned ROAD route in ONE commit + ONE emit, so the overlays
   * rebuild once instead of once per cell. Existing road cells are skipped
   * (joined, not rebuilt). A straight rail on the way becomes a level crossing
   * (the cell turns Road, its rail piece stays). Each new cell is checked
   * against the build rules as the route grows. Returns the cells placed.
   */
  buildPath(path: ReadonlyArray<{ x: number; z: number }>, kind: RoadKind = 'main'): number {
    let cells: CellType[][] | null = null;
    const dirt = new Set(this.map.dirt ?? []);
    const dirtBefore = dirt.size;
    const touched = new Set<number>();
    let placed = 0;
    // Bridges / tunnels the route runs along: their span isn't road cells —
    // the road is laid ON them (once the route reaches both abutments).
    const spans = new Set<Structure>();
    const onSpan = new Set<number>();
    for (let i = 1; i < path.length; i++) {
      const s = structureStep(this.map, path[i - 1], path[i], 'road');
      if (!s) continue;
      spans.add(s);
      for (const p of [path[i - 1], path[i]]) if (interiorAt(this.map, p.x, p.z) === s) onSpan.add(p.x * this.map.size + p.z);
    }
    for (const { x, z } of path) {
      if (!this.inBounds(x, z)) continue;
      if (onSpan.has(x * this.map.size + z)) continue;
      const cur = (cells ?? this.map.cells)[x][z];
      const k = x * this.map.size + z;
      if (cur === CellType.Road) {
        if (kind === 'main') dirt.delete(k); // upgraded (paid by the caller)
        continue;
      }
      // Rules see the cells placed so far (slope-connectivity checks).
      const view = cells ? { ...this.map, cells } : this.map;
      const ok = cur === CellType.Rail ? roadCrossingAxis(view, x, z) !== null : canBuildRoadAt(view, x, z);
      if (!ok) continue;
      if (!cells) cells = this.map.cells.slice();
      if (!touched.has(x)) {
        cells[x] = cells[x].slice();
        touched.add(x);
      }
      cells[x][z] = CellType.Road;
      if (kind === 'dirt') dirt.add(k);
      else dirt.delete(k);
      placed++;
    }
    const dirtChanged = dirt.size !== dirtBefore;
    if ((cells && placed > 0) || dirtChanged) {
      if (cells) this.roadCount += placed;
      this.commit({ ...(cells && placed > 0 ? { cells } : {}), ...(dirtChanged ? { dirt } : {}) }, true);
      this.emit();
    }
    // The spans the route crossed end to end: the road goes on them.
    for (const s of spans) {
      const has = (c: readonly [number, number]) => path.some((p) => p.x === c[0] && p.z === c[1]);
      if (!s.carries && has(s.a) && has(s.b) && this.layOnStructure(s.id, 'road')) placed += interiorOf(s).length;
    }
    // An empty bridge / tunnel with a road built up to BOTH its ends (e.g. one
    // side at a time): the road goes on it too.
    for (const s of this.map.structures ?? []) {
      if (s.carries) continue;
      const touched = path.some((p) => (p.x === s.a[0] && p.z === s.a[1]) || (p.x === s.b[0] && p.z === s.b[1]));
      const road = (c: readonly [number, number]) => this.map.cells[c[0]][c[1]] === CellType.Road;
      if (touched && road(s.a) && road(s.b)) this.layOnStructure(s.id, 'road');
    }
    return placed;
  }

  /**
   * Lay a planned rail line (see railRoute.ts) in one commit: split the
   * existing tracks where the line branches off / merges in (→ switches), add
   * the new centre-line, and turn its footprint cells into Rail (Road cells
   * stay Road = level crossing). Returns the length built (cells).
   */
  buildRail(plan: RailPlan): number {
    if (plan.blocked || plan.pts.length < 4) return 0;
    let net = this.map.railNet ?? EMPTY_NET;
    const p = plan.pts;
    if (plan.start?.kind === 'mid') net = splitAtPoint(net, p[0], p[1]);
    if (plan.end?.kind === 'mid') net = splitAtPoint(net, p[p.length - 2], p[p.length - 1]);
    // Cut out the jumps over bridges / through tunnels (abutment → abutment):
    // those pieces go on the structures, the rest are ordinary edges.
    const spans: Structure[] = [];
    let piece: number[] = [p[0], p[1]];
    for (let i = 2; i < p.length; i += 2) {
      const ra = structureAt(this.map, Math.round(p[i - 2]), Math.round(p[i - 1]));
      const rb = structureAt(this.map, Math.round(p[i]), Math.round(p[i + 1]));
      const jump = ra && rb && ra.s === rb.s && ra.role === 'abutment' && rb.role === 'abutment' && Math.abs(p[i] - p[i - 2]) + Math.abs(p[i + 1] - p[i - 1]) > 1.5;
      if (jump) {
        if (piece.length >= 4) net = addEdge(net, piece);
        if (!ra.s.carries) spans.push(ra.s);
        piece = [p[i], p[i + 1]];
      } else piece.push(p[i], p[i + 1]);
    }
    if (piece.length >= 4) net = addEdge(net, piece);
    this.setRailNet(net, null);
    for (const s of spans) this.layOnStructure(s.id, 'rail');
    // An empty bridge / tunnel whose BOTH ends now have track ending there,
    // heading along it (built one side at a time): the rail goes on it too.
    const endsAt = (c: readonly [number, number], dir: [number, number]) =>
      (this.map.railNet?.edges ?? []).some((e) => {
        const q = e.pts, L = q.length;
        for (const [x, z, px, pz] of [[q[0], q[1], q[2], q[3]], [q[L - 2], q[L - 1], q[L - 4], q[L - 3]]]) {
          if (Math.abs(x - c[0]) > 1e-3 || Math.abs(z - c[1]) > 1e-3) continue;
          const l = Math.hypot(x - px, z - pz) || 1;
          if (((x - px) * dir[0] + (z - pz) * dir[1]) / l > 0.99) return true; // arrives heading into the span
        }
        return false;
      });
    for (const s of this.map.structures ?? []) {
      if (s.carries) continue;
      const [dx, dz] = axisOf(s);
      if (endsAt(s.a, [dx, dz]) && endsAt(s.b, [-dx, -dz])) this.layOnStructure(s.id, 'rail');
    }
    return Math.ceil(plan.length);
  }

  /**
   * Swap in a new rail network and re-type the cells: footprint Empty/Hill →
   * Rail; former Rail cells no longer covered → back to Hill/Empty (and marked
   * `cleared`, so no tree pops back onto the old trackbed).
   */
  private setRailNet(net: RailNet, extraCleared: number | null): void {
    const view: TerrainMap = { ...this.map, railNet: net };
    const idx = railIndex(view);
    const n = this.map.size;
    let cells: CellType[][] | null = null;
    let cleared: Set<number> | null = null;
    const set = (x: number, z: number, t: CellType) => {
      if (!cells) cells = this.map.cells.slice();
      if (cells[x] === this.map.cells[x]) cells[x] = cells[x].slice();
      cells[x][z] = t;
    };
    for (let x = 0; x < n; x++) {
      for (let z = 0; z < n; z++) {
        const t = this.map.cells[x][z];
        const has = idx.has(x * n + z);
        if (has && (t === CellType.Empty || t === CellType.Hill)) set(x, z, CellType.Rail);
        else if (!has && t === CellType.Rail) {
          set(x, z, this.map.heights[x][z] > 0 ? CellType.Hill : CellType.Empty);
          if (!cleared) cleared = new Set(this.map.cleared ?? []);
          cleared.add(cellKey(n, x, z));
        }
      }
    }
    if (extraCleared !== null) {
      if (!cleared) cleared = new Set(this.map.cleared ?? []);
      cleared.add(extraCleared);
    }
    const partial: { cells?: CellType[][]; cleared?: ReadonlySet<number>; railNet: RailNet } = { railNet: net };
    if (cells) partial.cells = cells;
    if (cleared) partial.cleared = cleared;
    this.commit(partial, true);
    this.emit();
  }

  /** Set a stop's role / output share (see stations.ts `StopRole`). */
  setStopRole(id: number, patch: { role?: StopRole; share?: number }): void {
    const list = this.map.stations ?? [];
    if (!list.some((s) => s.id === id)) return;
    this.commit({ stations: list.map((s) => (s.id === id ? { ...s, ...patch } : s)) }, false);
    this.emit();
  }

  /**
   * Build a stop on `side` of the industry at `anchor` (see stations.ts):
   * platform cells become Station; a rail station adds its through-track to
   * the rail network, a truck stop lays its road row. One commit. Returns
   * false if the rules forbid it.
   */
  buildStation(anchor: readonly [number, number], side: Side, kind: StopKind = 'rail', ext = 0): boolean {
    if (kind !== 'rail') ext = 0;
    if (stationProblem(this.map, anchor, side, ext)) return false;
    const g = stationGeom(anchor, side, ext);
    const cells = this.map.cells.slice();
    const set = (x: number, z: number, t: CellType) => {
      if (cells[x] === this.map.cells[x]) cells[x] = cells[x].slice();
      cells[x][z] = t;
    };
    for (const [x, z] of g.platform) set(x, z, CellType.Station);
    if (kind === 'truck') for (const [x, z] of g.track) set(x, z, CellType.Road);
    const stations = this.map.stations ?? [];
    const id = stations.reduce((m, st) => Math.max(m, st.id), 0) + 1;
    this.commit({ cells, stations: stations.concat({ id, anchor: [anchor[0], anchor[1]], side, kind, ...(ext ? { ext } : {}) }) }, true);
    if (kind === 'truck') {
      this.roadCount += g.track.length;
      this.emit();
    } else {
      // The track: a plain rail edge (its footprint cells turn Rail here).
      this.setRailNet(addEdge(this.map.railNet ?? EMPTY_NET, g.trackPts.slice()), null);
    }
    return true;
  }

  /**
   * Place a traffic control (see traffic.ts) — or remove one (`kind` null).
   * Doesn't touch cells or heights (no geometry rebuild). Returns false if
   * the rules forbid it / nothing to remove.
   */
  setControl(x: number, z: number, kind: ControlKind | null): boolean {
    if (!this.inBounds(x, z)) return false;
    const key = cellIndex(this.map, x, z);
    const controls = new Map(this.map.controls ?? []);
    if (kind === null) {
      if (!controls.delete(key)) return false;
    } else {
      if (controlProblem(this.map, x, z, kind)) return false;
      controls.set(key, kind);
    }
    this.map = { ...this.map, controls };
    this.emit();
    return true;
  }

  /**
   * Put a rail signal on the track near grid point (x, z) (see signals.ts):
   * the track's edge is split there; it faces the trains that have the
   * cursor's side on their right. Clicking an existing signal turns it round. Returns 'new' / 'mode' or null if not allowed.
   */
  placeSignal(x: number, z: number): 'new' | 'mode' | null {
    const spot = signalSpot(this.map, x, z);
    if (!spot) return null;
    const all = this.map.signals ?? [];
    if (spot.existing >= 0) {
      const sig = all[spot.existing];
      const next = all.slice();
      next[spot.existing] = { ...sig, mode: nextSignalMode(sig.mode) };
      this.map = { ...this.map, signals: next };
      this.emit();
      return 'mode';
    }
    if (spot.problem) return null;
    const net = splitAtPoint(this.map.railNet ?? EMPTY_NET, spot.x, spot.z);
    if (net !== this.map.railNet) this.setRailNet(net, null);
    this.map = { ...this.map, signals: all.concat({ x: spot.x, z: spot.z, tx: spot.tx, tz: spot.tz, mode: spot.mode }) };
    this.emit();
    return 'new';
  }

  /** Remove the signal near (x, z) (the track stays). */
  removeSignal(x: number, z: number): boolean {
    const i = signalIndexNear(this.map, x, z, 0.75);
    if (i < 0) return false;
    this.map = { ...this.map, signals: (this.map.signals ?? []).filter((_, k) => k !== i) };
    this.emit();
    return true;
  }

  /**
   * Build a freight depot (see depot.ts) with its lot's min corner at
   * (x0, z0), turned `rot`: tracks → rail-network edges, the hall and bays →
   * Station cells, the drive → Road. Returns false if the rules forbid it.
   */
  buildDepot(x0: number, z0: number, rot: DepotRot): boolean {
    if (depotProblem(this.map, x0, z0, rot)) return false;
    const stations = this.map.stations ?? [];
    const id = stations.reduce((m, st) => Math.max(m, st.id), 0) + 1;
    const st: Station = { id, anchor: [x0, z0], side: 'S', kind: 'depot', rot };
    const cells = this.map.cells.slice();
    let roads = 0;
    for (const { x, z, lz } of depotCells(st)) {
      if (lz < 2) continue; // track rows: the rail edges below set them
      if (cells[x] === this.map.cells[x]) cells[x] = cells[x].slice();
      const road = lz === DEPOT_SIZE - 1;
      if (road && cells[x][z] !== CellType.Road) roads++;
      cells[x][z] = road ? CellType.Road : CellType.Station;
    }
    this.commit({ cells, stations: stations.concat(st) }, true);
    this.roadCount += roads;
    let net = this.map.railNet ?? EMPTY_NET;
    for (const pts of depotTracks(st)) net = addEdge(net, pts);
    this.setRailNet(net, null);
    return true;
  }

  /**
   * Build an oil depot (see oilDepot.ts) with its lot's min corner at (x0, z0),
   * turned `rot`: Station cells, the access road cell → Road, the loading track →
   * a rail-network edge (its cells Rail). False if not allowed.
   */
  buildOilDepot(x0: number, z0: number, rot: DepotRot, kind: 'oil' | 'refinery' = 'oil'): boolean {
    if (oilDepotProblem(this.map, x0, z0, rot)) return false;
    const stations = this.map.stations ?? [];
    const id = stations.reduce((m, st) => Math.max(m, st.id), 0) + 1;
    const st: Station = { id, anchor: [x0, z0], side: 'S', kind, rot, bays: OIL_START_BAYS, tracks: OIL_START_TRACKS, ...(kind === 'refinery' ? { units: 1 } : {}) };
    const [sx, sz] = oilStub(st);
    const cells = this.map.cells.slice();
    let roads = 0;
    for (const { x, z, lx } of oilCells(st)) {
      if (cells[x] === this.map.cells[x]) cells[x] = cells[x].slice();
      const road = x === sx && z === sz;
      if (road && cells[x][z] !== CellType.Road) roads++;
      // Track cells: bare ground, the rail edge below makes them Rail.
      cells[x][z] = road ? CellType.Road : oilTrackColumn(st, lx) ? CellType.Empty : CellType.Station;
    }
    this.commit({ cells, stations: stations.concat(st) }, true);
    this.roadCount += roads;
    let net = this.map.railNet ?? EMPTY_NET;
    for (const pts of oilTracks(st)) net = addEdge(net, pts);
    this.setRailNet(net, null);
    return true;
  }

  /**
   * Grow oil depot `id` to `bays` truck bays / `tracks` rail tracks (see
   * oilGrown): the new cells → Station (track cells → Rail), new tracks →
   * rail-network edges. Returns the grown depot, or null if not allowed.
   */
  upgradeOilDepot(id: number, bays: number, tracks: number): Station | null {
    const st = this.map.stations?.find((s) => s.id === id);
    if (!st || !isOilLot(st) || oilUpgradeProblem(this.map, st, bays, tracks)) return null;
    const next = oilGrown(st, bays, tracks);
    const n = this.map.size;
    const had = new Set(oilCells(st).map((c) => c.x * n + c.z));
    const cells = this.map.cells.slice();
    for (const { x, z, lx } of oilCells(next)) {
      if (had.has(x * n + z)) continue;
      if (cells[x] === this.map.cells[x]) cells[x] = cells[x].slice();
      cells[x][z] = oilTrackColumn(next, lx) ? CellType.Empty : CellType.Station;
    }
    this.commit({ cells, stations: (this.map.stations ?? []).map((s) => (s.id === id ? next : s)) }, true);
    let net = this.map.railNet ?? EMPTY_NET;
    for (const pts of oilTracks(next).slice(oilTracks(st).length)) net = addEdge(net, pts);
    this.setRailNet(net, null);
    return next;
  }

  /** One more distillation column at refinery `id` (same lot). False if at the most. */
  addRefineryUnit(id: number): boolean {
    const st = this.map.stations?.find((s) => s.id === id);
    if (!st || st.kind !== 'refinery' || (st.units ?? 1) >= MAX_REFINERY_UNITS) return false;
    this.commit({ stations: (this.map.stations ?? []).map((s) => (s.id === id ? { ...s, units: (st.units ?? 1) + 1 } : s)) }, false);
    this.emit();
    return true;
  }

  /**
   * Lay oil pipeline on `path` (cells; see pipes.ts). Cells that can't take a
   * pipe, or have one already, are skipped. Returns how many were laid.
   */
  layPipe(path: Array<[number, number]>): number {
    const have = new Set(this.map.pipes ?? []);
    const add: number[] = [];
    for (const [x, z] of path) {
      const k = x * this.map.size + z;
      if (have.has(k) || !pipeCellOk(this.map, x, z)) continue;
      have.add(k);
      add.push(k);
    }
    if (!add.length) return 0;
    this.map = { ...this.map, pipes: [...(this.map.pipes ?? []), ...add], version: this.map.version + 1 };
    this.emit();
    return add.length;
  }

  /** Remove the pipeline from one cell. */
  removePipe(x: number, z: number): boolean {
    const k = x * this.map.size + z;
    if (!this.map.pipes?.includes(k)) return false;
    this.map = { ...this.map, pipes: this.map.pipes.filter((c) => c !== k), version: this.map.version + 1 };
    this.emit();
    return true;
  }

  /** Remove a whole stop (platform + its track / road, or a depot's lot). */
  /**
   * Build an empty bridge / tunnel from abutment `a` to `b` (see
   * structures.ts). Returns false if the rules forbid it.
   */
  buildStructure(kind: StructureKind, a: [number, number], b: [number, number]): boolean {
    if (structureProblem(this.map, kind, a, b)) return false;
    const list = this.map.structures ?? [];
    const id = list.reduce((m, s) => Math.max(m, s.id), 0) + 1;
    const s: Structure = { id, kind, a, b, level: levelAt(this.map, a) };
    // A hill tunnel's tube must stay covered: where the hill over it is lower,
    // the ground is raised to TUNNEL_COVER steps above the portals (not at the
    // cells next to the portals — their corners are the portals' too).
    if (kind === 'tunnel' && !isUnderpass(this.map, s)) {
      const top = s.level + TUNNEL_COVER * HILL_STEP;
      const inner = interiorOf(s);
      const heights = this.map.heights.map((col) => col.slice());
      const cells = this.map.cells.map((col) => col.slice());
      let raised = false;
      for (let i = 1; i < inner.length - 1; i++) {
        const [x, z] = inner[i];
        const t = cells[x][z];
        if (t !== CellType.Empty && t !== CellType.Hill && t !== CellType.Forest) continue;
        if (heights[x][z] >= top - 1e-6) continue;
        heights[x][z] = top;
        if (t === CellType.Forest) cells[x][z] = CellType.Empty;
        raised = true;
      }
      if (raised) {
        this.commit({ structures: list.concat(s), heights, cells }, true);
        this.emit();
        return true;
      }
    }
    this.commit({ structures: list.concat(s) }, true);
    this.emit();
    return true;
  }

  /**
   * Lay a road or a rail on the empty structure `id`: its abutments join the
   * ground network (a road cell / the ends of one rail edge between them).
   * Returns false if it already carries something or an abutment can't take it.
   */
  layOnStructure(id: number, what: 'road' | 'rail'): boolean {
    const list = this.map.structures ?? [];
    const s = list.find((q) => q.id === id);
    if (!s || s.carries) return false;
    const ends = [s.a, s.b];
    const ok = what === 'road' ? [CellType.Empty, CellType.Hill, CellType.Road] : [CellType.Empty, CellType.Hill, CellType.Rail];
    if (ends.some(([x, z]) => !ok.includes(this.map.cells[x][z]))) return false;
    const structures = list.map((q) => (q === s ? { ...q, carries: what } : q));
    if (what === 'road') {
      const cells = this.map.cells.slice();
      for (const [x, z] of ends) {
        if (cells[x][z] === CellType.Road) continue;
        if (cells[x] === this.map.cells[x]) cells[x] = cells[x].slice();
        cells[x][z] = CellType.Road;
        this.roadCount++;
      }
      this.commit({ cells, structures }, true);
      this.emit();
    } else {
      this.commit({ structures }, true);
      this.setRailNet(addEdge(this.map.railNet ?? EMPTY_NET, [s.a[0], s.a[1], s.b[0], s.b[1]], s.id), null);
    }
    return true;
  }

  /** Remove structure `id` with what it carries (its abutment cells stay). */
  removeStructure(id: number): boolean {
    const list = this.map.structures ?? [];
    if (!list.some((q) => q.id === id)) return false;
    this.commit({ structures: list.filter((q) => q.id !== id) }, true);
    const net = this.map.railNet ?? EMPTY_NET;
    if (net.edges.some((e) => e.structure === id)) this.setRailNet({ edges: net.edges.filter((e) => e.structure !== id), nextId: net.nextId }, null);
    else this.emit();
    return true;
  }

  private removeStation(id: number): void {
    const st = this.map.stations?.find((s) => s.id === id);
    if (!st) return;
    if (isOilLot(st)) {
      const cells = this.map.cells.slice();
      let roads = 0;
      for (const { x, z, lx } of oilCells(st)) {
        if (oilTrackColumn(st, lx)) continue; // the track: cut below
        if (cells[x] === this.map.cells[x]) cells[x] = cells[x].slice();
        if (cells[x][z] === CellType.Road) roads++;
        cells[x][z] = CellType.Empty;
      }
      this.commit({ cells, stations: (this.map.stations ?? []).filter((s) => s.id !== id) }, true);
      this.roadCount -= roads;
      let net = this.map.railNet ?? EMPTY_NET;
      for (const { x, z, lx } of oilCells(st)) if (oilTrackColumn(st, lx)) net = cutAtCell(net, x, z);
      this.setRailNet(net, null);
      return;
    }
    if (st.kind === 'depot') {
      const cells = this.map.cells.slice();
      let roads = 0;
      for (const { x, z, lz } of depotCells(st)) {
        if (lz < 2) continue;
        if (cells[x] === this.map.cells[x]) cells[x] = cells[x].slice();
        if (cells[x][z] === CellType.Road) roads++;
        cells[x][z] = CellType.Empty;
      }
      this.commit({ cells, stations: (this.map.stations ?? []).filter((s) => s.id !== id) }, true);
      this.roadCount -= roads;
      let net = this.map.railNet ?? EMPTY_NET;
      for (const { x, z, lz } of depotCells(st)) if (lz < 2) net = cutAtCell(net, x, z);
      this.setRailNet(net, null);
      return;
    }
    const g = stationGeom(st.anchor, st.side, st.ext);
    const cells = this.map.cells.slice();
    const truck = stopKind(st) === 'truck';
    const rows = truck ? [...g.platform, ...g.track] : g.platform;
    for (const [x, z] of rows) {
      if (cells[x] === this.map.cells[x]) cells[x] = cells[x].slice();
      cells[x][z] = CellType.Empty;
    }
    this.commit({ cells, stations: (this.map.stations ?? []).filter((s) => s.id !== id) }, true);
    if (truck) {
      this.roadCount -= g.track.length;
      this.emit();
      return;
    }
    let net = this.map.railNet ?? EMPTY_NET;
    for (const [x, z] of g.track) net = cutAtCell(net, x, z);
    this.setRailNet(net, null);
  }

  /**
   * Bulldoze `(x, z)` back to Empty if it holds something removable (road,
   * rail, or forest). Hills, water, city and industry are not bulldozable.
   * Returns true if something was cleared.
   */
  bulldoze(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const current = this.map.cells[x][z];
    const key = cellKey(this.map.size, x, z);
    const cleared = this.map.cleared ?? new Set<number>();

    // A traffic control goes first (the road under it stays).
    if (this.map.controls?.has(cellIndex(this.map, x, z))) return this.setControl(x, z, null);
    // So does a rail signal (the track stays).
    if (this.removeSignal(x, z)) return true;

    // A station's platform or track: the whole station goes.
    const st = stationAt(this.map, x, z);
    if (st) {
      this.removeStation(st.id);
      return true;
    }

    // An interior cell with nothing on the ground: the bridge / tunnel over it goes.
    const span = interiorAt(this.map, x, z);
    if (span && current !== CellType.Road && current !== CellType.Rail && !(current === CellType.Forest || (canClearProps(current) && !cleared.has(key)))) {
      return this.removeStructure(span.id);
    }

    // Track (incl. a level crossing — the road stays): cut it out here.
    if ((current === CellType.Rail || current === CellType.Road) && hasRailAt(this.map, x, z)) {
      const net = cutAtCell(this.map.railNet ?? EMPTY_NET, x, z);
      if (net !== this.map.railNet) {
        this.setRailNet(net, null);
        return true;
      }
    }

    // A pipeline under bare ground / water goes (a road, track or tree over it first).
    if (current !== CellType.Road && current !== CellType.Rail && current !== CellType.Forest && this.removePipe(x, z)) return true;

    if (canBulldoze(current)) {
      // Road / rail / forest → bare ground, and mark it cleared so no fringe
      // tree or rock pops back onto the freshly cleared cell.
      if (current === CellType.Road) this.roadCount -= 1;
      const next = new Set(cleared);
      next.add(key);
      this.map = { ...this.map, cleared: next };
      if (this.map.dirt?.has(key)) {
        const dirt = new Set(this.map.dirt);
        dirt.delete(key);
        this.map = { ...this.map, dirt };
      }
      // A road/rail on a raised cell goes back to hillside, not flat grass.
      const raised = (current === CellType.Road || current === CellType.Rail) && this.map.heights[x][z] > 0;
      this.applyCell(x, z, raised ? CellType.Hill : CellType.Empty);
      this.emit();
      return true;
    }
    if (canClearProps(current) && !cleared.has(key)) {
      // Lone trees / bushes / rocks on grass or mountainside.
      const next = new Set(cleared);
      next.add(key);
      this.commit({ cleared: next }, true);
      this.emit();
      return true;
    }
    // Buildings, city, industry lots and water are not bulldozable.
    return false;
  }

  /** Raise `(x, z)` by one terraform step. Returns true if it changed. */
  raise(x: number, z: number): boolean {
    return this.terraformBatch([{ x, z, delta: +HILL_STEP }]);
  }

  /** Lower `(x, z)` by one terraform step. Returns true if it changed. */
  lower(x: number, z: number): boolean {
    return this.terraformBatch([{ x, z, delta: -HILL_STEP }]);
  }

  /** One terraform step (in cellSize units) up or down. */
  terraformStep(): number {
    return HILL_STEP;
  }

  /**
   * Whether `(x, z)` can be sculpted: in bounds and not under the city, an
   * industry, a road or a rail. Used to validate a selection before building.
   */
  canTerraform(x: number, z: number): boolean {
    if (!this.inBounds(x, z)) return false;
    const t = this.map.cells[x][z];
    return (
      !structureAt(this.map, x, z) && // a bridge / tunnel's ends and span
      !trenchAt(this.map, x, z) && // an underpass's ramps
      t !== CellType.CityCenter &&
      !SPECIAL_BUILDINGS.has(t) &&
      t !== CellType.IndustryLot && // big-industry (6×6) footprint
      t !== CellType.Station &&
      t !== CellType.Road &&
      t !== CellType.Rail
    );
  }

  /**
   * Apply many terraform edits in ONE commit (one geometry update, one emit) —
   * used by the confirmed, batched terraforming flow so a whole selection is
   * applied at once rather than cell-by-cell. Each edit raises/lowers a cell by
   * `delta` (clamped). Water physics is applied per cell after all heights are
   * set. Returns true if anything changed.
   */
  terraformBatch(edits: Array<{ x: number; z: number; delta: number }>): boolean {
    const heights = this.map.heights.map((col) => col.slice());
    const cells = this.map.cells.map((col) => col.slice());
    let changed = false;
    let typeChanged = false;

    // Water cells that a raise FILLS: they become land level with the shore
    // (height 0) instead of climbing a step above it.
    const filled = new Set<string>();

    // 1) Apply all height deltas first (so adjacency/water sees final heights).
    for (const { x, z, delta } of edits) {
      if (!this.canTerraform(x, z)) continue;
      const cur = heights[x][z];
      if (delta > 0 && cells[x][z] === CellType.Water) {
        heights[x][z] = Math.max(0, cur);
        filled.add(`${x},${z}`);
        changed = true;
        continue;
      }
      const next = clamp(cur + delta, MIN_HEIGHT, MAX_HEIGHT);
      if (next === cur) continue;
      heights[x][z] = next;
      changed = true;
    }
    if (!changed) return false;

    // 2) Resolve cell types from the new heights (water physics).
    for (const { x, z } of edits) {
      if (!this.inBounds(x, z)) continue;
      const h = heights[x][z];
      const before = cells[x][z];
      if (filled.has(`${x},${z}`)) {
        cells[x][z] = CellType.Empty;
      } else if (h < 0) {
        cells[x][z] = CellType.Water;
      } else if (h === 0 && this.adjacentToWaterIn(cells, x, z)) {
        cells[x][z] = CellType.Water;
      } else if (before === CellType.Water) {
        cells[x][z] = CellType.Empty;
      } else if (before === CellType.Forest) {
        cells[x][z] = CellType.Empty;
      }
      if (cells[x][z] !== before) typeChanged = true;
    }

    this.commit({ cells, heights }, typeChanged);
    return true;
  }

  /**
   * Replace the whole map (e.g. regenerate with a new seed). Resets derived
   * counts.
   */
  regenerate(options: GenerateOptions = {}): void {
    this.map = generateTerrain(options);
    this.roadCount = this.countType(CellType.Road);
    this.industryCount = this.countSpecialBuildings();
    this.emit();
  }

  /** Replace the whole map with a saved one (see save.ts); every overlay rebuilds. */
  load(map: TerrainMap): void {
    this.map = { ...map, version: this.map.version + 1, cellsVersion: this.map.cellsVersion + 1 };
    this.roadCount = this.countType(CellType.Road);
    this.industryCount = this.countSpecialBuildings();
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** True if any orthogonal neighbour of (x,z) is Water in `cells`. */
  private adjacentToWaterIn(cells: CellType[][], x: number, z: number): boolean {
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    return dirs.some(([dx, dz]) => {
      const nx = x + dx;
      const nz = z + dz;
      return this.inBounds(nx, nz) && cells[nx][nz] === CellType.Water;
    });
  }

  /**
   * Immutably update one cell type: copy the touched column so the overall
   * `cells` reference changes, bump `version`. `heights` is shared (unchanged),
   * so elevation survives type changes.
   */
  private applyCell(x: number, z: number, type: CellType): void {
    const cells = this.map.cells.slice();
    const col = cells[x].slice();
    col[z] = type;
    cells[x] = col;
    this.commit({ cells }, true); // a cell type changed
  }

  /**
   * Commit new cells/heights into a fresh map object. `version` always bumps
   * (the terrain surface rebuilds on any edit). `cellsVersion` bumps only when
   * a cell TYPE changed, so overlay renderers (roads/rail/industry/forest)
   * skip their geometry rebuild on pure height edits.
   */
  private commit(
    partial: {
      cells?: CellType[][];
      heights?: number[][];
      cleared?: ReadonlySet<number>;
      dirt?: ReadonlySet<number>;
      railNet?: RailNet;
      stations?: TerrainMap['stations'];
      structures?: TerrainMap['structures'];
    },
    typeChanged: boolean,
  ): void {
    this.map = {
      ...this.map,
      ...partial,
      version: this.map.version + 1,
      cellsVersion: this.map.cellsVersion + (typeChanged ? 1 : 0),
    };
  }

  private countType(type: CellType): number {
    let n = 0;
    for (let x = 0; x < this.map.size; x++) {
      for (let z = 0; z < this.map.size; z++) {
        if (this.map.cells[x][z] === type) n++;
      }
    }
    return n;
  }

  private countSpecialBuildings(): number {
    let n = 0;
    for (let x = 0; x < this.map.size; x++) {
      for (let z = 0; z < this.map.size; z++) {
        if (SPECIAL_BUILDINGS.has(this.map.cells[x][z])) n++;
      }
    }
    return n;
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
