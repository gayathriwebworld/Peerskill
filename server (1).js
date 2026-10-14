'use strict';
/* =====================================================================
   PeerSkill backend  (Node.js, no extra packages)
   - Serves the website from the /public folder and the API under /api
   - Data is saved in data/db.json  (a JSON file you can open and read)
   - Uploaded files (PDF, PPT, images ...) are saved in data/uploads/
   - Sessions are online only. Nothing replies automatically: only real members talk.
   Run:  node server.js     then open  http://localhost:3000
   ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const config = require('./config');
const mdb = require('./db');

const C = mdb.C;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_FILE = config.MAX_FILE_MB * 1024 * 1024;

const CATS = ['Programming', 'Web Development', 'Design', 'Photography', 'Music', 'Languages',
  'Digital Marketing', 'Video Editing', 'Academics', 'Career Skills', 'Personal Development'];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const COLORS = ['#0F9D8A', '#6C4DF6', '#FF6B5B', '#2F80ED', '#D14D8B', '#E09F1F', '#16A085', '#8E44AD'];

/* Allowed study-material types: extension -> [download type, how to check the file really is that type] */
const OLE = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
const ZIP = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
const FILE_TYPES = {
  pdf:  ['application/pdf', b => b.subarray(0, 4).toString('latin1') === '%PDF'],
  ppt:  ['application/vnd.ms-powerpoint', b => b.subarray(0, 8).equals(OLE)],
  pps:  ['application/vnd.ms-powerpoint', b => b.subarray(0, 8).equals(OLE)],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', b => b.subarray(0, 4).equals(ZIP)],
  ppsx: ['application/vnd.openxmlformats-officedocument.presentationml.slideshow', b => b.subarray(0, 4).equals(ZIP)],
  doc:  ['application/msword', b => b.subarray(0, 8).equals(OLE)],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', b => b.subarray(0, 4).equals(ZIP)],
  xls:  ['application/vnd.ms-excel', b => b.subarray(0, 8).equals(OLE)],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', b => b.subarray(0, 4).equals(ZIP)],
  txt:  ['text/plain; charset=utf-8', b => !b.subarray(0, 2048).includes(0)],
  png:  ['image/png', b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))],
  jpg:  ['image/jpeg', b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF],
  jpeg: ['image/jpeg', b => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF],
  gif:  ['image/gif', b => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1'))],
  webp: ['image/webp', b => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP']
};

/* ---------------------------------------------------------------- helpers */
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = msg => new HttpError(400, msg);
const P = { projection: { _id: 0 } };

const clean = (v, max) => typeof v === 'string'
  ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '';

function cleanList(v, maxItems, maxLen) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const seen = new Set(), out = [];
  for (const x of arr) {
    const s = clean(typeof x === 'string' ? x : '', maxLen);
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return out.slice(0, maxItems);
}

const GUESS = [
  [/python|java\b|c\+\+|\bc\b|sql|coding|program|algorithm|data|machine learning|\bai\b/, 'Programming'],
  [/html|css|javascript|react|web|node|php/, 'Web Development'],
  [/design|canva|figma|photoshop|\bui\b|\bux\b|logo|illustrat/, 'Design'],
  [/photo|camera|lightroom/, 'Photography'],
  [/guitar|piano|music|sing|drum|violin|keyboard/, 'Music'],
  [/english|hindi|spanish|french|german|telugu|tamil|language|speaking/, 'Languages'],
  [/seo|marketing|social media|ads|content/, 'Digital Marketing'],
  [/video|edit|premiere|reel|film|animation/, 'Video Editing'],
  [/math|physics|chemistry|calculus|statistic|biology|exam|science/, 'Academics'],
  [/resume|interview|public speaking|excel|communication|career|presentation/, 'Career Skills'],
  [/time|mindful|meditat|habit|confidence|productiv|study/, 'Personal Development']
];
const guessCat = name => { const n = name.toLowerCase(); const g = GUESS.find(([re]) => re.test(n)); return g ? g[1] : 'Academics'; };

function toTeach(list) {
  const seen = new Set(), out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const name = clean(typeof x === 'string' ? x : x && x.name, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({
      name,
      cat: x && CATS.includes(x.cat) ? x.cat : guessCat(name),
      level: x && LEVELS.includes(x.level) ? x.level : 'Beginner',
      base: 0
    });
  }
  return out.slice(0, 20);
}

const same = (a, b) => {
  a = String(a).toLowerCase().trim(); b = String(b).toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 3 && l.includes(s);
};

const SAMPLE_MSG = 'This is a sample profile for demonstration, so it cannot reply. Message a real member instead.';

/* ------------------------------------------------------------------- auth */
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPassword(pw, u) {
  if (!u.hash || !u.salt) return false;
  const a = crypto.scryptSync(pw, u.salt, 64), b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function newSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await C.sessions.deleteMany({ exp: { $lt: Date.now() } });                // remove old logins
  const mine = await C.sessions.find({ userId }, { projection: { _id: 1, exp: 1 } }).sort({ exp: 1 }).toArray();
  if (mine.length >= 5) await C.sessions.deleteOne({ _id: mine[0]._id });
  await C.sessions.insertOne({ h: sha(token), userId, exp: Date.now() + 30 * 864e5 });
  return token;
}
async function userFromReq(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const s = await C.sessions.findOne({ h: sha(h.slice(7).trim()), exp: { $gt: Date.now() } });
  return s ? C.users.findOne({ id: s.userId }, P) : null;
}

const hits = new Map();
/* Real visitor address. Behind a host such as Render or a Cloudflare link, every request arrives from the
   host's own address, so use the forwarded address when it is present. */
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '';
}
function limit(req, key, max, windowMs) {
  const k = key + clientIp(req);
  const now = Date.now();
  let h = hits.get(k);
  if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; hits.set(k, h); }
  if (++h.n > max) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 6e5).unref();

