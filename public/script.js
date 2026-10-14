/* ===== PeerSkill frontend (talks to the Node.js backend through /api) ===== */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const CATS = [
  { id: 'Programming', icon: '💻' }, { id: 'Web Development', icon: '🌐' }, { id: 'Design', icon: '🎨' },
  { id: 'Photography', icon: '📷' }, { id: 'Music', icon: '🎵' }, { id: 'Languages', icon: '🗣' },
  { id: 'Digital Marketing', icon: '📱' }, { id: 'Video Editing', icon: '🎥' }, { id: 'Academics', icon: '📚' },
  { id: 'Career Skills', icon: '💼' }, { id: 'Personal Development', icon: '🧠' }
];
const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
const catIcon = id => (CATS.find(c => c.id === id) || {}).icon || '⭐';
const initials = n => String(n).trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const first = n => String(n).split(' ')[0];
const avatar = (u, cls = '') => `<span class="avatar ${cls}" style="--c:${esc(u.color || '#0F9D8A')}" aria-hidden="true">${esc(initials(u.name))}</span>`;
const opts = (arr, sel) => arr.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
const loadingHtml = '<p class="loading">Loading…</p>';
const emptyBox = (title, text, extra = '') => `<div class="empty-box"><h3>${esc(title)}</h3><p class="muted">${text}</p>${extra}</div>`;

function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
  return new Date(ts).toLocaleDateString();
}

/* ---------- State ---------- */
const TOKEN_KEY = 'skillswap-token';
let token = '';
try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch {}
const setToken = t => { token = t || ''; try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

let ME = null;                               // the logged-in user (from /api/me)
let counts = { notifs: 0, messages: 0 };
let catCounts = [];
const filters = { q: '', cat: '', level: '' };
let navId = 0, exploreSeq = 0;
let activeThread = null, convUser = null, convMsgs = [], threads = [];

/* ---------- API helper ---------- */
class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const netBanner = show => { $('#net-banner').hidden = !show; };

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try { res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
  catch { netBanner(true); throw new ApiError(0, 'Cannot reach the server.'); }
  netBanner(false);
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && token && path !== '/logout') { endSession(); }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'Something went wrong. Please try again.');
  return data;
}

function endSession() {
  setToken(''); ME = null; counts = { notifs: 0, messages: 0 }; activeThread = null; updateNav();
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ---------- Navbar ---------- */
const isConnected = id => !!ME && ME.connected.includes(id);
function updateNav() {
  const on = !!ME;
  $('#auth-guest').hidden = on; $('#auth-user').hidden = !on;
  const bn = $('#badge-notif'), bm = $('#badge-msg');
  bn.hidden = !on || !counts.notifs; bn.textContent = counts.notifs;
  bm.hidden = !on || !counts.messages; bm.textContent = counts.messages;
}
async function refreshCounts() {
  if (!ME) return;
  try { counts = await api('/counts'); updateNav(); } catch {}
}

/* ---------- Shared HTML pieces ---------- */
function skillCard(s) {
  const u = s.user, on = isConnected(u.id);
  return `<article class="card skill-card">
    <div class="sc-head"><span class="chip">${catIcon(s.cat)} ${esc(s.cat)}</span><span class="mode online">Online</span></div>
    <h3>${esc(s.name)}</h3>
    <div class="teacher">${avatar(u)}<div><b>By ${esc(first(u.name))}</b><small>${esc(u.loc)}${u.demo ? ' (sample profile)' : ''}</small></div></div>
    <div class="meta"><span class="star">★ ${u.rating ? u.rating : 'New'}</span><span>${esc(s.level)}</span><span>${s.learners} learner${s.learners === 1 ? '' : 's'}</span></div>
    <div class="actions">
      <a class="btn ghost sm" href="#/profile/${u.id}">View Profile</a>
      ${u.demo ? '<span class="sample-tag">Sample</span>' : `<button class="btn ${on ? 'done' : 'primary'} sm" data-action="connect" data-id="${u.id}">${on ? 'Connected' : 'Connect'}</button>`}
    </div></article>`;
}

function matchBlock(u, m) {
  const name = esc(first(u.name));
  const text = m.perfect
    ? `You can teach <b>${esc(m.teachToThem)}</b> to ${name}, and they can teach <b>${esc(m.learnFromThem)}</b> to you.`
    : m.learnFromThem
      ? `${name} can teach you <b>${esc(m.learnFromThem)}</b>. Offer something in return.`
      : `${name} wants to learn <b>${esc(m.teachToThem)}</b>, and you can teach it.`;
  return `<div class="match-banner ${m.perfect ? '' : 'partial'}">${m.perfect ? '🎯 Perfect Skill Match!' : 'Partial match'}</div><p class="match-text">${text}</p>`;
}

function renderCategoryGrid() {
  $$('[data-inject="categories"]').forEach(el => {
    el.innerHTML = CATS.map(c => {
      const n = (catCounts.find(x => x.id === c.id) || {}).count || 0;
      return `<button class="cat" data-action="cat" data-id="${esc(c.id)}"><span class="ic" aria-hidden="true">${c.icon}</span><b>${esc(c.id)}</b><small>${n} skill${n === 1 ? '' : 's'}</small></button>`;
    }).join('');
  });
}
function fillStaticParts() {
  $$('select[data-fill="categories"]').forEach(sel => {
    sel.innerHTML = '<option value="">All categories</option>' + CATS.map(c => `<option>${esc(c.id)}</option>`).join('');
  });
  $$('[data-inject="steps"]').forEach(el => { el.innerHTML = ''; el.appendChild($('#tpl-steps').content.cloneNode(true)); });
  renderCategoryGrid();
}

/* ---------- Pages ---------- */
async function renderHome(stale) {
  const cats = await api('/categories');
  if (stale()) return;
  catCounts = cats; renderCategoryGrid();
}

function renderChips() {
  $('#ex-cats').innerHTML = [{ id: '', icon: '✨' }, ...CATS].map(c =>
    `<button type="button" class="chip ${filters.cat === c.id ? 'on' : ''}" data-action="chipcat" data-id="${esc(c.id)}">${c.icon} ${esc(c.id || 'All')}</button>`).join('');
}
async function loadSkills() {
  const my = ++exploreSeq;
  const grid = $('#explore-grid');
  $('#ex-count').textContent = 'Searching…';
  const qs = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) qs.set(k, v); });
  try {
    const list = await api('/skills?' + qs);
    if (my !== exploreSeq) return;
    $('#ex-count').textContent = `${list.length} skill${list.length === 1 ? '' : 's'} found`;
    grid.innerHTML = list.length ? list.map(skillCard).join('')
      : emptyBox('No skills match your search', 'Try a different word, or clear the filters.', '<button class="btn primary" data-action="reset">Clear filters</button>');
  } catch (e) { if (my === exploreSeq) { $('#ex-count').textContent = ''; grid.innerHTML = emptyBox('Could not load skills', esc(e.message), '<button class="btn primary" data-action="reset">Try again</button>'); } }
}
async function renderExplore() {
  $('#ex-q').value = filters.q; $('#ex-cat').value = filters.cat; $('#ex-level').value = filters.level;
  renderChips();
  await loadSkills();
}

