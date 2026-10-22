/**
 * Model editor — the dev-server side (only active under `npm run dev`).
 *
 *   1. `srcTagBabel`: a Babel plugin that tags every 3D element in the model
 *      files with where it is written (`userData-src="file:line:col"`).
 *      Component calls (`<Box p={…} s={…} />`) are wrapped in an invisible
 *      `<group>` carrying the tag, so the CALL SITE — where the numbers live —
 *      can be picked in the game, not just the component's insides.
 *   2. `modelEditorServer`: endpoints under /__model-editor that inspect such
 *      an element in the source and rewrite its numbers (position / size /
 *      rotation props) in place, plus a simple undo stack. Vite's HMR then
 *      reloads the model with the new values.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parse } from '@babel/parser';
import type { PluginObj, types as BabelTypes } from '@babel/core';
import type * as T from '@babel/types';
import type { Plugin } from 'vite';

/** Files whose elements can be picked and edited. */
export const EDITABLE_FILES = /[\\/]src[\\/]render[\\/](\w+Model|Industries)\.tsx$/;
/** Lower-case R3F elements that become pickable scene objects. */
const HOST = new Set(['mesh', 'group', 'instancedMesh', 'points', 'line', 'lineSegments', 'sprite']);

type V3 = [number, number, number];

// ---------------------------------------------------------------- babel tag

export function srcTagBabel({ types: t }: { types: typeof BabelTypes }): PluginObj {
  const root = process.cwd();
  return {
    name: 'model-src-tag',
    visitor: {
      JSXElement(p, state) {
        const file = state.filename ?? '';
        if (!EDITABLE_FILES.test(file)) return;
        const node = p.node as T.JSXElement & { _srcTagged?: boolean };
        if (node._srcTagged) return;
        const open = node.openingElement;
        const loc = open.loc;
        if (!loc || open.name.type !== 'JSXIdentifier') return;
        const name = open.name.name;
        const rel = path.relative(root, file).split(path.sep).join('/');
        const tag = t.jsxAttribute(
          t.jsxIdentifier('userData-src'),
          t.stringLiteral(`${rel}:${loc.start.line}:${loc.start.column}`),
        );
        if (HOST.has(name)) {
          node._srcTagged = true;
          open.attributes.push(tag);
        } else if (/^[A-Z]/.test(name) && name !== 'Fragment') {
          node._srcTagged = true;
          const attrs: T.JSXAttribute[] = [
            tag,
            t.jsxAttribute(t.jsxIdentifier('userData-wrap'), t.jsxExpressionContainer(t.booleanLiteral(true))),
          ];
          const key = open.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === 'key');
          if (key) attrs.push(t.cloneNode(key as T.JSXAttribute));
          const wrapper = t.jsxElement(
            t.jsxOpeningElement(t.jsxIdentifier('group'), attrs),
            t.jsxClosingElement(t.jsxIdentifier('group')),
            [node],
          ) as T.JSXElement & { _srcTagged?: boolean };
          wrapper._srcTagged = true;
          p.replaceWith(wrapper);
        }
      },
    },
  };
}

// ---------------------------------------------------------------- source analysis

const SKIP = new Set(['loc', 'start', 'end', 'extra', 'range', 'leadingComments', 'trailingComments', 'innerComments']);

function kids(n: T.Node): T.Node[] {
  const out: T.Node[] = [];
  for (const k in n) {
    if (SKIP.has(k)) continue;
    const v = (n as unknown as Record<string, unknown>)[k];
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof (x as T.Node).type === 'string') out.push(x as T.Node);
    } else if (v && typeof (v as T.Node).type === 'string') out.push(v as T.Node);
  }
  return out;
}

/** The JSX element whose opening tag starts at line:col, with its ancestors. */
function findElement(ast: T.Node, line: number, col: number): { el: T.JSXElement; anc: T.Node[] } | null {
  const stack: Array<{ n: T.Node; anc: T.Node[] }> = [{ n: ast, anc: [] }];
  while (stack.length) {
    const { n, anc } = stack.pop()!;
    if (n.type === 'JSXElement') {
      const s = n.openingElement.loc?.start;
      if (s && s.line === line && s.column === col) return { el: n, anc };
    }
    const next = anc.concat(n);
    for (const c of kids(n)) stack.push({ n: c, anc: next });
  }
  return null;
}