/* ------------------------------------------------------------------ data helpers */
const nextId = () => mdb.nextId();
const findUser = id => C.users.findOne({ id: Number(id) }, P);
async function usersMap(ids) {
  ids = [...new Set(ids.filter(x => x != null))];
  const list = ids.length ? await C.users.find({ id: { $in: ids } }, P).toArray() : [];
  return new Map(list.map(u => [u.id, u]));
}
const acceptedList = () => C.requests.find({ status: 'accepted' }, { projection: { _id: 0, from: 1, to: 1, get: 1 } }).toArray();
const acceptedBetween = (a, b) => C.requests.countDocuments({ status: 'accepted', $or: [{ from: a, to: b }, { from: b, to: a }] });

const exchangesOf = (u, acc) => (u.exchanges || 0) + acc.filter(r => r.from === u.id || r.to === u.id).length;
const learnersOf = (u, t, acc) => (t.base || 0) + acc.filter(r => r.to === u.id && same(r.get, t.name)).length;

const lite = u => ({ id: u.id, name: u.name, color: u.color, loc: u.loc, rating: u.rating, demo: !!u.demo });

function pub(u, acc, withReviews = true) {
  const o = {
    id: u.id, name: u.name, color: u.color, loc: u.loc, bio: u.bio, exp: u.exp, avail: u.avail,
    rating: u.rating, ratingCount: u.ratingCount || 0, exchanges: exchangesOf(u, acc), demo: !!u.demo,
    teach: u.teach.map(t => ({ name: t.name, cat: t.cat, level: t.level, learners: learnersOf(u, t, acc) })),
    learn: u.learn
  };
  if (withReviews) o.reviews = u.reviews.slice(-10).reverse().map(r => ({ by: r.byName, rating: r.rating, text: r.text, ts: r.ts }));
  return o;
}
async function meView(u) {
  const acc = await acceptedList();
  const conns = await C.connections.find({ from: u.id }, { projection: { _id: 0, to: 1 } }).toArray();
  return Object.assign(pub(u, acc), { email: u.email, connected: conns.map(c => c.to) });
}

function matchFor(me, u) {
  const learnFromThem = u.teach.map(t => t.name).find(sk => me.learn.some(l => same(sk, l)));
  const teachToThem = me.teach.map(t => t.name).find(sk => u.learn.some(l => same(sk, l)));
  if (!learnFromThem && !teachToThem) return null;
  return { perfect: !!(learnFromThem && teachToThem), learnFromThem: learnFromThem || null, teachToThem: teachToThem || null };
}
async function matchesFor(me) {
  const [others, acc] = await Promise.all([C.users.find({ id: { $ne: me.id } }, P).toArray(), acceptedList()]);
  return others.map(u => ({ user: Object.assign(lite(u), pub(u, acc, false)), match: matchFor(me, u) }))
    .filter(x => x.match)
    .sort((a, b) => Number(b.match.perfect) - Number(a.match.perfect) || b.user.rating - a.user.rating);
}

async function notify(userId, icon, text) {
  await C.notifications.insertOne({ id: await nextId(), userId, icon, text: clean(text, 300), ts: Date.now(), read: false });
}
const unreadNotifs = id => C.notifications.countDocuments({ userId: id, read: false });
const unreadMsgs = id => C.messages.countDocuments({ to: id, read: false });