let members = [];
function memberCard(u) {
  const on = isConnected(u.id);
  return `<article class="card skill-card"><div class="teacher">${avatar(u)}<div><b>${esc(u.name)}</b><small>${esc(u.loc)}</small></div></div>
    <div class="meta"><span class="star">${u.rating ? '★ ' + u.rating : 'New member'}</span><span>${u.teach.length} skill${u.teach.length === 1 ? '' : 's'} to teach</span></div>
    <div class="tags">${u.teach.map(t => `<span class="chip plain">${esc(t.name)}</span>`).join('')}</div>
    <div class="actions"><a class="btn ghost sm" href="#/profile/${u.id}">View Profile</a>${ME
      ? `<button class="btn ${on ? 'done' : 'primary'} sm" data-action="connect" data-id="${u.id}">${on ? 'Connected' : 'Connect'}</button>`
      : '<a class="btn primary sm" href="#/login">Log in to connect</a>'}</div></article>`;
}
function showMembers() {
  const q = $('#mem-q').value.toLowerCase().trim();
  const list = members.filter(u => !q || [u.name, u.loc, ...u.teach.map(t => t.name), ...u.learn].some(x => String(x).toLowerCase().includes(q)));
  $('#mem-count').textContent = `${list.length} member${list.length === 1 ? '' : 's'}`;
  $('#top-teachers').innerHTML = list.length ? list.map(memberCard).join('')
    : emptyBox('No members found', members.length ? 'Try another name.' : 'No one else has joined yet. Send the link to your friends so they can sign up.');
}
async function renderCommunity(stale) {
  $('#top-teachers').innerHTML = loadingHtml;
  const list = await api('/users?sort=exchanges&limit=50');
  if (stale()) return;
  members = list.filter(u => !(ME && u.id === ME.id));
  showMembers();
}

function reqItem(r, kind) {
  const u = r.user || { name: 'Unknown', color: '#999' };
  const status = r.status === 'accepted' ? '<span class="chip ok">Accepted</span>' : r.status === 'declined' ? '<span class="chip no">Declined</span>' : '<span class="chip alt">Pending</span>';
  const actions = kind === 'received' && r.status === 'pending'
    ? `<div class="req-actions"><button class="btn primary sm" data-action="reqstatus" data-id="${r.id}" data-status="accepted">Accept</button><button class="btn ghost sm" data-action="reqstatus" data-id="${r.id}" data-status="declined">Decline</button></div>`
    : r.status === 'accepted' ? `<div class="req-actions"><button class="btn ghost sm" data-action="message" data-id="${u.id}">Message</button></div>` : '';
  return `<div class="req-item"><div class="row-item"><div class="who">${avatar(u, 'sm')}<div><b>${esc(u.name)}</b></div></div>${status}</div>
    <p>${kind === 'sent' ? 'You teach' : 'They teach'} <b>${esc(r.give)}</b> and ${kind === 'sent' ? 'learn' : 'want to learn'} <b>${esc(r.get)}</b>. ${esc(r.when)}.</p>${actions}</div>`;
}

