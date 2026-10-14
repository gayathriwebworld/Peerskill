'use strict';
/* =====================================================================
   A small JSON-file database.
   - All data is saved in:   data/db.json        (you can open it and read it)
   - Uploaded files go in:   data/uploads/
   It understands the few database calls the server uses (find, insertOne,
   updateOne ...), so the server code reads like normal database code.
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Writable } = require('stream');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const NAMES = ['users', 'sessions', 'connections', 'requests', 'messages', 'notifications', 'materials', 'contacts', 'counters'];

const C = {};               // the "tables" (collections) the server uses
let store = null;           // everything in memory, saved to db.json after each change
let timer = null;

/* ----------------------------------------------------------- saving */
function flush() {
  if (!store) return;
  clearTimeout(timer); timer = null;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DB_FILE);                                // safe save: the old file stays until the new one is complete
}
const touch = () => { if (!timer) timer = setTimeout(flush, 100); };

/* ----------------------------------------------------- tiny query engine */
class ObjectId {
  constructor(h) { this.hex = h ? String(h) : crypto.randomBytes(12).toString('hex'); }
  toString() { return this.hex; }
}
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isOp = o => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length > 0 && Object.keys(o).every(k => k.startsWith('$'));
const eq = (a, b) => (a && b && typeof a === 'object' && typeof b === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b);
const getPath = (d, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), d);
function setPath(d, p, v) { const ks = p.split('.'); let o = d; while (ks.length > 1) { const k = ks.shift(); if (o[k] == null) o[k] = {}; o = o[k]; } o[ks[0]] = v; }

function matchField(v, cond) {
  if (isOp(cond)) {
    return Object.entries(cond).every(([op, c]) => {
      switch (op) {
        case '$in': return c.some(x => matchField(v, x));
        case '$nin': return !c.some(x => matchField(v, x));
        case '$ne': return !matchField(v, c);
        case '$gt': return v !== undefined && v > c;
        case '$gte': return v !== undefined && v >= c;
        case '$lt': return v !== undefined && v < c;
        case '$lte': return v !== undefined && v <= c;
        case '$exists': return (v !== undefined) === c;
        default: throw new Error('Database: operator not supported: ' + op);
      }
    });
  }
  if (Array.isArray(v) && !Array.isArray(cond)) return v.some(x => eq(x, cond));
  return eq(v, cond);
}
function matches(doc, f) {
  return Object.entries(f || {}).every(([k, c]) => {
    if (k === '$or') return c.some(s => matches(doc, s));
    if (k === '$and') return c.every(s => matches(doc, s));
    return matchField(getPath(doc, k), c);
  });
}
function applyUpdate(doc, upd, isInsert) {
  for (const [op, spec] of Object.entries(upd)) {
    for (const [k, v] of Object.entries(spec)) {
      const cur = getPath(doc, k);
      if (op === '$set') setPath(doc, k, clone(v));
      else if (op === '$inc') setPath(doc, k, (cur || 0) + v);
      else if (op === '$push') setPath(doc, k, [...(cur || []), clone(v)]);
      else if (op === '$addToSet') { const a = cur || []; if (!a.some(x => eq(x, v))) a.push(clone(v)); setPath(doc, k, a); }
      else if (op === '$pull') setPath(doc, k, (cur || []).filter(x => !matchField(x, v)));
      else if (op === '$setOnInsert') { if (isInsert) setPath(doc, k, clone(v)); }
      else throw new Error('Database: update operator not supported: ' + op);
    }
  }
}
function project(doc, p) {
  if (!p) return clone(doc);
  const keys = Object.keys(p);
  if (keys.some(k => p[k] === 0)) { const o = clone(doc); keys.forEach(k => { if (p[k] === 0) delete o[k]; }); return o; }
  const o = {};
  if (p._id !== 0 && doc._id !== undefined) o._id = doc._id;
  keys.forEach(k => { if (k !== '_id' && p[k]) o[k] = clone(doc[k]); });
  return o;
}

class Cursor {
  constructor(docs, opts) { this.docs = docs; this.proj = opts && opts.projection; this._sort = null; this._limit = 0; }
  sort(s) { this._sort = s; return this; }
  limit(n) { this._limit = n; return this; }
  async toArray() {
    let d = this.docs.slice();
    if (this._sort) {
      const ks = Object.entries(this._sort);
      d.sort((a, b) => { for (const [k, dir] of ks) { const x = getPath(a, k), y = getPath(b, k); if (x < y) return -dir; if (x > y) return dir; } return 0; });
    }
    if (this._limit) d = d.slice(0, this._limit);
    return d.map(x => project(x, this.proj));
  }
}