async function reqViews(list, otherKey) {
  const map = await usersMap(list.map(r => r[otherKey]));
  return list.map(r => ({ id: r.id, give: r.give, get: r.get, when: r.when, msg: r.msg, status: r.status, ts: r.ts, user: map.has(r[otherKey]) ? lite(map.get(r[otherKey])) : null }));
}

/* ----- study materials ----- */
const canAccess = (m, user) => m.ownerId === user.id || m.visibility === 'public' || (m.sharedWith || []).includes(user.id);
function materialView(m, umap, viewer) {
  const o = {
    id: m.id, title: m.title, skill: m.skill, note: m.note, filename: m.filename, ext: m.ext, size: m.size,
    visibility: m.visibility, ts: m.ts, downloads: m.downloads || 0,
    owner: umap.has(m.ownerId) ? lite(umap.get(m.ownerId)) : null
  };
  if (viewer && viewer.id === m.ownerId) o.sharedWith = (m.sharedWith || []).filter(id => umap.has(id)).map(id => lite(umap.get(id)));
  return o;
}
async function materialViews(list, viewer) {
  const ids = [];
  list.forEach(m => { ids.push(m.ownerId); (m.sharedWith || []).forEach(i => ids.push(i)); });
  const umap = await usersMap(ids);
  return list.map(m => materialView(m, umap, viewer));
}
function safeFileName(name) {
  const base = String(name || '').split(/[\\/]/).pop();
  return base.replace(/[^\p{L}\p{N} ._()\-]/gu, '_').replace(/^\.+/, '').slice(0, 100);
}
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length']);
    if (!len) return reject(new HttpError(411, 'The file size is missing. Please try again.'));
    if (len > MAX_FILE) return reject(new HttpError(413, `That file is too large. The limit is ${config.MAX_FILE_MB} MB.`));
    let size = 0, tooBig = false; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_FILE) { tooBig = true; chunks.length = 0; } else if (!tooBig) chunks.push(c); });
    req.on('end', () => tooBig ? reject(new HttpError(413, `That file is too large. The limit is ${config.MAX_FILE_MB} MB.`)) : resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function saveToGridFs(buffer, filename, ownerId) {
  return new Promise((resolve, reject) => {
    const up = mdb.bucket.openUploadStream(filename, { metadata: { ownerId } });
    up.once('error', reject);
    up.once('finish', () => resolve(String(up.id)));
    up.end(buffer);
  });
}
async function deleteFromGridFs(fileId) {
  try { await mdb.bucket.delete(new mdb.ObjectId(fileId)); } catch { /* already gone */ }
}

/* ------------------------------------------------------------ route table */
const STREAMED = Symbol('streamed');
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth: !!opts.auth, raw: !!opts.raw });
}
const A = { auth: true };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* ----- public ----- */
route('GET', '/api/health', async () => ({ ok: true, users: await C.users.countDocuments({}) }));

route('GET', '/api/categories', async () => {
  const users = await C.users.find({}, P).toArray();
  return CATS.map(id => ({ id, count: users.reduce((n, u) => n + u.teach.filter(t => t.cat === id).length, 0) }));
});

route('GET', '/api/skills', async ({ query, user }) => {
  const q = clean(query.get('q') || '', 60).toLowerCase();
  const cat = query.get('cat') || '', level = query.get('level') || '';
  const lim = Math.min(Number(query.get('limit')) || 100, 200);
  const [users, acc] = await Promise.all([C.users.find(user ? { id: { $ne: user.id } } : {}, P).toArray(), acceptedList()]);
  const out = [];
  for (const u of users) for (const t of u.teach) {
    if (cat && t.cat !== cat) continue;
    if (level && t.level !== level) continue;
    if (q && ![t.name, u.name, t.cat].some(x => x.toLowerCase().includes(q))) continue;
    out.push({ name: t.name, cat: t.cat, level: t.level, learners: learnersOf(u, t, acc), user: lite(u) });
  }
  out.sort((a, b) => b.user.rating - a.user.rating || b.learners - a.learners);
  return out.slice(0, lim);
});

route('GET', '/api/users', async ({ query }) => {
  const sort = query.get('sort') === 'rating' ? 'rating' : 'exchanges';
  const lim = Math.min(Number(query.get('limit')) || 20, 50);
  const [users, acc] = await Promise.all([C.users.find({}, P).toArray(), acceptedList()]);
  return users.map(u => pub(u, acc, false)).sort((a, b) => b[sort] - a[sort]).slice(0, lim);
});