async function renderDashboard(stale) {
  $('#dash-body').innerHTML = loadingHtml;
  const d = await api('/dashboard');
  if (stale()) return;
  $('#dash-title').textContent = `Hi, ${first(ME.name)}`;
  const st = d.stats;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const invite = `<section class="card panel invite"><h2>Invite your friends</h2>${local
    ? '<p class="muted">Your friends cannot open the address <b>localhost</b>. Double-click <b>share-with-friends.bat</b> to get a link for them, then open that link yourself. This box will then show a link you can copy and send.</p>'
    : `<p class="muted">Send this link to your friends. When they sign up, find them in <a href="#/community">Community</a> and connect.</p><div class="copy-row"><input id="invite-url" readonly value="${esc(location.origin)}" aria-label="Link to share"><button class="btn primary sm" data-action="copylink">Copy</button></div>`}</section>`;
  $('#dash-body').innerHTML = `${invite}
    <div class="stats">
      <div class="card stat"><b>${st.perfect}</b><span>Perfect matches</span></div>
      <div class="card stat"><b>${st.connections}</b><span>Connections</span></div>
      <div class="card stat"><b>${st.sent}</b><span>Requests sent</span></div>
      <div class="card stat"><b>${st.received}</b><span>Requests received</span></div>
    </div>
    <div class="two-col">
      <section class="card panel"><h2>Your skill matches</h2><div class="list">
        ${d.matches.length ? d.matches.map(({ user: u, match: m }) => `<div class="match-item"><div class="row-item" style="margin-bottom:10px"><div class="who">${avatar(u)}<div><b>${esc(u.name)}</b><br><small class="muted">${esc(u.loc)}</small></div></div></div>
          ${matchBlock(u, m)}<div class="actions" style="margin-top:12px"><a class="btn ghost sm" href="#/profile/${u.id}">View Profile</a>${u.demo ? '<span class="sample-tag">Sample profile</span>' : `<button class="btn primary sm" data-action="request" data-id="${u.id}">Send Request</button>`}</div></div>`).join('')
        : '<p class="muted">No matches yet. Add more skills to your <a href="#/profile">profile</a> to see people here.</p>'}
      </div></section>
      <div class="list">
        <section class="card panel"><h2>Requests for you</h2><div class="list">
          ${d.received.length ? d.received.map(r => reqItem(r, 'received')).join('') : '<p class="muted">No requests yet. When someone asks to swap with you, it shows up here.</p>'}
        </div></section>
        <section class="card panel"><h2>Your requests</h2><div class="list">
          ${d.sent.length ? d.sent.map(r => reqItem(r, 'sent')).join('') : '<p class="muted">You have not sent any requests. <a href="#/explore">Explore skills</a> to find a teacher.</p>'}
        </div></section>
      </div>
    </div>`;
}

const skillChips = (list, own, type, alt) => list.length
  ? list.map(s => {
      const name = typeof s === 'string' ? s : s.name;
      const lvl = typeof s === 'string' ? '' : ` <small>${esc(s.level)}</small>`;
      return `<span class="chip ${alt ? 'alt' : ''}">${esc(name)}${lvl}${own ? `<button class="x" data-action="removeskill" data-type="${type}" data-name="${esc(name)}" aria-label="Remove ${esc(name)}">×</button>` : ''}</span>`;
    }).join('')
  : '<span class="muted">Nothing added yet.</span>';

async function renderProfile(arg, stale) {
  const el = $('#profile-body'); el.innerHTML = loadingHtml;
  const own = !arg;
  let u;
  if (own) { u = await api('/me'); if (stale()) return; ME = u; } else { u = await api('/users/' + arg); if (stale()) return; }
  const mats = await api('/users/' + u.id + '/materials'); if (stale()) return;
  const on = !own && u.connected;
  const revs = (u.reviews || []).map(r => `<div class="review"><b>${esc(r.by)}</b> <span class="stars" aria-label="${r.rating} out of 5">${'★'.repeat(r.rating)}</span><p style="margin:4px 0 0">${esc(r.text)}</p></div>`).join('') || '<p class="muted">No reviews yet.</p>';
  el.innerHTML = `
    <div class="card p-head">${avatar(u, 'lg')}<div class="info">
      <h1>${esc(u.name)}</h1>
      <div class="p-facts"><span>📍 ${esc(u.loc)}</span><span>${u.rating ? '★ ' + u.rating : 'New member'}</span><span>${esc(u.exp)}</span><span>Online sessions</span></div>
      <p class="bio">${esc(u.bio || 'No bio yet.')}</p>
      ${own ? '<span class="chip plain">This is how others see you</span>' : u.demo ? '<p class="sample-note">This is a sample profile for demonstration. It cannot reply, so connecting, requests and messages are turned off.</p>' : `<div class="p-actions">
        <button class="btn ${on ? 'done' : 'primary'}" data-action="connect" data-id="${u.id}">${on ? 'Connected' : 'Connect'}</button>
        <button class="btn sun" data-action="request" data-id="${u.id}">Send Skill Exchange Request</button>
        <button class="btn ghost" data-action="message" data-id="${u.id}">Message</button></div>`}
    </div></div>
    ${!own && u.match ? `<div class="card panel" style="margin-bottom:20px">${matchBlock(u, u.match)}</div>` : ''}
    <div class="two-col">
      <div class="list">
        <section class="card panel"><h2>Skills I Teach</h2><div class="tags">${skillChips(u.teach, own, 'teach')}</div>
          ${own ? `<form class="add-skill" data-add="teach"><input name="name" required maxlength="40" placeholder="Add a skill you can teach" aria-label="Skill you can teach">
            <select name="cat" aria-label="Category"><option value="">Auto category</option>${CATS.map(c => `<option>${esc(c.id)}</option>`).join('')}</select>
            <select name="level" aria-label="Level">${LEVELS.map(l => `<option>${l}</option>`).join('')}</select><button class="btn primary sm">Add</button></form>` : ''}</section>
        <section class="card panel"><h2>Skills I Want to Learn</h2><div class="tags">${skillChips(u.learn, own, 'learn', true)}</div>
          ${own ? '<form class="add-skill" data-add="learn"><input name="name" required maxlength="40" placeholder="Add a skill you want to learn" aria-label="Skill you want to learn"><button class="btn primary sm">Add</button></form>' : ''}</section>
      </div>
      <div class="list">
        <section class="card panel"><h2>Details</h2>
          ${own ? `<form class="inline-form" style="margin:0;padding:0;border:0" data-form="edit-profile">
            <label>Name<input name="name" required maxlength="60" value="${esc(u.name)}"></label>
            <label>City<input name="loc" maxlength="60" value="${esc(u.loc)}"></label>
            <div class="two"><label>Experience level<select name="exp">${opts(LEVELS, u.exp)}</select></label>
              <label>Availability<input name="avail" maxlength="80" value="${esc(u.avail)}"></label></div>
            <label>Short bio<textarea name="bio" rows="3" maxlength="300">${esc(u.bio)}</textarea></label>
            <p class="form-error" role="alert" hidden></p>
            <button class="btn primary" type="submit">Save changes</button></form>`
          : `<p><b>Experience level:</b> ${esc(u.exp)}</p><p><b>Availability:</b> ${esc(u.avail)}</p><p style="margin:0"><b>Completed skill exchanges:</b> ${u.exchanges}</p>`}
          ${own ? `<p style="margin:14px 0 0"><b>Completed skill exchanges:</b> ${u.exchanges}</p><p class="muted" style="margin:6px 0 0">Signed in as ${esc(u.email)}</p>` : ''}
        </section>
        <section class="card panel"><h2>Study materials</h2>
          ${mats.length ? `<div class="list">${mats.map(m => matItem(m, 'public')).join('')}</div>` : '<p class="muted">No public study materials yet.</p>'}
          ${own ? '<p style="margin:14px 0 0"><a class="btn ghost sm" href="#/materials">Manage my materials</a></p>' : ''}</section>
        <section class="card panel"><h2>Rating and reviews</h2>
          ${own && !u.reviews.length ? '<p class="muted">Reviews will appear after your first exchange.</p>' : `<p><b>${u.rating ? '★ ' + u.rating : 'No rating yet'}</b> <span class="muted">${u.ratingCount ? 'from ' + u.ratingCount + ' rating' + (u.ratingCount === 1 ? '' : 's') : ''}</span></p>${revs}`}
          ${!own && u.canReview ? `<form class="inline-form" data-form="review" data-id="${u.id}"><b>Leave a review</b>
            <label>Rating<select name="rating"><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select></label>
            <label>Your review<textarea name="text" rows="3" maxlength="300" required></textarea></label>
            <p class="form-error" role="alert" hidden></p><button class="btn primary" type="submit">Post review</button></form>` : ''}
        </section>
      </div>
    </div>`;
}

