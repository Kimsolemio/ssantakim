/**
 * 체험판 전용: Firestore 대신 이 기기(localStorage)에만 저장하는 작은 흉내.
 * 앱이 쓰는 기능만 구현한다 (vite --mode demo 에서 "firebase/firestore" 대신 쓰인다).
 */
type Data = Record<string, unknown>;

const KEY = "cook-demo-db-v1";
const store: Map<string, Data> = load();

function load(): Map<string, Data> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return new Map(Object.entries(JSON.parse(raw) as Record<string, Data>));
  } catch { /* 저장소를 못 쓰면 메모리로만 */ }
  return new Map();
}
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(store))); } catch { /* 가득 찼거나 막힘 */ }
  }, 60);
}
/** 체험 데이터를 모두 지운다 */
export function resetDemoStore() {
  store.clear();
  try { localStorage.removeItem(KEY); } catch { /* 무시 */ }
  emit();
}

export type Firestore = { kind: "db" };
const DB: Firestore = { kind: "db" };
export function initializeFirestore(..._args: unknown[]): Firestore { return DB; }
export function getFirestore(): Firestore { return DB; }
export function connectFirestoreEmulator(..._args: unknown[]) { /* 체험판에는 없음 */ }
export function persistentLocalCache(..._args: unknown[]) { return {}; }
export function persistentMultipleTabManager(..._args: unknown[]) { return {}; }

export type CollectionReference = { kind: "col"; path: string; id: string };
export type DocumentReference = { kind: "doc"; path: string; id: string; parentPath: string };
type Constraint =
  | { type: "where"; field: string; op: string; value: unknown }
  | { type: "orderBy"; field: string; dir: "asc" | "desc" };
export type Query = { kind: "query"; col: CollectionReference; cons: Constraint[] };
type Ref = Firestore | CollectionReference | DocumentReference;

const join = (...p: string[]) => p.filter(Boolean).join("/");
const ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const autoId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => ID_CHARS[b % 62]).join("");

export function collection(parent: Ref, ...segs: string[]): CollectionReference {
  const path = join(parent.kind === "db" ? "" : parent.path, ...segs);
  return { kind: "col", path, id: path.split("/").pop() ?? "" };
}
export function doc(parent: Ref, ...segs: string[]): DocumentReference {
  const path = parent.kind === "col" && segs.length === 0
    ? join(parent.path, autoId())
    : join(parent.kind === "db" ? "" : parent.path, ...segs);
  const parts = path.split("/");
  return { kind: "doc", path, id: parts[parts.length - 1], parentPath: parts.slice(0, -1).join("/") };
}
export function where(field: string, op: string, value: unknown): Constraint { return { type: "where", field, op, value }; }
export function orderBy(field: string, dir: "asc" | "desc" = "asc"): Constraint { return { type: "orderBy", field, dir }; }
export function query(col: CollectionReference, ...cons: Constraint[]): Query { return { kind: "query", col, cons }; }

class FieldValue { constructor(public op: "inc" | "union" | "delete", public arg?: unknown) {} }
export const increment = (n: number) => new FieldValue("inc", n);
export const arrayUnion = (...xs: unknown[]) => new FieldValue("union", xs);
export const deleteField = () => new FieldValue("delete");

class DemoError extends Error { constructor(public code: string, message: string) { super(message); } }

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)) as T);
/** undefined 는 저장하지 않는다 (ignoreUndefinedProperties) */
function cleanDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(cleanDeep);
  if (v && typeof v === "object" && !(v instanceof FieldValue)) {
    const out: Data = {};
    for (const [k, x] of Object.entries(v as Data)) if (x !== undefined) out[k] = cleanDeep(x);
    return out;
  }
  return v;
}
function applyPatch(prev: Data, patch: Data): Data {
  const out = clone(prev) ?? {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const keys = k.split(".");
    let target = out as Data;
    for (const key of keys.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      target = target[key] as Data;
    }
    const last = keys[keys.length - 1];
    if (v instanceof FieldValue) {
      if (v.op === "delete") delete target[last];
      else if (v.op === "inc") target[last] = (typeof target[last] === "number" ? (target[last] as number) : 0) + (v.arg as number);
      else {
        const arr = Array.isArray(target[last]) ? [...(target[last] as unknown[])] : [];
        for (const x of v.arg as unknown[]) if (!arr.some((y) => JSON.stringify(y) === JSON.stringify(x))) arr.push(clone(x));
        target[last] = arr;
      }
    } else target[last] = cleanDeep(v);
  }
  return out;
}

type Write =
  | { op: "set"; ref: DocumentReference; data: Data; merge?: boolean }
  | { op: "update"; ref: DocumentReference; data: Data }
  | { op: "delete"; ref: DocumentReference };
function commitWrites(writes: Write[]) {
  for (const w of writes) {
    if (w.op === "update" && !store.has(w.ref.path)) throw new DemoError("not-found", `No document to update: ${w.ref.path}`);
  }
  for (const w of writes) {
    if (w.op === "delete") store.delete(w.ref.path);
    else if (w.op === "update") store.set(w.ref.path, applyPatch(store.get(w.ref.path) ?? {}, w.data));
    else store.set(w.ref.path, applyPatch(w.merge ? store.get(w.ref.path) ?? {} : {}, w.data));
  }
  save();
  emit();
}