route('GET', '/api/users/:id', async ({ params, user }) => {
  const u = await findUser(params.id);
  if (!u) throw new HttpError(404, 'That profile does not exist.');
  const o = pub(u, await acceptedList());
  if (user && user.id !== u.id) {
    o.match = matchFor(user, u);
    o.connected = !!(await C.connections.findOne({ from: user.id, to: u.id }));
    o.canReview = !u.demo && (await acceptedBetween(user.id, u.id)) > 0 && !u.reviews.some(r => r.byId === user.id);
  }
  return o;
});

route('GET', '/api/users/:id/materials', async ({ params }) => {
  const u = await findUser(params.id);
  if (!u) throw new HttpError(404, 'That profile does not exist.');
  const list = await C.materials.find({ ownerId: u.id, visibility: 'public' }, P).sort({ ts: -1 }).toArray();
  return materialViews(list, null);
});

route('POST', '/api/signup', async ({ req, body }) => {
  limit(req, 'auth', 12, 15 * 6e4);
  const name = clean(body.name, 60), email = clean(body.email, 120).toLowerCase(), pw = typeof body.password === 'string' ? body.password : '';
  const teach = toTeach(cleanList(body.teach, 15, 40)), learn = cleanList(body.learn, 15, 40);
  if (name.length < 2) throw bad('Enter your full name.');
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address, like you@college.edu.');
  if (pw.length < 6 || pw.length > 100) throw bad('Choose a password with at least 6 characters.');
  if (!teach.length || !learn.length) throw bad('Add at least one skill you can teach and one you want to learn.');
  if (await C.users.findOne({ email })) throw new HttpError(409, 'An account with this email already exists. Try logging in.');
  const { salt, hash } = hashPassword(pw);
  const id = await nextId();
  const u = {
    id, email, salt, hash, name, color: COLORS[id % COLORS.length], loc: clean(body.loc, 60) || 'Online',
    bio: 'New to PeerSkill and ready to swap skills.', exp: 'Beginner', avail: 'Flexible',
    rating: 0, ratingCount: 0, exchanges: 0, teach, learn, reviews: [], demo: false, created: Date.now()
  };
  try { await C.users.insertOne(u); }
  catch (e) { if (e && e.code === 11000) throw new HttpError(409, 'An account with this email already exists. Try logging in.'); throw e; }
  const perfect = (await matchesFor(u)).find(m => m.match.perfect);
  if (perfect) await notify(id, '🎯', `You have a Perfect Skill Match with ${perfect.user.name}.`);
  return { token: await newSession(id), user: await meView(u) };
});

route('POST', '/api/login', async ({ req, body }) => {
  limit(req, 'auth', 12, 15 * 6e4);
  const email = clean(body.email, 120).toLowerCase(), pw = typeof body.password === 'string' ? body.password : '';
  const u = await C.users.findOne({ email }, { projection: { _id: 0 } });
  if (!u || !checkPassword(pw, u)) throw new HttpError(401, 'Email or password is incorrect.');
  return { token: await newSession(u.id), user: await meView(u) };
});

route('POST', '/api/contact', async ({ req, body }) => {
  limit(req, 'contact', 5, 60 * 6e4);
  const name = clean(body.name, 60), email = clean(body.email, 120), message = clean(body.message, 1000);
  if (name.length < 2) throw bad('Enter your name.');
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address.');
  if (message.length < 5) throw bad('Write a short message.');
  await C.contacts.insertOne({ id: await nextId(), name, email, message, ts: Date.now() });
  return { ok: true };
});

/* ----- signed in: account ----- */
route('POST', '/api/logout', async ({ req }) => {
  await C.sessions.deleteOne({ h: sha((req.headers.authorization || '').slice(7).trim()) });
  return { ok: true };
}, A);

route('GET', '/api/me', ({ user }) => meView(user), A);

route('PUT', '/api/me', async ({ user, body }) => {
  const set = {};
  if ('name' in body) { const n = clean(body.name, 60); if (n.length < 2) throw bad('Enter your full name.'); set.name = n; }
  if ('loc' in body) set.loc = clean(body.loc, 60) || 'Online';
  if ('bio' in body) set.bio = clean(body.bio, 300);
  if ('avail' in body) set.avail = clean(body.avail, 80) || 'Flexible';
  if ('exp' in body) { if (!LEVELS.includes(body.exp)) throw bad('Choose a valid experience level.'); set.exp = body.exp; }
  if ('teach' in body) set.teach = toTeach(body.teach);
  if ('learn' in body) set.learn = cleanList(body.learn, 20, 40);
  if (Object.keys(set).length) await C.users.updateOne({ id: user.id }, { $set: set });
  return meView(await findUser(user.id));
}, A);