/* ----- Messages ----- */
function renderThreads() {
  let list = threads.slice();
  if (activeThread && convUser && !list.some(t => t.user.id === activeThread)) list.unshift({ user: convUser, unread: 0, last: { text: 'Say hello', from: 'me', ts: Date.now() } });
  $('#threads').innerHTML = list.length ? list.map(t => `<button class="thread ${t.user.id === activeThread ? 'on' : ''}" data-action="thread" data-id="${t.user.id}">${avatar(t.user)}<span class="t"><b>${esc(t.user.name)}</b><small>${esc((t.last.from === 'me' ? 'You: ' : '') + t.last.text)}</small></span>${t.unread ? `<span class="badge">${t.unread}</span>` : ''}</button>`).join('')
    : '<p class="muted" style="padding:20px">No conversations yet. Message someone from their profile.</p>';
}
function renderMsgs(forceBottom) {
  const box = $('#msgs'); if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = convMsgs.length ? convMsgs.map(m => `<div class="bubble ${m.from === 'me' ? 'me' : ''}">${m.material ? attachHtml(m) : esc(m.text)}</div>`).join('') : '<p class="muted">No messages yet. Say hello!</p>';
  if (forceBottom || nearBottom) box.scrollTop = box.scrollHeight;
}
function renderConv() {
  const chat = $('#chat'), conv = $('#conv');
  if (!activeThread || !convUser) { chat.classList.remove('show-conv'); conv.innerHTML = '<div class="conv-empty">Pick a conversation to start chatting.</div>'; return; }
  chat.classList.add('show-conv');
  conv.innerHTML = `<div class="conv-head"><button class="back" data-action="back" aria-label="Back to conversations">←</button>${avatar(convUser)}<div><a href="#/profile/${convUser.id}"><b>${esc(convUser.name)}</b></a><br><small class="muted">Online sessions</small></div></div>
    <div class="msgs" id="msgs"></div>
    <form class="composer" data-form="composer"><button type="button" class="attach-btn" data-action="attach" aria-label="Send a PDF or slides" title="Send a PDF or slides">📎</button><input type="file" id="chat-file" hidden accept="${FILE_ACCEPT}"><input name="t" placeholder="Type a message" aria-label="Type a message" autocomplete="off" maxlength="1000"><button class="btn primary">Send</button></form>`;
  renderMsgs(true);
}
async function loadThreads() { try { threads = await api('/threads'); renderThreads(); } catch {} }
async function openThread(id) {
  id = Number(id);
  const data = await api('/messages/' + id);
  activeThread = id; convUser = data.user; convMsgs = data.messages;
  renderConv(); await loadThreads(); refreshCounts();
}
async function renderMessages(arg, stale) {
  $('#threads').innerHTML = loadingHtml;
  if (!arg) { activeThread = null; convUser = null; }
  await loadThreads(); if (stale()) return;
  if (arg) await openThread(arg); else renderConv();
}
async function pollMessages() {
  await loadThreads();
  if (!activeThread) return;
  try {
    const data = await api('/messages/' + activeThread);
    const last = convMsgs[convMsgs.length - 1];
    if (data.messages.length !== convMsgs.length || (data.messages.length && last && data.messages[data.messages.length - 1].id !== last.id)) { convMsgs = data.messages; renderMsgs(false); }
  } catch {}
}
async function sendMessage(text) {
  const m = await api('/messages/' + activeThread, { method: 'POST', body: { text } });
  convMsgs.push(m); renderMsgs(true); loadThreads();
}