interface Attr {
  node: T.JSXAttribute;
  expr: T.Expression | null;
}

function attrsOf(el: T.JSXElement): Map<string, Attr> {
  const m = new Map<string, Attr>();
  for (const a of el.openingElement.attributes) {
    if (a.type !== 'JSXAttribute' || a.name.type !== 'JSXIdentifier') continue;
    const v = a.value;
    const expr = v && v.type === 'JSXExpressionContainer' && v.expression.type !== 'JSXEmptyExpression' ? v.expression : null;
    m.set(a.name.name, { node: a, expr });
  }
  return m;
}

const tagName = (el: T.JSXElement) => (el.openingElement.name.type === 'JSXIdentifier' ? el.openingElement.name.name : '?');

function num(e: T.Node | null | undefined): number | null {
  if (!e) return null;
  if (e.type === 'NumericLiteral') return e.value;
  if (e.type === 'UnaryExpression' && e.operator === '-' && e.argument.type === 'NumericLiteral') return -e.argument.value;
  return null;
}

function fmt(v: number): string {
  const s = String(Math.round(v * 10000) / 10000);
  return s === '-0' ? '0' : s;
}

/** Array literal with exactly n (non-spread) elements, or null. */
function arr(e: T.Expression | null, ...n: number[]): T.Expression[] | null {
  if (!e || e.type !== 'ArrayExpression' || !n.includes(e.elements.length)) return null;
  if (e.elements.some((x) => !x || x.type === 'SpreadElement')) return null;
  return e.elements as T.Expression[];
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

class Ctx {
  constructor(readonly src: string) {}
  text(n: T.Node): string {
    return this.src.slice(n.start!, n.end!);
  }
  /** `e + d`, folding into a trailing numeric term / literal. */
  shift(e: T.Expression, d: number): Edit {
    const v = num(e);
    if (v !== null) return { start: e.start!, end: e.end!, text: fmt(v + d) };
    if (e.type === 'BinaryExpression' && (e.operator === '+' || e.operator === '-') && num(e.right) !== null) {
      const k = (e.operator === '+' ? 1 : -1) * num(e.right)! + d;
      const left = this.text(e.left);
      const text = Math.abs(k) < 1e-9 ? left : `${left} ${k >= 0 ? '+' : '-'} ${fmt(Math.abs(k))}`;
      return { start: e.start!, end: e.end!, text };
    }
    const simple = ['Identifier', 'MemberExpression', 'CallExpression', 'BinaryExpression'].includes(e.type);
    const base = simple ? this.text(e) : `(${this.text(e)})`;
    return { start: e.start!, end: e.end!, text: `${base} ${d >= 0 ? '+' : '-'} ${fmt(Math.abs(d))}` };
  }
  /** `e * f`, folding into a trailing numeric factor / literal. */
  mul(e: T.Expression, f: number): Edit {
    const v = num(e);
    if (v !== null) return { start: e.start!, end: e.end!, text: fmt(v * f) };
    if (e.type === 'BinaryExpression' && e.operator === '*' && num(e.right) !== null) {
      const k = num(e.right)! * f;
      const left = this.text(e.left);
      return { start: e.start!, end: e.end!, text: Math.abs(k - 1) < 1e-9 ? left : `${left} * ${fmt(k)}` };
    }
    const simple =
      ['Identifier', 'MemberExpression', 'CallExpression'].includes(e.type) ||
      (e.type === 'BinaryExpression' && ['*', '/', '%'].includes(e.operator));
    const base = simple ? this.text(e) : `(${this.text(e)})`;
    return { start: e.start!, end: e.end!, text: `${base} * ${fmt(f)}` };
  }
}

const nz = (v: number) => Math.abs(v) > 1e-9;
const vec = (v: number[]) => `[${v.map(fmt).join(', ')}]`;

interface Plan {
  edits: Edit[];
  error?: string;
  /** Column shift of the element's own opening tag (when wrapped). */
  colShift?: number;
}

function insertAttr(el: T.JSXElement, text: string): Edit {
  const at = el.openingElement.name.end!;
  return { start: at, end: at, text: ` ${text}` };
}

function planMove(c: Ctx, el: T.JSXElement, anc: T.Node[], d: V3): Plan {
  const A = attrsOf(el);
  const host = HOST.has(tagName(el));
  const edits: Edit[] = [];
  const covered = [false, false, false];
  for (const name of ['position', 'p', 'origin']) {
    const a = A.get(name);
    if (!a?.expr) continue;
    const xs = arr(a.expr, 3);
    if (!xs) return { edits, error: `A <${tagName(el)}> pozíciója itt egy változóból jön (${name}={…}) — a szülő elemen állítsd.` };
    xs.forEach((x, i) => nz(d[i]) && edits.push(c.shift(x, d[i])));
    covered.fill(true);
    break;
  }
  if (!covered.every(Boolean)) {
    for (const [na, nb] of [['from', 'to'], ['a', 'b']]) {
      const xa = arr(A.get(na)?.expr ?? null, 2, 3);
      const xb = arr(A.get(nb)?.expr ?? null, 2, 3);
      if (!xa || !xb || xa.length !== xb.length) continue;
      const axes = xa.length === 2 ? [0, 2] : [0, 1, 2];
      axes.forEach((ax, i) => {
        if (nz(d[ax])) edits.push(c.shift(xa[i], d[ax]), c.shift(xb[i], d[ax]));
        covered[ax] = true;
      });
      break;
    }
  }
  ['x', 'y', 'z'].forEach((name, i) => {
    const e = A.get(name)?.expr;
    if (!e || covered[i]) return;
    if (nz(d[i])) edits.push(c.shift(e, d[i]));
    covered[i] = true;
  });
  const rest = d.map((v, i) => (covered[i] ? 0 : v));
  if (!rest.some(nz)) return { edits };
  if (host) {
    edits.push(insertAttr(el, `position={${vec(rest)}}`));
    return { edits };
  }
  // A component with nothing to shift on that axis: reuse a wrapping
  // <group position={[…]}> that holds only this element, or add one.
  const parent = anc[anc.length - 1];
  if (parent?.type === 'JSXElement' && tagName(parent) === 'group') {
    const only = parent.children.filter((ch) => !(ch.type === 'JSXText' && !ch.value.trim()));
    const xs = arr(attrsOf(parent).get('position')?.expr ?? null, 3);
    if (only.length === 1 && xs) {
      xs.forEach((x, i) => nz(rest[i]) && edits.push(c.shift(x, rest[i])));
      return { edits };
    }
  }
  const key = A.get('key')?.expr;
  const open = `<group position={${vec(rest)}}${key ? ` key={${c.text(key)}}` : ''}>`;
  edits.push({ start: el.start!, end: el.start!, text: open }, { start: el.end!, end: el.end!, text: '</group>' });
  return { edits, colShift: open.length };
}

function planScale(c: Ctx, el: T.JSXElement, f: V3): Plan {
  const A = attrsOf(el);
  const host = HOST.has(tagName(el));
  const edits: Edit[] = [];
  const covered = [false, false, false];
  const uniform = Math.max(...f) - Math.min(...f) < 1e-6;
  for (const name of ['scale', 's']) {
    const a = A.get(name);
    if (!a?.expr) continue;
    const xs = arr(a.expr, 3);
    if (xs) xs.forEach((x, i) => Math.abs(f[i] - 1) > 1e-9 && edits.push(c.mul(x, f[i])));
    else if (num(a.expr) !== null || (a.expr.type === 'BinaryExpression' && a.expr.operator === '*' && num(a.expr.right) !== null)) {
      if (uniform) edits.push(c.mul(a.expr, f[0]));
      else {
        const e = a.expr;
        const parts = f.map((k) => c.mul(e, k).text);
        edits.push({ start: e.start!, end: e.end!, text: `[${parts.join(', ')}]` });
      }
    } else return { edits, error: `A <${tagName(el)}> mérete itt egy változóból jön (${name}={…}) — a szülő elemen állítsd.` };
    covered.fill(true);
    break;
  }
  ['w', 'h', 'd'].forEach((name, i) => {
    const e = A.get(name)?.expr;
    if (!e || covered[i]) return;
    if (Math.abs(f[i] - 1) > 1e-9) edits.push(c.mul(e, f[i]));
    covered[i] = true;
  });
  const rest = f.map((v, i) => (covered[i] ? 1 : v));
  if (!rest.some((v) => Math.abs(v - 1) > 1e-9)) return { edits };
  if (host) {
    edits.push(insertAttr(el, `scale={${vec(rest)}}`));
    return { edits };
  }
  return { edits, error: `A <${tagName(el)}> elemnek nincs méret-paramétere ezen a tengelyen — próbáld a gyerek elemén.` };
}

function planRotate(c: Ctx, el: T.JSXElement, r: V3): Plan {
  const A = attrsOf(el);
  const host = HOST.has(tagName(el));
  const edits: Edit[] = [];
  const covered = [false, false, false];
  const rot = A.get('rotation');
  if (rot?.expr) {
    const xs = arr(rot.expr, 3);
    if (!xs) return { edits, error: `A <${tagName(el)}> forgatása itt egy változóból jön — a szülő elemen állítsd.` };
    xs.forEach((x, i) => nz(r[i]) && edits.push(c.shift(x, r[i])));
    covered.fill(true);
  }
  ['rotation-x', 'rotation-y', 'rotation-z'].forEach((name, i) => {
    const e = A.get(name)?.expr;
    if (!e || covered[i]) return;
    if (nz(r[i])) edits.push(c.shift(e, r[i]));
    covered[i] = true;
  });
  for (const name of ['rotY', 'yaw', 'rot', 'rotationY']) {
    const e = A.get(name)?.expr;
    if (!e || covered[1]) continue;
    if (nz(r[1])) edits.push(c.shift(e, r[1]));
    covered[1] = true;
  }
  const rest = r.map((v, i) => (covered[i] ? 0 : v));
  if (!rest.some(nz)) return { edits };
  if (host && !rot) {
    edits.push(insertAttr(el, `rotation={${vec(rest)}}`));
    return { edits };
  }
  return { edits, error: `A <${tagName(el)}> ezen a tengelyen nem forgatható — próbáld a szülő vagy a gyerek elemén.` };
}

/** Is the element generated in a loop (.map / Array.from) inside its component? */
function inLoop(anc: T.Node[]): boolean {
  for (let i = anc.length - 1; i >= 0; i--) {
    const n = anc[i];
    if (n.type === 'FunctionDeclaration') break;
    if (n.type === 'CallExpression') {
      const cal = n.callee;
      if (cal.type === 'MemberExpression' && cal.property.type === 'Identifier' && ['map', 'flatMap', 'from'].includes(cal.property.name)) return true;
    }
  }
  return false;
}

/** Name of the component function the element is written in. */
function ownerComponent(anc: T.Node[]): string | null {
  for (let i = anc.length - 1; i >= 0; i--) {
    const n = anc[i];
    if (n.type === 'FunctionDeclaration' && n.id && /^[A-Z]/.test(n.id.name)) return n.id.name;
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && /^[A-Z]/.test(n.id.name)) return n.id.name;
  }
  return null;
}