route('GET', '/api/matches', ({ user }) => matchesFor(user), A);

route('GET', '/api/dashboard', async ({ user }) => {
  const [matches, sent, received, connections, notifs] = await Promise.all([
    matchesFor(user),
    C.requests.find({ from: user.id }, P).sort({ ts: -1 }).toArray(),
    C.requests.find({ to: user.id }, P).sort({ ts: -1 }).toArray(),
    C.connections.countDocuments({ from: user.id }),
    unreadNotifs(user.id)
  ]);
  return {
    stats: { perfect: matches.filter(m => m.match.perfect).length, connections, sent: sent.length, received: received.length, notifs },
    matches, sent: await reqViews(sent, 'to'), received: await reqViews(received, 'from')
  };
}, A);

/* ----- signed in: connections and requests ----- */
route('POST', '/api/connect/:id', async ({ user, params }) => {
  const other = await findUser(params.id);
  if (!other) throw new HttpError(404, 'That person does not exist.');
  if (other.id === user.id) throw bad('You cannot connect with yourself.');
  if (other.demo) throw bad(SAMPLE_MSG);
  const r = await C.connections.updateOne({ from: user.id, to: other.id }, { $setOnInsert: { from: user.id, to: other.id, ts: Date.now() } }, { upsert: true });
  if (r.upsertedCount) await notify(other.id, '🤝', `${user.name} connected with you.`);
  return { connected: true };
}, A);

route('POST', '/api/requests', async ({ user, body }) => {
  const other = await findUser(body.to);
  if (!other) throw new HttpError(404, 'That person does not exist.');
  if (other.id === user.id) throw bad('You cannot send a request to yourself.');
  if (other.demo) throw bad(SAMPLE_MSG);
  const give = clean(body.give, 60), get = clean(body.get, 60), when = clean(body.when, 40) || 'Flexible', msg = clean(body.msg, 300);
  if (!give || !get) throw bad('Choose what you will teach and what you want to learn.');
  if (await C.requests.findOne({ from: user.id, to: other.id, status: 'pending' }))
    throw new HttpError(409, `You already have a pending request with ${other.name}.`);
  const r = { id: await nextId(), from: user.id, to: other.id, give, get, when, msg, status: 'pending', ts: Date.now() };
  await C.requests.insertOne(Object.assign({}, r));
  await C.connections.updateOne({ from: user.id, to: other.id }, { $setOnInsert: { from: user.id, to: other.id, ts: Date.now() } }, { upsert: true });
  await notify(other.id, '📨', `${user.name} wants to swap ${give} for ${get}.`);
  return { ok: true, request: (await reqViews([r], 'to'))[0] };
}, A);

route('PATCH', '/api/requests/:id', async ({ user, params, body }) => {
  const r = await C.requests.findOne({ id: Number(params.id) }, P);
  if (!r || r.to !== user.id) throw new HttpError(404, 'Request not found.');
  if (r.status !== 'pending') throw new HttpError(409, 'This request has already been answered.');
  if (!['accepted', 'declined'].includes(body.status)) throw bad('Status must be accepted or declined.');
  await C.requests.updateOne({ id: r.id }, { $set: { status: body.status } });
  r.status = body.status;
  await notify(r.from, body.status === 'accepted' ? '✅' : '❌', `${user.name} ${body.status} your request: ${r.give} for ${r.get}.`);
  return (await reqViews([r], 'from'))[0];
}, A);

route('POST', '/api/users/:id/reviews', async ({ user, params, body }) => {
  const u = await findUser(params.id);
  if (!u) throw new HttpError(404, 'That person does not exist.');
  if (u.id === user.id) throw bad('You cannot review yourself.');
  if (u.demo) throw bad(SAMPLE_MSG);
  if (!(await acceptedBetween(user.id, u.id))) throw new HttpError(403, 'You can review someone after an accepted skill exchange.');
  if (u.reviews.some(r => r.byId === user.id)) throw new HttpError(409, 'You have already reviewed this person.');
  const rating = Number(body.rating), text = clean(body.text, 300);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad('Choose a rating from 1 to 5.');
  if (text.length < 3) throw bad('Write a short review.');
  const n = u.ratingCount || 0;
  const avg = Math.round(((u.rating * n + rating) / (n + 1)) * 10) / 10;
  await C.users.updateOne({ id: u.id }, {
    $push: { reviews: { byId: user.id, byName: user.name, rating, text, ts: Date.now() } },
    $set: { rating: avg, ratingCount: n + 1 }
  });
  await notify(u.id, '⭐', `${user.name} left you a ${rating}-star review.`);
  return pub(await findUser(u.id), await acceptedList());
}, A);