/* ----- Notifications ----- */
async function renderNotifications(stale) {
  $('#notif-body').innerHTML = loadingHtml;
  const list = await api('/notifications'); if (stale()) return;
  $('#notif-body').innerHTML = list.length
    ? '<div style="text-align:right;margin-bottom:12px"><button class="btn ghost sm" data-action="readall">Mark all as read</button></div>' +
      list.map(n => `<div class="card notif ${n.read ? '' : 'unread'}"><span class="ic" aria-hidden="true">${esc(n.icon)}</span><div><p>${esc(n.text)}</p><small>${ago(n.ts)}</small></div></div>`).join('')
    : emptyBox('Nothing new yet', 'Requests and replies will show up here.');
}

/* ---------- Study materials (PDF, PowerPoint, Word ...) ---------- */
const FILE_EXTS = ['pdf', 'ppt', 'pptx', 'pps', 'ppsx', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp'];
const FILE_ACCEPT = FILE_EXTS.map(x => '.' + x).join(',');
const MAX_MB = 10;
const fileIcon = ext => ({ pdf: '📕', ppt: '📊', pptx: '📊', pps: '📊', ppsx: '📊', doc: '📝', docx: '📝', xls: '📈', xlsx: '📈', txt: '📃', png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️' }[ext] || '📄');
const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? Math.round(b / 1024) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
let myContacts = [];

function fileProblem(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!FILE_EXTS.includes(ext)) return 'Only PDF, PowerPoint, Word, Excel, text and image files can be shared.';
  if (!file.size) return 'That file is empty.';
  if (file.size > MAX_MB * 1048576) return `That file is too large. The limit is ${MAX_MB} MB.`;
  return '';
}

function uploadFile(file, params, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/materials?' + new URLSearchParams(params));
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      let d = null; try { d = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(d);
      else reject(new ApiError(xhr.status, (d && d.error) || 'Upload failed. Please try again.'));
    };
    xhr.onerror = () => { netBanner(true); reject(new ApiError(0, 'Cannot reach the server.')); };
    xhr.send(file);
  });
}

async function downloadFile(id, name) {
  let res;
  try { res = await fetch('/api/materials/' + id + '/download', { headers: token ? { Authorization: 'Bearer ' + token } : {} }); }
  catch { netBanner(true); throw new ApiError(0, 'Cannot reach the server.'); }
  if (!res.ok) { let d = null; try { d = await res.json(); } catch {} throw new ApiError(res.status, (d && d.error) || 'The download failed.'); }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = name || 'study-material'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function attachHtml(m) {
  if (m.material.removed) return '<em>This file was removed.</em>';
  const f = m.material;
  return `<div class="attach"><span class="attach-ic" aria-hidden="true">${fileIcon(f.ext)}</span><div class="attach-info"><b>${esc(f.title)}</b><small>${esc(f.filename)} (${fmtSize(f.size)})</small></div>
    <button class="btn sm ${m.from === 'me' ? 'sun' : 'primary'}" data-action="download" data-id="${f.id}" data-name="${esc(f.filename)}">Download</button></div>`;
}

function matItem(m, kind) {
  const own = kind === 'mine';
  const info = own
    ? `${m.visibility === 'public' ? 'Public on your profile' : 'Private'}${m.sharedWith && m.sharedWith.length ? ' | shared with ' + m.sharedWith.map(u => esc(first(u.name))).join(', ') : ''} | ${m.downloads} download${m.downloads === 1 ? '' : 's'}`
    : kind === 'shared' ? `From ${esc(m.owner ? m.owner.name : 'someone')} | ${ago(m.ts)}` : ago(m.ts);
  const dl = ME || kind === 'mine' ? `<button class="btn primary sm" data-action="download" data-id="${m.id}" data-name="${esc(m.filename)}">Download</button>` : '<a class="btn ghost sm" href="#/login">Log in to download</a>';
  return `<div class="mat-item"><span class="mat-ic" aria-hidden="true">${fileIcon(m.ext)}</span>
    <div class="mat-info"><b>${esc(m.title)}</b><small>${esc(m.filename)} (${fmtSize(m.size)})${m.skill ? ' | ' + esc(m.skill) : ''}</small><small>${info}</small>${m.note ? `<small>${esc(m.note)}</small>` : ''}</div>
    <div class="mat-actions">${dl}${own ? `<button class="btn ghost sm" data-action="mat-share" data-id="${m.id}">Share</button><button class="btn ghost sm" data-action="mat-vis" data-id="${m.id}" data-vis="${m.visibility}">${m.visibility === 'public' ? 'Make private' : 'Make public'}</button><button class="btn ghost sm" data-action="mat-del" data-id="${m.id}">Delete</button>` : ''}</div></div>`;
}

async function renderMaterials(stale) {
  const el = $('#materials-body'); el.innerHTML = loadingHtml;
  const [data, contacts] = await Promise.all([api('/materials'), api('/contacts')]);
  if (stale()) return;
  myContacts = contacts;
  el.innerHTML = `
    <div class="two-col">
      <section class="card panel"><h2>Share a file</h2>
        <p class="muted">PDF, PowerPoint, Word, Excel, text or images (PNG, JPG, GIF, WebP). Up to ${MAX_MB} MB.</p>
        <form class="inline-form" style="margin:0;padding:0;border:0" data-form="material">
          <label>File<input type="file" name="file" required accept="${FILE_ACCEPT}"></label>
          <label>Title<input name="title" maxlength="80" placeholder="e.g. Python basics slides"></label>
          <div class="two">
            <label>Skill (optional)<input name="skill" maxlength="40" list="my-skills" placeholder="e.g. Python"><datalist id="my-skills">${ME.teach.map(t => `<option value="${esc(t.name)}">`).join('')}</datalist></label>
            <label>Share with<select name="to"><option value="">Only me (private)</option><option value="public">Everyone (shown on my profile)</option>${contacts.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
          </div>
          <label>Note (optional)<input name="note" maxlength="200" placeholder="What is inside, or how to use it"></label>
          <progress class="upload-progress" max="100" value="0" hidden></progress>
          <p class="form-error" role="alert" hidden></p>
          <button class="btn primary" type="submit">Upload</button>
        </form>
        ${contacts.length ? '' : '<p class="muted" style="margin:12px 0 0;font-size:.9rem">To send a file to one person, connect with them or start a chat first. They will then appear in the list.</p>'}
      </section>
      <section class="card panel"><h2>Shared with me</h2>
        <div class="list">${data.shared.length ? data.shared.map(m => matItem(m, 'shared')).join('') : '<p class="muted">Nothing yet. When someone shares a file with you, it shows up here and in your notifications.</p>'}</div>
      </section>
    </div>
    <section class="card panel" style="margin-bottom:48px"><h2>My materials</h2>
      <div class="list">${data.mine.length ? data.mine.map(m => matItem(m, 'mine')).join('') : '<p class="muted">You have not uploaded anything yet.</p>'}</div>
    </section>`;
}

async function submitMaterial(f) {
  const file = f.file.files[0];
  if (!file) return formError(f, 'Choose a file first.');
  const problem = fileProblem(file); if (problem) return formError(f, problem);
  const to = f.to.value, params = { filename: file.name, title: f.title.value, skill: f.skill.value, note: f.note.value, visibility: to === 'public' ? 'public' : 'private' };
  if (to && to !== 'public') params.to = to;
  const btn = $('button[type="submit"]', f), bar = $('.upload-progress', f);
  btn.disabled = true; bar.hidden = false; bar.value = 0; formError(f, '');
  try { await uploadFile(file, params, p => { bar.value = p; }); toast('File uploaded'); route(); }
  catch (err) { formError(f, err.message); btn.disabled = false; bar.hidden = true; }
}

async function openShare(id) {
  if (!myContacts.length) { try { myContacts = await api('/contacts'); } catch {} }
  const dlg = $('#modal');
  if (!myContacts.length) return toast('Connect with someone or start a chat first, then you can share files with them.');
  dlg.innerHTML = `<form class="modal-body" id="share-form">
    <h2 id="modal-title" style="margin:0">Share this file</h2>
    <label>Share with<select name="userId">${myContacts.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-action="close">Cancel</button><button class="btn primary" type="submit">Share</button></div></form>`;
  dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', '');
  $('#share-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    try { await api(`/materials/${id}/share`, { method: 'POST', body: { userId: Number(f.userId.value) } }); closeModal(); toast('Shared'); route(); }
    catch (err) { formError(f, err.message); }
  });
}