export async function setDoc(ref: DocumentReference, data: Data, opts?: { merge?: boolean }) { commitWrites([{ op: "set", ref, data, merge: opts?.merge }]); }
export async function updateDoc(ref: DocumentReference, data: Data) { commitWrites([{ op: "update", ref, data }]); }
export async function deleteDoc(ref: DocumentReference) { commitWrites([{ op: "delete", ref }]); }
export async function addDoc(col: CollectionReference, data: Data) { const ref = doc(col); commitWrites([{ op: "set", ref, data }]); return ref; }

export function writeBatch(_db?: Firestore) {
  const writes: Write[] = [];
  const b = {
    set(ref: DocumentReference, data: Data, opts?: { merge?: boolean }) { writes.push({ op: "set", ref, data, merge: opts?.merge }); return b; },
    update(ref: DocumentReference, data: Data) { writes.push({ op: "update", ref, data }); return b; },
    delete(ref: DocumentReference) { writes.push({ op: "delete", ref }); return b; },
    async commit() { commitWrites(writes); },
  };
  return b;
}

function docSnap(ref: DocumentReference) {
  const data = store.get(ref.path);
  return {
    id: ref.id, ref,
    exists: () => data !== undefined,
    data: () => clone(data) as Data | undefined,
    metadata: { hasPendingWrites: false, fromCache: false },
  };
}
export type DocumentSnapshot = ReturnType<typeof docSnap>;

export async function getDoc(ref: DocumentReference) { return docSnap(ref); }

export async function runTransaction<T>(_db: Firestore, fn: (tx: {
  get: (ref: DocumentReference) => Promise<DocumentSnapshot>;
  set: (ref: DocumentReference, data: Data, opts?: { merge?: boolean }) => void;
  update: (ref: DocumentReference, data: Data) => void;
  delete: (ref: DocumentReference) => void;
}) => Promise<T>): Promise<T> {
  const writes: Write[] = [];
  const result = await fn({
    get: async (ref) => docSnap(ref),
    set: (ref, data, opts) => { writes.push({ op: "set", ref, data, merge: opts?.merge }); },
    update: (ref, data) => { writes.push({ op: "update", ref, data }); },
    delete: (ref) => { writes.push({ op: "delete", ref }); },
  });
  commitWrites(writes);
  return result;
}

function get(obj: Data, field: string): unknown {
  return field.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Data)[k] : undefined), obj);
}
function cmp(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function querySnap(q: Query) {
  const prefix = `${q.col.path}/`;
  let docs = [...store.keys()]
    .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
    .map((p) => doc(DB, p));
  for (const c of q.cons) {
    if (c.type !== "where") continue;
    docs = docs.filter((d) => {
      const v = get(store.get(d.path)!, c.field);
      switch (c.op) {
        case "==": return v === c.value;
        case "!=": return v !== c.value;
        case ">=": return cmp(v, c.value) >= 0;
        case "<=": return cmp(v, c.value) <= 0;
        case ">": return cmp(v, c.value) > 0;
        case "<": return cmp(v, c.value) < 0;
        case "in": return Array.isArray(c.value) && c.value.includes(v);
        default: return true;
      }
    });
  }
  const orders = q.cons.filter((c): c is Extract<Constraint, { type: "orderBy" }> => c.type === "orderBy");
  if (orders.length) {
    docs.sort((a, b) => {
      for (const o of orders) {
        const r = cmp(get(store.get(a.path)!, o.field), get(store.get(b.path)!, o.field));
        if (r !== 0) return o.dir === "desc" ? -r : r;
      }
      return 0;
    });
  }
  const snaps = docs.map(docSnap);
  return { docs: snaps, size: snaps.length, empty: snaps.length === 0, forEach: (cb: (d: DocumentSnapshot) => void) => snaps.forEach(cb), metadata: { hasPendingWrites: false, fromCache: false } };
}

type Listener = { target: DocumentReference | Query | CollectionReference; next: (snap: never) => void; last?: string };
const listeners = new Set<Listener>();
let emitting = false;
function snapOf(l: Listener) {
  return l.target.kind === "doc" ? docSnap(l.target) : querySnap(l.target.kind === "col" ? query(l.target) : l.target);
}
function fire(l: Listener) {
  const snap = snapOf(l);
  const key = JSON.stringify(l.target.kind === "doc"
    ? (snap as DocumentSnapshot).data() ?? null
    : (snap as ReturnType<typeof querySnap>).docs.map((d) => [d.id, d.data()]));
  if (key === l.last) return; // 바뀐 게 없으면 다시 알리지 않는다
  l.last = key;
  try { (l.next as (s: unknown) => void)(snap); } catch (e) { console.error(e); }
}
function emit() {
  if (emitting) return;
  emitting = true;
  // 실제 Firestore처럼 쓰기 다음 차례에 알린다
  setTimeout(() => { emitting = false; for (const l of [...listeners]) if (listeners.has(l)) fire(l); }, 0);
}

export function onSnapshot(target: DocumentReference | Query | CollectionReference, ...args: unknown[]): () => void {
  const fns = args.filter((a): a is (s: never) => void => typeof a === "function");
  const l: Listener = { target, next: fns[0] };
  listeners.add(l);
  setTimeout(() => { if (listeners.has(l)) fire(l); }, 0);
  return () => { listeners.delete(l); };
}