/* ----- signed in: messages ----- */
async function messageViews(list, viewer) {
  const mids = [...new Set(list.filter(m => m.materialId).map(m => m.materialId))];
  const mats = mids.length ? await C.materials.find({ id: { $in: mids } }, P).toArray() : [];
  const map = new Map(mats.map(m => [m.id, m]));
  return list.map(m => {
    const o = { id: m.id, from: m.from === viewer.id ? 'me' : 'them', text: m.text, ts: m.ts };
    if (m.materialId) {
      const mat = map.get(m.materialId);
      o.material = mat && canAccess(mat, viewer) ? { id: mat.id, title: mat.title, filename: mat.filename, ext: mat.ext, size: mat.size } : { removed: true };
    }
    return o;
  });
}

route('GET', '/api/threads', async ({ user }) => {
  const mine = await C.messages.find({ $or: [{ from: user.id }, { to: user.id }] }, P).toArray();
  const map = new Map();
  for (const m of mine) {
    const otherId = m.from === user.id ? m.to : m.from;
    const t = map.get(otherId) || { unread: 0, last: null };
    if (m.to === user.id && !m.read) t.unread++;
    if (!t.last || m.ts >= t.last.ts) t.last = m;
    map.set(otherId, t);
  }
  const umap = await usersMap([...map.keys()]);
  return [...map.entries()].filter(([id]) => umap.has(id)).map(([id, t]) => ({
    user: lite(umap.get(id)), unread: t.unread,
    last: { text: t.last.text, from: t.last.from === user.id ? 'me' : 'them', ts: t.last.ts }
  })).sort((a, b) => b.last.ts - a.last.ts);
}, A);

route('GET', '/api/messages/:id', async ({ user, params }) => {
  const other = await findUser(params.id);
  if (!other || other.id === user.id) throw new HttpError(404, 'Conversation not found.');
  await C.messages.updateMany({ from: other.id, to: user.id, read: false }, { $set: { read: true } });
  const list = await C.messages.find({ $or: [{ from: user.id, to: other.id }, { from: other.id, to: user.id }] }, P).sort({ ts: 1 }).toArray();
  return { user: lite(other), messages: await messageViews(list.slice(-200), user) };
}, A);

route('POST', '/api/messages/:id', async ({ user, params, body }) => {
  const other = await findUser(params.id);
  if (!other || other.id === user.id) throw new HttpError(404, 'Conversation not found.');
  if (other.demo) throw bad(SAMPLE_MSG);
  const text = clean(body.text, 1000);
  if (!text) throw bad('Type a message first.');
  const m = { id: await nextId(), from: user.id, to: other.id, text, ts: Date.now(), read: false };
  await C.messages.insertOne(Object.assign({}, m));
  return { id: m.id, from: 'me', text: m.text, ts: m.ts };
}, A);

route('GET', '/api/counts', async ({ user }) => ({ notifs: await unreadNotifs(user.id), messages: await unreadMsgs(user.id) }), A);

/* ----- signed in: notifications ----- */
route('GET', '/api/notifications', async ({ user }) =>
  (await C.notifications.find({ userId: user.id }, P).sort({ ts: -1 }).limit(50).toArray())
    .map(n => ({ id: n.id, icon: n.icon, text: n.text, ts: n.ts, read: n.read })), A);

route('POST', '/api/notifications/read', async ({ user }) => {
  await C.notifications.updateMany({ userId: user.id, read: false }, { $set: { read: true } });
  return { ok: true };
}, A);

/* ----- signed in: study materials (PDF, PPT, DOC ...) ----- */
route('GET', '/api/contacts', async ({ user }) => {
  const mine = { $or: [{ from: user.id }, { to: user.id }] };
  const [conns, reqs, msgs] = await Promise.all([
    C.connections.find(mine, { projection: { _id: 0, from: 1, to: 1 } }).toArray(),
    C.requests.find(mine, { projection: { _id: 0, from: 1, to: 1 } }).toArray(),
    C.messages.find(mine, { projection: { _id: 0, from: 1, to: 1 } }).toArray()
  ]);
  const ids = new Set();
  [...conns, ...reqs, ...msgs].forEach(x => { ids.add(x.from); ids.add(x.to); });
  ids.delete(user.id);
  const umap = await usersMap([...ids]);
  return [...umap.values()].filter(u => !u.demo).map(lite).sort((a, b) => a.name.localeCompare(b.name));
}, A);