document.addEventListener('change', async e => {
  if (e.target.id !== 'chat-file') return;
  const file = e.target.files[0]; e.target.value = '';
  if (!file || !activeThread) return;
  const problem = fileProblem(file); if (problem) return toast(problem);
  try {
    toast('Sending ' + file.name + '...');
    const r = await uploadFile(file, { filename: file.name, title: file.name.replace(/\.[^.]+$/, ''), to: String(activeThread), chat: '1' });
    convMsgs.push(r.message); renderMsgs(true); loadThreads(); toast('File sent');
  } catch (err) { toast(err.message); }
});

/* ---------- Request modal ---------- */
async function openRequest(id) {
  if (!ME) { toast('Log in to send a request'); return go('login'); }
  if (!ME.teach.length) { toast('Add a skill you can teach to your profile first'); return go('profile'); }
  let u; try { u = await api('/users/' + id); } catch (e) { return toast(e.message); }
  const mt = u.match || {};
  const dlg = $('#modal');
  dlg.innerHTML = `<form class="modal-body" id="req-form">
    <h2 id="modal-title" style="margin:0">Skill exchange with ${esc(first(u.name))}</h2>
    <label>I will teach<select name="give">${opts(ME.teach.map(t => t.name), mt.teachToThem)}</select></label>
    <label>I want to learn<select name="get">${opts(u.teach.length ? u.teach.map(t => t.name) : ['Open to suggestions'], mt.learnFromThem)}</select></label>
    <label>Preferred time<select name="when"><option>Weekday evenings</option><option>Weekend mornings</option><option>Weekend evenings</option><option>I am flexible</option></select></label>
    <label>Message<textarea name="msg" rows="3" maxlength="300" placeholder="Hi ${esc(first(u.name))}, I would love to swap skills."></textarea></label>
    <p class="muted" style="margin:0;font-size:.9rem">Sessions are held online. Agree on a meeting link in chat and share study materials there.</p>
    <p class="form-error" role="alert" hidden></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-action="close">Cancel</button><button class="btn primary" type="submit">Send request</button></div></form>`;
  dlg.showModal ? dlg.showModal() : dlg.setAttribute('open', '');
  $('#req-form').addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target, v = Object.fromEntries(new FormData(f));
    try {
      await api('/requests', { method: 'POST', body: { to: u.id, give: v.give, get: v.get, when: v.when, msg: v.msg } });
      if (!ME.connected.includes(u.id)) ME.connected.push(u.id);
      closeModal(); refreshConnectButtons(u.id); toast('Request sent!'); refreshCounts();
      if (location.hash.includes('dashboard')) route();
    } catch (err) { formError(f, err.message); }
  });
}
function closeModal() { const d = $('#modal'); d.close ? d.close() : d.removeAttribute('open'); }
function refreshConnectButtons(id) {
  $$(`[data-action="connect"][data-id="${id}"]`).forEach(b => { b.textContent = 'Connected'; b.classList.remove('primary'); b.classList.add('done'); });
}
function formError(form, msg) { const p = $('.form-error', form); if (p) { p.textContent = msg; p.hidden = !msg; } return !msg; }