// ---------------------------------------------------------------- server

interface Located {
  abs: string;
  rel: string;
  line: number;
  col: number;
  src: string;
  ast: T.Node;
  el: T.JSXElement;
  anc: T.Node[];
}

function locate(root: string, id: string): Located | string {
  const m = /^(.*):(\d+):(\d+)$/.exec(id);
  if (!m) return 'Hibás azonosító';
  const rel = m[1];
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep) || !EDITABLE_FILES.test(abs) || !fs.existsSync(abs)) return 'Ez a fájl nem szerkeszthető';
  const src = fs.readFileSync(abs, 'utf8');
  const ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'typescript'] }) as unknown as T.Node;
  const line = Number(m[2]), col = Number(m[3]);
  const hit = findElement(ast, line, col);
  if (!hit) return 'Az elem nem található (a fájl közben változott?) — kattints rá újra.';
  return { abs, rel, line, col, src, ast, ...hit };
}

/** How many times `<Name` is used across the editable model files. */
function usesOf(root: string, name: string): number {
  const dir = path.join(root, 'src', 'render');
  let n = 0;
  for (const f of fs.readdirSync(dir)) {
    const abs = path.join(dir, f);
    if (!EDITABLE_FILES.test(abs)) continue;
    n += (fs.readFileSync(abs, 'utf8').match(new RegExp(`<${name}[\\s/>]`, 'g')) ?? []).length;
  }
  return n;
}