route('GET', '/api/materials', async ({ user }) => {
  const [mine, shared] = await Promise.all([
    C.materials.find({ ownerId: user.id }, P).sort({ ts: -1 }).toArray(),
    C.materials.find({ sharedWith: user.id, ownerId: { $ne: user.id } }, P).sort({ ts: -1 }).toArray()
  ]);
  return { mine: await materialViews(mine, user), shared: await materialViews(shared, user) };
}, A);

route('POST', '/api/materials', async ({ req, query, user }) => {
  limit(req, 'upload', 30, 60 * 6e4);
  if ((await C.materials.countDocuments({ ownerId: user.id })) >= 30) throw bad('You can keep up to 30 materials. Delete an old one first.');
  const filename = safeFileName(query.get('filename'));
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (!filename || !FILE_TYPES[ext]) throw bad('Only PDF, PowerPoint, Word, Excel, text and image files can be shared.');
  const title = clean(query.get('title') || '', 80) || filename.replace(/\.[^.]+$/, '');
  const skill = clean(query.get('skill') || '', 40), note = clean(query.get('note') || '', 200);
  const visibility = query.get('visibility') === 'public' ? 'public' : 'private';
  let to = null;
  if (query.get('to')) {
    to = await findUser(query.get('to'));
    if (!to || to.id === user.id) throw bad('Choose a valid person to share with.');
    if (to.demo) throw bad(SAMPLE_MSG);
  }
  const buffer = await readRaw(req);
  if (!buffer.length) throw bad('That file is empty.');
  if (!FILE_TYPES[ext][1](buffer)) throw bad(`That file does not look like a real .${ext} file.`);
  const fileId = await saveToGridFs(buffer, filename, user.id);
  const m = {
    id: await nextId(), ownerId: user.id, title, skill, note, filename, ext, size: buffer.length, fileId,
    visibility, sharedWith: to ? [to.id] : [], ts: Date.now(), downloads: 0
  };
  await C.materials.insertOne(Object.assign({}, m));
  let message = null;
  if (to) {
    await notify(to.id, '📎', `${user.name} shared "${title}" with you.`);
    if (query.get('chat') === '1') {
      const msg = { id: await nextId(), from: user.id, to: to.id, text: `Shared a file: ${title}`, materialId: m.id, ts: Date.now(), read: false };
      await C.messages.insertOne(Object.assign({}, msg));
      message = (await messageViews([msg], user))[0];
    }
  }
  return { material: (await materialViews([m], user))[0], message };
}, { auth: true, raw: true });

route('GET', '/api/materials/:id/download', async ({ res, user, params }) => {
  const m = await C.materials.findOne({ id: Number(params.id) }, P);
  if (!m || !canAccess(m, user)) throw new HttpError(404, 'That file is not available.');
  await new Promise((resolve, reject) => {
    const s = mdb.bucket.openDownloadStream(new mdb.ObjectId(m.fileId));
    s.once('error', () => { if (!res.headersSent) reject(new HttpError(404, 'The file could not be found.')); else res.destroy(); });
    s.once('data', first => {
      res.writeHead(200, Object.assign({}, SECURITY, {
        'Content-Type': FILE_TYPES[m.ext][0], 'Content-Length': m.size, 'Cache-Control': 'private, no-store',
        'Content-Disposition': `attachment; filename="${m.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(m.filename)}`
      }));
      res.write(first);
      s.pipe(res);
      resolve();
    });
  });
  if (m.ownerId !== user.id) C.materials.updateOne({ id: m.id }, { $inc: { downloads: 1 } }).catch(() => {});
  return STREAMED;
}, A);

route('POST', '/api/materials/:id/share', async ({ user, params, body }) => {
  const m = await C.materials.findOne({ id: Number(params.id), ownerId: user.id }, P);
  if (!m) throw new HttpError(404, 'Material not found.');
  const to = await findUser(body.userId);
  if (!to || to.id === user.id) throw bad('Choose a valid person to share with.');
  if (to.demo) throw bad(SAMPLE_MSG);
  if (!(m.sharedWith || []).includes(to.id)) {
    await C.materials.updateOne({ id: m.id }, { $addToSet: { sharedWith: to.id } });
    await notify(to.id, '📎', `${user.name} shared "${m.title}" with you.`);
  }
  return (await materialViews([await C.materials.findOne({ id: m.id }, P)], user))[0];
}, A);