/* ---------- Router ---------- */
const PAGES = ['home', 'explore', 'how-it-works', 'community', 'about', 'login', 'signup', 'dashboard', 'profile', 'materials', 'messages', 'notifications'];
const PROTECTED = ['dashboard', 'materials', 'messages', 'notifications'];
const BOXES = { explore: '#explore-grid', community: '#top-teachers', dashboard: '#dash-body', profile: '#profile-body', materials: '#materials-body', messages: '#conv', notifications: '#notif-body' };
const go = page => { const h = '#/' + page; const same = location.hash === h; location.hash = h; if (same) route(); };

async function route(soft) {
  const my = ++navId, stale = () => my !== navId;
  const raw = location.hash.replace(/^#\/?/, '') || 'home';
  const [pathPart, qs] = raw.split('?'); const [page, arg] = pathPart.split('/');
  const name = PAGES.includes(page) ? page : '404';
  if ((PROTECTED.includes(name) || (name === 'profile' && !arg)) && !ME) { toast('Please log in first'); return go('login'); }
  if ((name === 'login' || name === 'signup') && ME) return go('dashboard');
  if (name === 'explore' && qs) { const p = new URLSearchParams(qs); Object.keys(filters).forEach(k => { if (p.has(k)) filters[k] = p.get(k); }); }

  $$('.page').forEach(p => p.hidden = p.dataset.page !== name);
  $$('.menu a[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === name));
  $('#menu').classList.remove('open'); $('#burger').setAttribute('aria-expanded', 'false');
  document.title = (name === '404' ? 'Not found' : name.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())) + ' | PeerSkill';
  if (!soft) window.scrollTo(0, 0);

  try {
    if (name === 'home') await renderHome(stale);
    else if (name === 'explore') await renderExplore();
    else if (name === 'community') await renderCommunity(stale);
    else if (name === 'dashboard') await renderDashboard(stale);
    else if (name === 'profile') await renderProfile(arg, stale);
    else if (name === 'messages') await renderMessages(arg, stale);
    else if (name === 'materials') await renderMaterials(stale);
    else if (name === 'notifications') await renderNotifications(stale);
  } catch (e) {
    if (stale()) return;
    if (e.status === 404 && name === 'profile') { toast(e.message); return go('explore'); }
    if (e.status === 401) { toast('Please log in again'); return go('login'); }
    const box = $(BOXES[name]);
    if (box) box.innerHTML = emptyBox('Something went wrong', esc(e.message), '<button class="btn primary" data-action="retry">Try again</button>');
  }
}

/* ---------- Events ---------- */
document.addEventListener('click', async e => {
  const share = e.target.closest('[data-share]');
  if (share && ME) { e.preventDefault(); return go('profile'); }
  const t = e.target.closest('[data-action]'); if (!t) return;
  const a = t.dataset.action, id = t.dataset.id;
  try {
    if (a === 'cat') { Object.assign(filters, { q: '', level: '', cat: id }); go('explore'); }
    else if (a === 'chipcat') { filters.cat = id; $('#ex-cat').value = id; renderChips(); loadSkills(); }
    else if (a === 'reset') { Object.assign(filters, { q: '', cat: '', level: '' }); renderExplore(); }
    else if (a === 'retry') route();
    else if (a === 'connect') {
      if (!ME) { toast('Log in to connect'); return go('login'); }
      if (isConnected(Number(id))) return toast('You are already connected');
      await api('/connect/' + id, { method: 'POST' });
      ME.connected.push(Number(id)); refreshConnectButtons(id); toast('Connected!');
    }
    else if (a === 'request') await openRequest(id);
    else if (a === 'message') { if (!ME) { toast('Log in to send a message'); return go('login'); } go('messages/' + id); }
    else if (a === 'thread') await openThread(id);
    else if (a === 'back') { activeThread = null; convUser = null; renderThreads(); renderConv(); }
    else if (a === 'close') closeModal();
    else if (a === 'readall') { await api('/notifications/read', { method: 'POST' }); counts.notifs = 0; updateNav(); renderNotifications(() => false); }
    else if (a === 'reqstatus') { await api('/requests/' + id, { method: 'PATCH', body: { status: t.dataset.status } }); toast(t.dataset.status === 'accepted' ? 'Request accepted' : 'Request declined'); route(); }
    else if (a === 'removeskill') {
      const type = t.dataset.type, name = t.dataset.name;
      const body = type === 'teach' ? { teach: ME.teach.filter(s => s.name !== name) } : { learn: ME.learn.filter(s => s !== name) };
      ME = await api('/me', { method: 'PUT', body }); toast('Skill removed'); route();
    }
    else if (a === 'download') await downloadFile(id, t.dataset.name);
    else if (a === 'attach') { const inp = $('#chat-file'); if (inp) inp.click(); }
    else if (a === 'mat-vis') { await api('/materials/' + id, { method: 'PATCH', body: { visibility: t.dataset.vis === 'public' ? 'private' : 'public' } }); toast('Updated'); route(); }
    else if (a === 'mat-del') { if (!confirm('Delete this file for everyone?')) return; await api('/materials/' + id, { method: 'DELETE' }); toast('File deleted'); route(); }
    else if (a === 'mat-share') await openShare(id);
    else if (a === 'copylink') {
      const inp = $('#invite-url');
      try { await navigator.clipboard.writeText(inp.value); toast('Link copied'); }
      catch { inp.select(); try { document.execCommand('copy'); toast('Link copied'); } catch { toast('Press and hold the link to copy it'); } }
    }
    else if (a === 'logout') {
      try { await api('/logout', { method: 'POST' }); } catch {}
      endSession(); go('home'); toast('You are logged out');
    }
  } catch (err) { toast(err.message); }
});

document.addEventListener('submit', async e => {
  const f = e.target;
  try {
    if (f.id === 'home-search') {
      e.preventDefault();
      Object.assign(filters, { q: $('#hs-q').value, cat: $('#hs-cat').value, level: $('#hs-level').value });
      go('explore');
    } else if (f.id === 'explore-filters') e.preventDefault();
    else if (f.dataset.form === 'composer') {
      e.preventDefault(); const input = f.t, v = input.value.trim(); if (!v) return;
      input.value = ''; await sendMessage(v);
    } else if (f.dataset.add) {
      e.preventDefault(); const type = f.dataset.add, v = Object.fromEntries(new FormData(f)), name = v.name.trim(); if (!name) return;
      const body = type === 'teach'
        ? { teach: [...ME.teach.map(s => ({ name: s.name, cat: s.cat, level: s.level })), { name, cat: v.cat || undefined, level: v.level }] }
        : { learn: [...ME.learn, name] };
      ME = await api('/me', { method: 'PUT', body }); toast('Skill added'); route();
    } else if (f.dataset.form === 'edit-profile') {
      e.preventDefault(); const v = Object.fromEntries(new FormData(f));
      try { ME = await api('/me', { method: 'PUT', body: v }); updateNav(); toast('Profile saved'); route(); } catch (err) { formError(f, err.message); }
    } else if (f.dataset.form === 'review') {
      e.preventDefault(); const v = Object.fromEntries(new FormData(f));
      try { await api(`/users/${f.dataset.id}/reviews`, { method: 'POST', body: { rating: Number(v.rating), text: v.text } }); toast('Review posted'); route(); } catch (err) { formError(f, err.message); }
    } else if (f.dataset.form === 'material') {
      e.preventDefault(); await submitMaterial(f);
    } else if (f.id === 'contact-form') {
      e.preventDefault(); const v = Object.fromEntries(new FormData(f));
      try { await api('/contact', { method: 'POST', body: v }); f.reset(); formError(f, ''); toast('Message sent. Thank you!'); } catch (err) { formError(f, err.message); }
    }
  } catch (err) { toast(err.message); }
});

let debounce;
[['ex-q', 'q', 'input'], ['ex-cat', 'cat', 'change'], ['ex-level', 'level', 'change']].forEach(([id, key, ev]) => {
  $('#' + id).addEventListener(ev, e => {
    filters[key] = e.target.value; renderChips();
    clearTimeout(debounce); debounce = setTimeout(loadSkills, ev === 'input' ? 250 : 0);
  });
});
$('#ex-reset').addEventListener('click', () => { Object.assign(filters, { q: '', cat: '', level: '' }); renderExplore(); });

$('#mem-q').addEventListener('input', showMembers);

$('#burger').addEventListener('click', () => {
  const open = $('#menu').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', open);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#menu').classList.remove('open'); });