class Collection {
  constructor(name) { this.name = name; this.uniques = []; }
  get docs() { return store[this.name]; }
  set docs(v) { store[this.name] = v; }
  _checkUnique(doc) {
    for (const keys of this.uniques) {
      if (keys.some(k => getPath(doc, k) === undefined)) continue;
      if (this.docs.some(d => d !== doc && keys.every(k => eq(getPath(d, k), getPath(doc, k)))))
        throw Object.assign(new Error('Duplicate value'), { code: 11000 });
    }
  }
  async createIndex(spec, opts) { if (opts && opts.unique) this.uniques.push(Object.keys(spec)); }
  async insertOne(doc) {
    const d = clone(doc); if (d._id === undefined) d._id = crypto.randomBytes(12).toString('hex');
    this._checkUnique(d); this.docs.push(d); touch(); return { insertedId: d._id };
  }
  async findOne(f, opts) { const d = this.docs.find(x => matches(x, f)); return d ? project(d, opts && opts.projection) : null; }
  find(f, opts) { return new Cursor(this.docs.filter(x => matches(x, f)), opts); }
  async countDocuments(f) { return this.docs.filter(x => matches(x, f)).length; }
  _upsert(f, upd) {
    const d = {};
    for (const [k, v] of Object.entries(f || {})) if (!k.startsWith('$') && !isOp(v)) setPath(d, k, clone(v));
    applyUpdate(d, upd, true);
    if (d._id === undefined) d._id = crypto.randomBytes(12).toString('hex');
    this._checkUnique(d); this.docs.push(d); return d;
  }
  async updateOne(f, upd, opts) {
    const d = this.docs.find(x => matches(x, f));
    if (d) { applyUpdate(d, upd, false); touch(); return { matchedCount: 1, upsertedCount: 0 }; }
    if (opts && opts.upsert) { this._upsert(f, upd); touch(); return { matchedCount: 0, upsertedCount: 1 }; }
    return { matchedCount: 0, upsertedCount: 0 };
  }
  async updateMany(f, upd) { const l = this.docs.filter(x => matches(x, f)); l.forEach(d => applyUpdate(d, upd, false)); if (l.length) touch(); return { matchedCount: l.length }; }
  async findOneAndUpdate(f, upd, opts) {
    let d = this.docs.find(x => matches(x, f)); const before = d ? clone(d) : null;
    if (d) applyUpdate(d, upd, false);
    else if (opts && opts.upsert) d = this._upsert(f, upd);
    else return null;
    touch();
    return opts && opts.returnDocument === 'after' ? clone(d) : before;
  }
  async deleteOne(f) { const i = this.docs.findIndex(x => matches(x, f)); if (i >= 0) { this.docs.splice(i, 1); touch(); } return { deletedCount: i >= 0 ? 1 : 0 }; }
  async deleteMany(f) { const n = this.docs.length; this.docs = this.docs.filter(x => !matches(x, f)); if (this.docs.length !== n) touch(); return { deletedCount: n - this.docs.length }; }
}

/* ----------------------------------------------------- uploaded files */
const safeId = id => { const s = String(id); if (!/^[a-f0-9]{24}$/.test(s)) throw new Error('Bad file id'); return path.join(UPLOAD_DIR, s); };
const bucket = {
  openUploadStream(filename) {
    const id = new ObjectId(), chunks = [];
    const w = new Writable({
      write(c, e, cb) { chunks.push(Buffer.from(c)); cb(); },
      final(cb) { fs.writeFile(safeId(id.hex), Buffer.concat(chunks), cb); }
    });
    w.id = id; return w;
  },
  openDownloadStream(id) { return fs.createReadStream(safeId(id)); },
  async delete(id) { await fs.promises.unlink(safeId(id)); }
};

/* ------------------------------------------------------------- start */
async function connect() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  try { store = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) {
    store = {};
    if (e.code !== 'ENOENT') {                                // the file exists but is damaged: keep a copy, start clean
      const copy = path.join(DATA_DIR, 'db.damaged-' + Date.now() + '.json');
      try { fs.copyFileSync(DB_FILE, copy); console.warn('db.json was damaged. A copy was saved as ' + copy); } catch {}
    }
  }
  for (const n of NAMES) { if (!Array.isArray(store[n])) store[n] = []; C[n] = new Collection(n); }
  await C.users.createIndex({ id: 1 }, { unique: true });
  await C.users.createIndex({ email: 1 }, { unique: true });
  await C.sessions.createIndex({ h: 1 }, { unique: true });
  await C.connections.createIndex({ from: 1, to: 1 }, { unique: true });
  await C.requests.createIndex({ id: 1 }, { unique: true });
  await C.materials.createIndex({ id: 1 }, { unique: true });
  flush();
}

/* Next number for ids (1, 2, 3 ...) */
async function nextId() {
  const doc = await C.counters.findOneAndUpdate({ _id: 'id' }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return doc.seq;
}

process.on('exit', () => { try { flush(); } catch {} });

module.exports = { C, connect, nextId, close: async () => flush(), ObjectId, get bucket() { return bucket; } };
