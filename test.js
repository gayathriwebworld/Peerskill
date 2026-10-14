'use strict';
/* Automatic tests.  Run:  node test.js
   They start a temporary copy of the server with its own empty data folder, try every feature,
   then restart it to prove the data is really saved in the JSON file. */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(p, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + '/api' + p, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json() };
}
async function upload(token, query, buffer) {
  const qs = new URLSearchParams(query).toString();
  const res = await fetch(`${BASE}/api/materials?${qs}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/octet-stream' }, body: buffer });
  return { status: res.status, data: await res.json() };
}
const download = (token, id) => fetch(`${BASE}/api/materials/${id}/download`, { headers: token ? { Authorization: 'Bearer ' + token } : {} });

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), Buffer.alloc(2000, 7)]);
const PPTX = Buffer.concat([Buffer.from([0x50, 0x4B, 0x03, 0x04]), Buffer.alloc(3000, 1)]);

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { console.error('  FAIL', name, '\n      ', e.message); process.exitCode = 1; }
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skillswap-'));
  let server;
  const start = async (withSamples = true) => {
    server = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env: Object.assign({}, process.env, { PORT, DATA_DIR: dataDir }, withSamples ? { SEED_DEMO: '1' } : {}), stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 50 && !up; i++) { try { await fetch(BASE + '/api/health'); up = true; } catch { await sleep(100); } }
    if (!up) { console.error('Server did not start'); process.exit(1); }
  };
  const stop = () => new Promise(r => { server.on('exit', r); server.kill(); });
  await start();
  console.log('\nPeerSkill backend tests\n');

  let A, B, C3, me, bina, carl, ananya, matId, msgMatId;

  await check('12 sample profiles are loaded (seed option)', async () => { assert.equal((await api('/health')).data.users, 12); });
  await check('website page is served and folder escape is blocked', async () => {
    const res = await fetch(BASE + '/'); assert.equal(res.status, 200); assert.ok((await res.text()).includes('PeerSkill'));
    assert.ok([403, 404].includes((await fetch(BASE + '/..%2fserver.js')).status));
  });
  await check('skills search and filters work (online only, no location filter)', async () => {
    const all = (await api('/skills')).data; assert.ok(all.length >= 20);
    ananya = all.find(s => s.user.name === 'Ananya Rao').user;
    assert.ok((await api('/skills?q=python')).data.every(s => /python/i.test(s.name + s.user.name + s.cat)));
    assert.ok((await api('/skills?level=Advanced&cat=Design')).data.every(s => s.level === 'Advanced' && s.cat === 'Design'));
    assert.ok(all.every(s => !('mode' in s.user)));
  });
  await check('protected routes need login', async () => {
    for (const p of ['/me', '/dashboard', '/materials', '/threads', '/contacts']) assert.equal((await api(p)).status, 401);
  });
  await check('signup validates input', async () => {
    assert.equal((await api('/signup', { method: 'POST', body: { name: 'A' } })).status, 400);
    assert.equal((await api('/signup', { method: 'POST', body: { name: 'Arjun Kumar', email: 'arjun@college.edu', password: '123', teach: 'Python', learn: 'Graphic Design' } })).status, 400);
  });
  await check('signup works; password is never returned', async () => {
    const r = await api('/signup', { method: 'POST', body: { name: 'Arjun Kumar', email: 'arjun@college.edu', password: 'secret123', loc: 'Vijayawada', teach: 'Python', learn: 'Graphic Design, Photography' } });
    assert.equal(r.status, 200); A = r.data.token; me = r.data.user;
    assert.ok(A && !('hash' in me) && !('salt' in me) && me.teach[0].cat === 'Programming' && !('mode' in me));
  });
  await check('duplicate email is rejected', async () => {
    assert.equal((await api('/signup', { method: 'POST', body: { name: 'Arjun Two', email: 'ARJUN@college.edu', password: 'secret123', teach: 'x1', learn: 'y1' } })).status, 409);
  });
  await check('wrong password fails, right password works, sample profiles cannot log in', async () => {
    assert.equal((await api('/login', { method: 'POST', body: { email: 'arjun@college.edu', password: 'nope' } })).status, 401);
    assert.equal((await api('/login', { method: 'POST', body: { email: 'arjun@college.edu', password: 'secret123' } })).status, 200);
    assert.equal((await api('/login', { method: 'POST', body: { email: 'sample3@skillswap.local', password: 'anything' } })).status, 401);
  });
  await check('perfect skill match is found (Ananya)', async () => {
    const m = (await api('/matches', { token: A })).data.find(x => x.user.name === 'Ananya Rao');
    assert.ok(m && m.match.perfect && m.match.teachToThem === 'Python' && m.match.learnFromThem === 'Graphic Design');
  });
  await check('NO automatic messages, replies or welcome notes after signup', async () => {
    assert.equal((await api('/threads', { token: A })).data.length, 0);
    assert.equal((await api('/counts', { token: A })).data.messages, 0);
    const n = (await api('/notifications', { token: A })).data; assert.ok(n.every(x => /Perfect Skill Match/.test(x.text)));
  });
  await check('sample profiles are view-only (no connect, request, message, share)', async () => {
    for (const [p, body] of [['/connect/' + ananya.id, undefined], ['/requests', { to: ananya.id, give: 'Python', get: 'Graphic Design' }], ['/messages/' + ananya.id, { text: 'hi' }]]) {
      const r = await api(p, { method: 'POST', token: A, body }); assert.equal(r.status, 400); assert.ok(/sample profile/i.test(r.data.error));
    }
    assert.equal((await upload(A, { filename: 'a.pdf', to: ananya.id }, PDF)).status, 400);
    assert.equal((await api('/users/' + ananya.id, { token: A })).data.demo, true);
  });

  await check('two real members: signup', async () => {
    const b = (await api('/signup', { method: 'POST', body: { name: 'Bina Das', email: 'bina@college.edu', password: 'secret123', teach: 'Graphic Design', learn: 'Python' } })).data;
    B = b.token; bina = b.user;
    const c = (await api('/signup', { method: 'POST', body: { name: 'Carl Joseph', email: 'carl@college.edu', password: 'secret123', teach: 'Guitar', learn: 'Excel' } })).data;
    C3 = c.token; carl = c.user;
    assert.ok(bina.id !== me.id && carl.id !== bina.id);
  });
  await check('request stays pending (nobody accepts for you), then Bina accepts', async () => {
    assert.equal((await api('/requests', { method: 'POST', token: A, body: { to: bina.id, give: 'Python', get: 'Graphic Design', when: 'Weekend mornings' } })).status, 200);
    assert.equal((await api('/requests', { method: 'POST', token: A, body: { to: bina.id, give: 'Python', get: 'Graphic Design' } })).status, 409);
    await sleep(1500);
    const rec = (await api('/dashboard', { token: B })).data.received; assert.equal(rec.length, 1); assert.equal(rec[0].status, 'pending');
    assert.equal((await api('/dashboard', { token: A })).data.sent[0].status, 'pending');
    assert.equal((await api('/requests/' + rec[0].id, { method: 'PATCH', token: A, body: { status: 'accepted' } })).status, 404);
    assert.equal((await api('/requests/' + rec[0].id, { method: 'PATCH', token: B, body: { status: 'accepted' } })).data.status, 'accepted');
    assert.equal((await api('/requests/' + rec[0].id, { method: 'PATCH', token: B, body: { status: 'declined' } })).status, 409);
  });
  await check('review is allowed after an accepted swap and updates the rating', async () => {
    assert.equal((await api('/users/' + bina.id, { token: A })).data.canReview, true);
    assert.equal((await api(`/users/${bina.id}/reviews`, { method: 'POST', token: A, body: { rating: 9, text: 'ok' } })).status, 400);
    const r = await api(`/users/${bina.id}/reviews`, { method: 'POST', token: A, body: { rating: 4, text: 'Very helpful sessions.' } });
    assert.equal(r.status, 200); assert.equal(r.data.rating, 4); assert.equal(r.data.reviews[0].by, 'Arjun Kumar');
    assert.equal((await api(`/users/${bina.id}/reviews`, { method: 'POST', token: A, body: { rating: 5, text: 'again' } })).status, 409);
    assert.equal((await api(`/users/${me.id}/reviews`, { method: 'POST', token: C3, body: { rating: 5, text: 'never swapped' } })).status, 403);
  });
  await check('chat between real members only: no automatic reply', async () => {
    assert.equal((await api('/messages/' + bina.id, { method: 'POST', token: A, body: { text: 'Hello Bina' } })).status, 200);
    assert.equal((await api('/messages/' + bina.id, { method: 'POST', token: A, body: { text: '   ' } })).status, 400);
    assert.equal((await api('/counts', { token: B })).data.messages, 1);
    await sleep(2200);                                                    // nobody should answer for Bina
    const t = (await api('/threads', { token: A })).data; assert.equal(t.length, 1); assert.equal(t[0].last.from, 'me');
    const bt = (await api('/threads', { token: B })).data; assert.equal(bt[0].unread, 1);
    const conv = (await api('/messages/' + me.id, { token: B })).data; assert.equal(conv.messages.length, 1);
    assert.equal((await api('/counts', { token: B })).data.messages, 0);
    assert.equal((await api('/messages/' + bina.id, { token: A })).data.messages.length, 1);
  });

  await check('materials: only real PDF/PPT/Word/Excel/text files are accepted', async () => {
    assert.equal((await upload(A, { filename: 'virus.exe' }, PDF)).status, 400);
    assert.equal((await upload(A, { filename: 'fake.pdf' }, Buffer.from('this is not a pdf at all'))).status, 400);
    assert.equal((await upload(A, { filename: 'fake.pptx' }, PDF)).status, 400);
    assert.equal((await upload(A, { filename: 'big.pdf' }, Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(11 * 1024 * 1024)]))).status, 413);
    assert.equal((await upload(A, { filename: 'x.pdf', to: me.id }, PDF)).status, 400);
    const res = await fetch(`${BASE}/api/materials?filename=a.pdf`, { method: 'POST', body: PDF }); assert.equal(res.status, 401);
  });
  await check('materials: upload a PDF straight to a person in chat', async () => {
    const r = await upload(A, { filename: 'Python Notes.pdf', title: 'Python basics', skill: 'Python', to: bina.id, chat: '1' }, PDF);
    assert.equal(r.status, 200); matId = r.data.material.id;
    assert.equal(r.data.material.size, PDF.length); assert.equal(r.data.material.visibility, 'private');
    assert.equal(r.data.message.material.id, matId);
    const conv = (await api('/messages/' + me.id, { token: B })).data;
    const m = conv.messages.find(x => x.material); assert.equal(m.material.filename, 'Python Notes.pdf');
    assert.ok((await api('/notifications', { token: B })).data.some(n => /shared "Python basics"/.test(n.text)));
  });
  await check('materials: recipient downloads the exact file; strangers cannot', async () => {
    const res = await download(B, matId);
    assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.ok(/attachment/.test(res.headers.get('content-disposition')) && /Python Notes\.pdf/.test(res.headers.get('content-disposition')));
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(PDF));
    assert.equal((await download(C3, matId)).status, 404);
    assert.equal((await download(null, matId)).status, 401);
    assert.equal((await download(A, matId)).status, 200);
    const shared = (await api('/materials', { token: B })).data.shared; assert.equal(shared.length, 1); assert.equal(shared[0].downloads, 1);
  });
  await check('materials: upload privately, make public, share with one more person', async () => {
    const r = await upload(A, { filename: 'Slides.pptx', title: 'Intro slides', skill: 'Python', visibility: 'private' }, PPTX);
    assert.equal(r.status, 200); msgMatId = r.data.material.id;
    assert.equal((await download(C3, msgMatId)).status, 404);
    assert.equal((await api('/users/' + me.id + '/materials')).data.length, 0);
    assert.equal((await api('/materials/' + msgMatId, { method: 'PATCH', token: C3, body: { visibility: 'public' } })).status, 404);
    assert.equal((await api('/materials/' + msgMatId, { method: 'PATCH', token: A, body: { visibility: 'public' } })).data.visibility, 'public');
    assert.equal((await download(C3, msgMatId)).status, 200);
    assert.equal((await api('/users/' + me.id + '/materials')).data.length, 1);
    assert.equal((await api(`/materials/${matId}/share`, { method: 'POST', token: A, body: { userId: carl.id } })).data.sharedWith.length, 2);
    assert.equal((await download(C3, matId)).status, 200);
    assert.equal((await api(`/materials/${matId}/share`, { method: 'POST', token: B, body: { userId: carl.id } })).status, 404);
    assert.equal((await api(`/materials/${matId}/share`, { method: 'POST', token: A, body: { userId: ananya.id } })).status, 400);
  });
  await check('materials: contacts list and my/shared lists', async () => {
    const contacts = (await api('/contacts', { token: A })).data.map(u => u.name); assert.ok(contacts.includes('Bina Das') && !contacts.includes('Ananya Rao'));
    const l = (await api('/materials', { token: A })).data; assert.equal(l.mine.length, 2); assert.equal(l.shared.length, 0);
    assert.ok(l.mine.find(m => m.id === matId).sharedWith.some(u => u.name === 'Bina Das'));
    assert.ok(!('sharedWith' in (await api('/materials', { token: B })).data.shared[0]));
  });
  await check('materials: deleting removes the file everywhere', async () => {
    assert.equal((await api('/materials/' + matId, { method: 'DELETE', token: B })).status, 404);
    assert.equal((await api('/materials/' + matId, { method: 'DELETE', token: A })).status, 200);
    assert.equal((await download(B, matId)).status, 404);
    const m = (await api('/messages/' + me.id, { token: B })).data.messages.find(x => x.material);
    assert.equal(m.material.removed, true);
  });

  await check('profile can be edited, skills added and removed', async () => {
    const r = await api('/me', { method: 'PUT', token: A, body: { bio: 'Hello <b>world</b>', exp: 'Advanced', mode: 'offline', teach: [{ name: 'Python', cat: 'Programming', level: 'Advanced' }, { name: 'Excel' }] } });
    assert.equal(r.status, 200); assert.equal(r.data.teach.length, 2); assert.equal(r.data.teach[1].cat, 'Career Skills'); assert.ok(!('mode' in r.data));
    assert.equal((await api('/me', { method: 'PUT', token: A, body: { exp: 'Guru' } })).status, 400);
  });
  await check('notifications can be read', async () => {
    assert.ok((await api('/counts', { token: B })).data.notifs >= 2);
    await api('/notifications/read', { method: 'POST', token: B });
    assert.equal((await api('/counts', { token: B })).data.notifs, 0);
  });
  await check('contact form saves a message', async () => {
    assert.equal((await api('/contact', { method: 'POST', body: { name: 'Visitor', email: 'bad', message: 'hello there' } })).status, 400);
    assert.equal((await api('/contact', { method: 'POST', body: { name: 'Visitor', email: 'v@x.com', message: 'hello there' } })).status, 200);
  });
  await check('logout ends the session', async () => {
    await api('/logout', { method: 'POST', token: A });
    assert.equal((await api('/me', { token: A })).status, 401);
  });

  await check('data is saved in db.json and survives a restart (accounts, logins, files)', async () => {
    await sleep(400); await stop(); await start();
    assert.ok((await api('/health')).data.users >= 15);
    assert.equal((await api('/login', { method: 'POST', body: { email: 'bina@college.edu', password: 'secret123' } })).status, 200);
    assert.equal((await api('/me', { token: B })).status, 200);
    const res = await download(C3, msgMatId); assert.equal(res.status, 200);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(PPTX));
    assert.equal((await api('/users/' + bina.id, { token: C3 })).data.rating, 4);
    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
    assert.ok(db.users.length >= 15 && db.users.find(u => u.email === 'arjun@college.edu').hash);
    assert.ok(!JSON.stringify(db).includes('secret123'));
  });

  await check('normal start shows only real members (sample profiles are removed)', async () => {
    await stop(); await start(false);
    assert.equal((await api('/health')).data.users, 3);                          // Arjun, Bina, Carl
    const names = (await api('/users?limit=50')).data.map(u => u.name).sort();
    assert.deepEqual(names, ['Arjun Kumar', 'Bina Das', 'Carl Joseph']);
    assert.ok((await api('/skills')).data.every(s => !s.user.demo));
    const login = await api('/login', { method: 'POST', body: { email: 'carl@college.edu', password: 'secret123' } });
    assert.equal(login.status, 200);
  });
  await check('two real friends find each other, connect, get notified and chat', async () => {
    const d = (await api('/signup', { method: 'POST', body: { name: 'Dev Patel', email: 'dev@college.edu', password: 'secret123', teach: 'Chess', learn: 'Python' } })).data;
    const login = (await api('/login', { method: 'POST', body: { email: 'bina@college.edu', password: 'secret123' } })).data;
    const members = (await api('/users?limit=50')).data; const dev = members.find(u => u.name === 'Dev Patel');
    assert.ok(dev && members.length === 4);
    assert.equal((await api('/connect/' + dev.id, { method: 'POST', token: login.token })).data.connected, true);
    assert.ok((await api('/notifications', { token: d.token })).data.some(n => /Bina Das connected with you/.test(n.text)));
    assert.equal((await api('/messages/' + dev.id, { method: 'POST', token: login.token, body: { text: 'Hi Dev, it is Bina' } })).status, 200);
    assert.equal((await api('/counts', { token: d.token })).data.messages, 1);
    assert.equal((await api('/messages/' + login.user.id, { token: d.token })).data.messages[0].text, 'Hi Dev, it is Bina');
  });

  await stop();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
  console.log(`\n${passed} checks passed${process.exitCode ? ', some failed' : ''}.\n`);
})();