/* ----- Login and sign up ----- */
async function authenticate(path, body, form) {
  const btn = $('button[type="submit"]', form); btn.disabled = true;
  try {
    const r = await api(path, { method: 'POST', body });
    setToken(r.token); ME = r.user; form.reset(); formError(form, '');
    updateNav(); refreshCounts(); go('dashboard'); toast(`Welcome, ${first(ME.name)}!`);
  } catch (err) { formError(form, err.message); }
  finally { btn.disabled = false; }
}
$('#login-form').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, email = f.email.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) return formError(f, 'Enter a valid email address, like you@college.edu.');
  if (!f.password.value) return formError(f, 'Enter your password.');
  authenticate('/login', { email, password: f.password.value }, f);
});
$('#signup-form').addEventListener('submit', e => {
  e.preventDefault(); const f = e.target, email = f.email.value.trim();
  if (!f.name.value.trim()) return formError(f, 'Enter your full name.');
  if (!/^\S+@\S+\.\S+$/.test(email)) return formError(f, 'Enter a valid email address, like you@college.edu.');
  if (f.password.value.length < 6) return formError(f, 'Choose a password with at least 6 characters.');
  if (!f.teach.value.trim() || !f.learn.value.trim()) return formError(f, 'Add at least one skill you can teach and one you want to learn.');
  authenticate('/signup', { name: f.name.value, loc: f.loc.value, email, password: f.password.value, teach: f.teach.value, learn: f.learn.value }, f);
});

/* ---------- Start ---------- */
(async function init() {
  $('#year').textContent = new Date().getFullYear();
  fillStaticParts();
  if (token) {
    try { ME = await api('/me'); } catch (e) { if (e.status === 401) setToken(''); }
  }
  updateNav(); refreshCounts();
  window.addEventListener('hashchange', () => route());
  route();
  setInterval(async () => {
    if (!ME || document.hidden) return;
    const before = counts.notifs + ':' + counts.messages;
    await refreshCounts();
    if (location.hash.startsWith('#/messages')) pollMessages();
    else if (before !== counts.notifs + ':' + counts.messages && /^#\/(dashboard|notifications)/.test(location.hash)) route(true);
  }, 5000);
})();
})();