const AXES: V3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function inspect(root: string, id: string) {
  const L = locate(root, id);
  if (typeof L === 'string') return { src: id, error: L };
  const c = new Ctx(L.src);
  const owner = ownerComponent(L.anc);
  const code = c.text(L.el.openingElement).replace(/\s+/g, ' ');
  return {
    src: id,
    tag: tagName(L.el),
    host: HOST.has(tagName(L.el)),
    file: L.rel,
    line: L.line,
    code: code.length > 260 ? code.slice(0, 257) + '…' : code,
    repeated: inLoop(L.anc),
    owner,
    ownerUses: owner ? usesOf(root, owner) : 0,
    canMove: !planMove(c, L.el, L.anc, [1, 1, 1]).error,
    // Per axis (x, y, z): which handles the gizmo may offer.
    scaleAxes: AXES.map((u) => !planScale(c, L.el, u.map((v) => 1 + v) as V3).error),
    rotateAxes: AXES.map((u) => !planRotate(c, L.el, u).error),
  };
}

interface EditReq {
  src: string;
  move?: V3;
  scale?: V3;
  rotate?: V3;
}

function applyEdit(root: string, req: EditReq, undo: Array<{ abs: string; text: string }>) {
  const L = locate(root, req.src);
  if (typeof L === 'string') return { ok: false, error: L };
  const c = new Ctx(L.src);
  const plan = req.move
    ? planMove(c, L.el, L.anc, req.move)
    : req.scale
      ? planScale(c, L.el, req.scale)
      : req.rotate
        ? planRotate(c, L.el, req.rotate)
        : { edits: [], error: 'Nincs mit menteni' };
  if (plan.error) return { ok: false, error: plan.error };
  if (!plan.edits.length) return { ok: true, src: req.src };
  let out = L.src;
  for (const e of plan.edits.slice().sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  undo.push({ abs: L.abs, text: L.src });
  if (undo.length > 100) undo.shift();
  fs.writeFileSync(L.abs, out);
  return { ok: true, src: `${L.rel}:${L.line}:${L.col + (plan.colShift ?? 0)}` };
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (ch) => (s += ch));
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, body: unknown) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export function modelEditorServer(): Plugin {
  const undo: Array<{ abs: string; text: string }> = [];
  return {
    name: 'model-editor-server',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      server.middlewares.use('/__model-editor', async (req, res) => {
        try {
          const body = (await readBody(req)) as Record<string, unknown>;
          switch (req.url) {
            case '/inspect':
              return send(res, { items: ((body.srcs as string[]) ?? []).map((s) => inspect(root, s)) });
            case '/edit':
              return send(res, applyEdit(root, body as unknown as EditReq, undo));
            case '/undo': {
              const last = undo.pop();
              if (!last) return send(res, { ok: false, error: 'Nincs mit visszavonni' });
              fs.writeFileSync(last.abs, last.text);
              return send(res, { ok: true });
            }
            default:
              res.statusCode = 404;
              return send(res, { error: 'not found' });
          }
        } catch (e) {
          res.statusCode = 500;
          send(res, { ok: false, error: String(e) });
        }
      });
    },
  };
}