route('PATCH', '/api/materials/:id', async ({ user, params, body }) => {
  const m = await C.materials.findOne({ id: Number(params.id), ownerId: user.id }, P);
  if (!m) throw new HttpError(404, 'Material not found.');
  if (!['public', 'private'].includes(body.visibility)) throw bad('Visibility must be public or private.');
  await C.materials.updateOne({ id: m.id }, { $set: { visibility: body.visibility } });
  return (await materialViews([await C.materials.findOne({ id: m.id }, P)], user))[0];
}, A);

route('DELETE', '/api/materials/:id', async ({ user, params }) => {
  const m = await C.materials.findOne({ id: Number(params.id), ownerId: user.id }, P);
  if (!m) throw new HttpError(404, 'Material not found.');
  await deleteFromGridFs(m.fileId);
  await C.materials.deleteOne({ id: m.id });
  return { ok: true };
}, A);

/* ----------------------------------------------------------- HTTP server */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8'
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'"
};

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, Object.assign({ 'Content-Length': Buffer.byteLength(body) }, SECURITY, headers));
  res.end(body);
}
const sendJson = (res, status, obj) => send(res, status, obj, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 100 * 1024) { reject(new HttpError(413, 'Request is too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const b = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(b && typeof b === 'object' && !Array.isArray(b) ? b : {}); }
      catch { reject(bad('Invalid JSON.')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', { 'Content-Type': 'text/plain' });
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'Bad request', { 'Content-Type': 'text/plain' }); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    send(res, 200, req.method === 'HEAD' ? '' : buf, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  let matched = null;
  try {
    const user = await userFromReq(req);
    const params = {};
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (m) { matched = r; r.keys.forEach((k, i) => params[k] = decodeURIComponent(m[i + 1])); break; }
    }
    if (!matched) {
      const exists = routes.some(r => r.re.test(url.pathname));
      throw new HttpError(exists ? 405 : 404, exists ? 'Method not allowed.' : 'API route not found.');
    }
    if (matched.auth && !user) throw new HttpError(401, 'Please log in first.');
    const body = !matched.raw && ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    const result = await matched.handler({ req, res, params, query: url.searchParams, body, user });
    if (result === STREAMED) return;
    sendJson(res, 200, result === undefined ? { ok: true } : result);
  } catch (e) {
    if (matched && matched.raw && !req.readableEnded) req.resume();
    if (res.headersSent) return res.destroy();
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    sendJson(res, 500, { error: 'Something went wrong on the server.' });
  }
});

/* ----------------------------------------------------------------- start */
async function removeSampleProfiles() {
  const ids = (await C.users.find({ demo: true }, { projection: { _id: 0, id: 1 } }).toArray()).map(u => u.id);
  if (!ids.length) return;
  const touches = { $or: [{ from: { $in: ids } }, { to: { $in: ids } }] };
  await C.users.deleteMany({ demo: true });
  await C.connections.deleteMany(touches);
  await C.requests.deleteMany(touches);
  await C.messages.deleteMany(touches);
  await C.notifications.deleteMany({ userId: { $in: ids } });
}

async function main() {
  try { await mdb.connect(); }
  catch (e) { console.error('\nCould not open the database folder:\n  ' + e.message + '\n'); process.exit(1); }
  // Only real members are ever shown. (Sample profiles exist only for the automatic tests.)
  if (process.env.SEED_DEMO === '1') await require('./tests/sample-profiles').seedDemo();
  else await removeSampleProfiles();
  server.on('error', e => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${config.PORT} is already in use. Close the other PeerSkill window, or set PORT=4000.` : e);
    process.exit(1);
  });
  server.listen(config.PORT, '0.0.0.0', async () => {
    console.log('\nPeerSkill is running.\n');
    console.log(`  This computer:   http://localhost:${config.PORT}`);
    for (const list of Object.values(os.networkInterfaces()))
      for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log(`  On your phone:   http://${i.address}:${config.PORT}   (same Wi-Fi)`);
    if (!(await C.users.countDocuments({}))) console.log('\n  No members yet. Create an account on the website, then send the link to your friends (see START-HERE.txt).');
    console.log('\n  Your data is saved in the "data" folder. Keep this window open. Press Ctrl+C to stop.\n');
  });
}
const shutdown = async () => { try { server.close(); await mdb.close(); } catch {} process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
main();
