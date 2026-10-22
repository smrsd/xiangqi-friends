import { initialBoard, legalMoves } from '/rules.js';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const pieces = { rr: '俥', rh: '傌', re: '相', ra: '仕', rk: '帥', rc: '炮', rp: '兵', br: '車', bh: '馬', be: '象', ba: '士', bk: '將', bc: '砲', bp: '卒' };
const reasons = { resign: '对方认输', timeout: '走棋超时', checkmate: '将死', stalemate: '困毙', capture: '擒将', agreement: '双方同意和棋', repetition: '三次重复局面', 'no-capture': '连续 120 步未吃子' };
let token = sessionStorage.getItem('xiangqi-token'), state = null, tab = 'lobby', authTab = 'login', selected = null, flipped = false, polling = false, busy = false, signature = '', serverOffset = 0, chatDraft = '', friendDraft = '', toastTimer, previousTurn;
const brand = '<div class="brand"><span class="seal">棋</span><div><strong>棋友</strong><small>XIANGQI FRIENDS</small></div></div>';
const avatar = (u, red = false) => `<span class="avatar ${red ? 'red' : ''}" aria-hidden="true">${esc([...(u?.nickname || '待')][0])}</span>`;
const empty = (text, icon = '弈') => `<div class="empty"><div class="empty-icon">${icon}</div>${text}</div>`;
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('show'); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3800); }
async function request(path, data) {
  const response = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  let result; try { result = await response.json(); } catch { throw new Error('服务器暂时无法连接，请稍后再试'); }
  if (!response.ok) { const e = new Error(result.error || '操作失败'); e.status = response.status; throw e; }
  return result;
}
function gridSvg() {
  let lines = '';
  for (let y = 0; y < 10; y++) lines += `<path d="M36 ${38 + 56 * y}H484"/>`;
  for (let x = 0; x < 9; x++) lines += x === 0 || x === 8 ? `<path d="M${36 + 56 * x} 38V542"/>` : `<path d="M${36 + 56 * x} 38V262M${36 + 56 * x} 318V542"/>`;
  return `<svg viewBox="0 0 520 580" aria-hidden="true"><g fill="none" stroke="#856237" stroke-width="1.2">${lines}<path d="M204 38L316 150M316 38L204 150M204 430L316 542M316 430L204 542"/><rect x="29" y="31" width="462" height="518" stroke-width="2"/></g><g fill="#8d683c" font-family="SimSun,serif" font-size="25" text-anchor="middle"><text x="148" y="299" letter-spacing="14">楚河</text><text x="376" y="299" letter-spacing="14">漢界</text></g></svg>`;
}
function boardHtml(g = null, decorative = false) {
  const board = g?.board || initialBoard(), c = g?.players.red === state?.user.id ? 'red' : 'black';
  const flip = g ? ((c === 'black') !== flipped) : false;
  const targets = selected && g?.turn === state?.user.id ? legalMoves(board, c, selected).map(m => m.to.join(',')) : [];
  const last = g?.history.at(-1);
  return `<div class="board" ${decorative ? 'aria-hidden="true"' : 'role="group" aria-label="中国象棋棋盘，选择棋子后选择落点"'}>${gridSvg()}${board.map((p, i) => {
    const x = i % 9, y = Math.floor(i / 9), point = [x, y].join(','), sx = flip ? 8 - x : x, sy = flip ? 9 - y : y;
    const cls = ['piece', p ? 'occupied' : '', p?.startsWith('r') ? 'red' : '', selected?.join(',') === point ? 'selected' : '', targets.includes(point) ? 'legal' : '', last && [last.from.join(','), last.to.join(',')].includes(point) ? 'last' : ''].join(' ');
    return decorative && !p ? '' : `<${decorative ? 'span' : 'button'} class="${cls}" style="left:${(36 + 56 * sx) / 5.2}%;top:${(38 + 56 * sy) / 5.8}%" ${decorative ? '' : `data-point="${point}" aria-label="${p ? (p[0] === 'r' ? '红' : '黑') + pieces[p] : '空位'} ${'abcdefghi'[x]}${9 - y}" aria-pressed="${selected?.join(',') === point}"`}>${pieces[p] || ''}</${decorative ? 'span' : 'button'}>`;
  }).join('')}</div>`;
}
function renderAuth() {
  $('#app').innerHTML = `<div class="auth-layout"><section class="auth-story">${brand}<h1>一盘棋，<br>一场<span>老友相逢。</span></h1><p>隔着山海，也能坐在同一张棋桌前。<br>约上朋友，下一局中国象棋。</p><div class="auth-foot">落子有声 · 相聚有时</div><div class="auth-art">${boardHtml(null, true)}</div></section><section class="auth-form-wrap"><div class="auth-form"><div class="eyebrow">WELCOME TO THE TABLE</div><h2>${authTab === 'login' ? '好久不见，请入座。' : '认识一下，新棋友。'}</h2><p class="intro">${authTab === 'login' ? '登录你的账号，继续与朋友的棋局。' : '创建一个账号，就可以和朋友一起下棋了。'}</p><div class="tabs"><button data-auth="login" class="${authTab === 'login' ? 'active' : ''}">登录账号</button><button data-auth="register" class="${authTab === 'register' ? 'active' : ''}">注册账号</button></div><form id="auth-form"><div class="field"><label for="username">用户名</label><input id="username" name="username" placeholder="3–24 位英文字母、数字或下划线" autocomplete="username" pattern="[A-Za-z0-9_]{3,24}" minlength="3" maxlength="24" required></div>${authTab === 'register' ? '<div class="field"><label for="nickname">怎么称呼你</label><input id="nickname" name="nickname" placeholder="给棋友看的昵称" maxlength="16" required autocomplete="nickname"></div>' : ''}<div class="field"><label for="password">密码</label><input id="password" name="password" type="password" placeholder="至少 8 位，记得妥善保存" minlength="8" maxlength="128" autocomplete="${authTab === 'login' ? 'current-password' : 'new-password'}" required></div><button class="primary full" type="submit">${authTab === 'login' ? '登录，去见棋友' : '创建账号，进入棋室'} <span>↗</span></button><div class="form-error" id="auth-error" role="alert"></div></form><p class="fine">免费朋友棋室 · 暂不提供密码找回，请牢记密码。<br>账号与棋局保存在服务器；断线后可登录继续。</p></div></section></div>`;
}
function resumeHtml() {
  const r = state.room; if (!r || tab === 'game') return '';
  const active = r.game?.phase === 'playing', mine = r.game?.turn === state.user.id;
  return `<div class="resume"><div><strong>${active ? (mine ? '轮到你落子了' : '棋局仍在进行') : '你在一个棋室中'} · ${esc(r.name)}</strong><small>${active ? '逛大厅不会退出对局，走棋计时继续。' : '回到棋室，等待朋友入座。'}</small></div><button class="primary" data-tab="game">返回棋局 ↗</button></div>`;
}
function personHtml(u) {
  const self = u.id === state.user.id, friend = state.friends.some(f => f.id === u.id), pending = state.outgoing.includes(u.id);
  return `<div class="person">${avatar(u)}<div class="info"><strong>${esc(u.nickname)}${self ? ' <span class="muted">(我)</span>' : ''}</strong><small>${u.online ? '<i class="dot"></i>' : ''}${u.online ? (u.roomId ? '在棋室 ' + esc(u.roomId) : '在大厅') : '离线'} · @${esc(u.username)}</small></div>${self ? '' : friend ? '<span class="pill">好友</span>' : pending ? '<span class="muted" style="font-size:11px">已申请</span>' : `<button class="text-btn" data-add="${esc(u.id)}">＋ 好友</button>`}</div>`;
}
function lobbyHtml() {
  return `<section class="hero"><div><div class="eyebrow">CHINESE CHESS · FRIENDS & PLAY</div><h1>落子之间，<br>都是老朋友。</h1><p>沏一杯茶，邀一位朋友。今天，也来一盘好棋。</p></div><div class="hero-mark" aria-hidden="true">弈</div></section>${resumeHtml()}<div class="lobby-grid"><section><div class="row spread section-head"><h2>开放棋室<small>${state.rooms.length} 间</small></h2><div class="row" style="gap:7px"><button class="secondary" data-do="join">房间码加入</button><button class="primary" data-do="create">＋ 创建棋室</button></div></div><div class="rooms">${state.rooms.map(r => `<article class="room-card"><div class="row spread"><span class="code">NO. ${esc(r.id)}</span><span class="pill ${r.phase === 'playing' ? 'live' : ''}">${r.phase === 'playing' ? '对弈中' : r.phase === 'finished' ? '已结束' : '待入座'}</span></div><h3>${esc(r.name)}</h3><span class="muted" style="font-size:11px">${r.players.length}/2 位棋友 · ${r.phase === 'playing' ? '精彩正在发生' : '以棋会友，不急不徐'}</span><div class="seats">${r.players.map(p => avatar(p)).join('')}${r.players.length < 2 ? '<span class="seat-empty">＋</span>' : ''}<button class="join" data-join="${r.id}" ${r.id !== state.room?.id && (r.players.length >= 2 || r.phase === 'playing') ? 'disabled' : ''}>${r.id === state.room?.id ? '回到棋室 ↗' : r.players.length < 2 && r.phase !== 'playing' ? '入座 →' : '对弈中'}</button></div></article>`).join('')}<button class="create-card" data-do="create"><span class="plus">＋</span><strong>留一席，等朋友</strong><small>创建你的专属棋室</small></button></div><p class="rules-note">红方先行 · 双方准备后开局 · 每步限时 5 分钟<br>朋友局采用三次重复局面、连续 120 步未吃子自动和棋的约定。<button class="text-btn" data-do="rules">玩法说明 ↗</button></p></section><aside class="aside"><div class="row spread"><h2>此刻在线</h2><span class="pill">${state.users.length} 人</span></div><p class="intro">点一下，认识今天的对手。</p>${state.users.map(personHtml).join('') || empty('还没有其他棋友在线')}<div class="rules-note">${state.requests.length ? `你有 ${state.requests.length} 条新的好友申请。<button class="text-btn" data-tab="friends">去看看 →</button>` : '好棋总要有人分享。把网址发给朋友，一起入座吧。'}</div></aside></div>`;
}
function friendsHtml() {
  return `<section class="hero"><div><div class="eyebrow">GOOD FRIENDS, GOOD GAMES</div><h1>棋逢对手，<br>更是朋友。</h1><p>通过用户名添加朋友，下次相聚更容易。</p></div><div class="hero-mark" aria-hidden="true">友</div></section>${resumeHtml()}<form class="friend-search" id="friend-form"><input aria-label="好友用户名" name="username" placeholder="输入好友的用户名" value="${esc(friendDraft)}" required minlength="3" maxlength="24" autocomplete="off"><button class="primary">发送好友申请</button></form><div class="friends-grid"><section><div class="row spread section-head"><h2>我的棋友<small>${state.friends.length} 位</small></h2></div>${state.friends.map(personHtml).join('') || empty('好友列表还是空的<br>在大厅遇到朋友，就加个好友吧。', '友')}</section><section><div class="section-head"><h2>新的朋友<small>${state.requests.length} 条</small></h2></div>${state.requests.map(r => `<div class="person"><span class="avatar red">友</span><div class="info"><strong>${esc(r.fromNickname)}</strong><small>想成为你的棋友</small></div><button class="text-btn" data-respond="${esc(r.id)}" data-accept="true">接受</button><button class="text-btn muted" data-respond="${esc(r.id)}" data-accept="false">拒绝</button></div>`).join('') || empty('暂时没有新的好友申请', '＋')}</section></div>`;
}
function waitingHtml(r) {
  const me = r.players.find(p => p.id === state.user.id);
  return `<div class="waiting-info"><div class="eyebrow">YOUR PRIVATE CHESS ROOM</div><h1 style="margin-top:14px">${esc(r.name)}</h1><p>房间码 <strong style="letter-spacing:4px;color:var(--red)">${r.id}</strong> <button class="text-btn" data-do="copy">复制邀请</button><br>双方点击准备后自动开局，第一局房主执红。</p><div class="waiting-seats">${r.players.map((p, i) => `<div class="waiting-seat">${avatar(p, i === 0)}<h3>${esc(p.nickname)}${p.id === state.user.id ? '（我）' : ''}</h3><small>${p.ready ? '✓ 已准备' : '还在品茶，尚未准备'}${!p.online ? ' · 离线' : ''}</small></div>`).join('')}${r.players.length < 2 ? '<div class="waiting-seat"><div class="avatar">？</div><h3>等一位棋友</h3><small>邀请朋友用房间码加入</small></div>' : ''}</div><div class="actions"><button class="primary" data-ready="${!me.ready}">${me.ready ? '取消准备' : '准备好了，开始下棋'}</button><button class="secondary" data-tab="lobby">逛逛大厅</button><button class="danger" data-do="leave">退出棋室</button></div><div class="waiting-board" style="margin-top:30px">${boardHtml(null, true)}</div></div>`;
}
function playerHtml(u, c, g) {
  return `<div class="player-bar"><div class="row">${avatar(u, c === 'red')}<div><strong>${esc(u.nickname)}${u.id === state.user.id ? '（我）' : ''}</strong><small>${c === 'red' ? '执红' : '执黑'} · ${u.online ? '在线' : '暂时离线'}</small></div></div>${g.phase === 'playing' && g.turn === u.id ? '<span class="clock" data-clock>05:00</span>' : '<span class="pill">' + (g.phase === 'finished' ? '本局结束' : '等候落子') + '</span>'}</div>`;
}
function gameHtml() {
  const r = state.room;
  if (!r) return `<div class="waiting-info"><h1>棋盘已备，等你入座。</h1><p>到大厅创建棋室，或通过房间码加入朋友。</p><div class="actions"><button class="primary" data-tab="lobby">前往大厅</button><button class="secondary" data-do="create">创建棋室</button></div></div>`;
  if (!r.game) return waitingHtml(r);
  const g = r.game, me = state.user.id, myColor = g.players.red === me ? 'red' : 'black', bottomColor = flipped ? (myColor === 'red' ? 'black' : 'red') : myColor, topColor = bottomColor === 'red' ? 'black' : 'red';
  const top = r.players.find(p => p.id === g.players[topColor]), bottom = r.players.find(p => p.id === g.players[bottomColor]);
  return `<div class="game-grid"><section><div class="table-top"><div><h1>${esc(r.name)}</h1><small>棋室 ${r.id} · 第 ${Math.floor(g.ply / 2) + 1} 回合</small></div><button class="secondary" data-tab="lobby">← 返回大厅</button></div>${playerHtml(top, topColor, g)}${boardHtml(g)}${playerHtml(bottom, bottomColor, g)}<div class="turn-label ${g.turn === me && g.phase === 'playing' ? '' : 'wait'}"><span>${g.phase === 'finished' ? '本局结束，好棋下回再续。' : g.turn === me ? (g.check ? '你正被将军，请应将。' : '轮到你了，选择棋子后点击落点。') : (g.check ? '对方正在应将。' : '对方正在思考，请稍候。')}</span><span>${myColor === 'red' ? '你执红' : '你执黑'}</span></div></section><aside class="game-side"><section class="panel"><h2>此局小记</h2>${g.phase === 'finished' ? `<div class="result"><strong>${g.winner === null ? '握手言和' : g.winner === me ? '此局，你赢了。' : '胜败常事，下局再来。'}</strong><small>${reasons[g.reason] || '对局结束'}</small></div><p>双方再次准备后交换红黑，开启新一局。</p>` : '<p>可随时回大厅看看，棋局与计时继续。每步 5 分钟，超时判负。</p>'}${g.drawOffer ? `<div class="banner" style="margin:14px 0">${g.drawOffer === me ? '和棋申请已发出，等待对方回应。' : '对方申请和棋。'}${g.drawOffer !== me ? '<div class="actions"><button class="primary" data-action="accept-draw">同意和棋</button><button class="secondary" data-action="decline-draw">继续对弈</button></div>' : ''}</div>` : ''}<div class="actions">${g.phase === 'playing' ? `<button class="secondary" data-action="offer-draw" ${g.drawOffer ? 'disabled' : ''}>提议和棋</button><button class="danger" data-do="resign">认输</button>` : `<button class="primary" data-ready="${!r.players.find(p => p.id === me).ready}">${r.players.find(p => p.id === me).ready ? '已准备 · 取消' : '再来一局 · 准备'}</button><button class="secondary" data-do="leave">退出棋室</button>`}<button class="secondary" data-do="flip">翻转棋盘</button><button class="secondary" data-do="copy">复制房间</button></div><p class="fine">${g.phase === 'finished' ? r.players.map(p => esc(p.nickname) + '：' + (p.ready ? '已准备' : '未准备')).join(' · ') : '绿色圆点是可走位置。所有走法由服务端校验。'}</p></section><section class="panel"><h2>往来棋谱 <span class="muted" style="font:11px system-ui">${g.ply} 步</span></h2><div class="moves" id="moves">${g.history.map(m => `<span class="${m.piece[0] === 'r' ? 'red' : ''}">${m.ply}. ${pieces[m.piece]} ${'abcdefghi'[m.from[0]]}${9 - m.from[1]} → ${'abcdefghi'[m.to[0]]}${9 - m.to[1]}${m.captured ? ' ×' + pieces[m.captured] : ''}</span>`).join('') || '<span>静待第一手好棋。</span>'}</div></section><section class="panel"><h2>棋室闲聊</h2><div class="chat-log" id="chat-log">${r.messages.map(m => `<p><strong>${esc(m.nickname)}</strong><br>${esc(m.text)}</p>`).join('') || '<p class="muted">和对面的朋友打个招呼吧。</p>'}</div><form class="chat-form" id="chat-form"><input name="message" aria-label="聊天消息" placeholder="落子之余，说两句…" value="${esc(chatDraft)}" required maxlength="160" autocomplete="off"><button class="primary">发送</button></form></section></aside></div>`;
}
function render() {
  if (!state) { renderAuth(); return; }
  const activeInput = document.activeElement, activeId = activeInput?.closest('form')?.id, activeName = activeInput?.name, selection = activeInput?.selectionStart;
  $('#app').innerHTML = `<div class="shell"><aside class="rail">${brand}<nav aria-label="主导航">${[['lobby', '⌂', '棋友大厅'], ['game', '弈', '我的棋局'], ['friends', '☷', '好友']].map(([id, icon, label]) => `<button data-tab="${id}" class="nav-btn ${tab === id ? 'active' : ''}" ${tab === id ? 'aria-current="page"' : ''}><span>${icon}</span>${label}${id === 'friends' && state.requests.length ? `<span class="count">${state.requests.length}</span>` : ''}</button>`).join('')}</nav><div class="rail-note">以棋会友　落子无悔</div><div class="profile"><div class="row">${avatar(state.user)}<div><strong>${esc(state.user.nickname)}</strong><small>@${esc(state.user.username)}</small></div></div><button class="signout" data-do="logout">退出登录 ↗</button></div></aside><main class="workspace"><header class="topbar"><span class="page-title">${tab === 'lobby' ? '棋友大厅' : tab === 'friends' ? '我的棋友' : '对弈棋室'}</span><div class="row"><span class="connection" id="connection"><i class="dot"></i>已连接</span><button class="text-btn" data-do="logout" aria-label="退出登录" title="退出登录">↗</button></div></header>${tab === 'lobby' ? lobbyHtml() : tab === 'friends' ? friendsHtml() : gameHtml()}</main></div>`;
  if (activeId && activeName) { const input = document.querySelector(`#${activeId} [name="${activeName}"]`); input?.focus({ preventScroll: true }); if (input && selection !== null) input.setSelectionRange(selection, selection); }
  for (const id of ['chat-log', 'moves']) { const el = $('#' + id); if (el) el.scrollTop = el.scrollHeight; }
  updateClock();
}
async function refresh(force = false) {
  if (!token || polling) return;
  polling = true;
  try {
    const next = await request('state'); serverOffset = next.serverTime - Date.now();
    const sig = JSON.stringify({ ...next, serverTime: 0 });
    if (next.room?.game?.id !== state?.room?.game?.id || next.room?.game?.ply !== state?.room?.game?.ply) selected = null;
    const mine = next.room?.game?.phase === 'playing' && next.room.game.turn === next.user.id;
    if (mine && previousTurn === false && tab !== 'game') toast('轮到你走棋了，记得返回棋局。');
    previousTurn = mine; state = next;
    if (sig !== signature || force) { signature = sig; render(); }
    if ($('#connection')) $('#connection').innerHTML = '<i class="dot"></i>已连接';
  } catch (e) {
    if (e.status === 401) { token = null; sessionStorage.removeItem('xiangqi-token'); state = null; render(); toast('登录已过期，请重新登录'); }
    else if ($('#connection')) $('#connection').textContent = '网络中断 · 自动重连';
  } finally { polling = false; }
}
function updateClock() {
  const g = state?.room?.game; if (!g || g.phase !== 'playing') return;
  const seconds = Math.max(0, Math.ceil((g.deadline - Date.now() - serverOffset) / 1000));
  document.querySelectorAll('[data-clock]').forEach(el => { el.textContent = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; el.classList.toggle('low', seconds < 30); });
}
async function execute(path, data, after) {
  if (busy) return; busy = true;
  try { const result = await request(path, data); if (after) await after(result); await refresh(true); }
  catch (e) { toast(e.name === 'TimeoutError' ? '连接超时，正在重新同步。请确认棋盘后重试。' : e.message); await refresh(true); }
  finally { busy = false; }
}
function modal(title, description, fields, confirm, handler) {
  $('#modal-content').innerHTML = `<h2>${title}</h2><p>${description}</p><form id="modal-form">${fields}<div class="actions"><button type="button" class="secondary" data-close>取消</button><button class="primary" type="submit">${confirm}</button></div></form>`;
  $('#modal').showModal();
  $('#modal-form').onsubmit = async e => { e.preventDefault(); const form = Object.fromEntries(new FormData(e.target)); $('#modal').close(); await handler(form); };
  $('#modal').querySelector('input')?.focus();
}
function createRoom() { if (state.room) { tab = 'game'; render(); toast('你已有棋室，请先结束对局并退出棋室。'); return; } modal('开一间棋室', '为朋友留个位置。创建后，把六位房间码发给对方。', `<label for="room-name">棋室名称</label><input id="room-name" name="name" maxlength="24" required value="${esc(state.user.nickname)}的棋室">`, '创建棋室', b => execute('rooms/create', b, () => { tab = 'game'; flipped = false; })); }
async function selectPoint(point) {
  if (busy) return;
  const g = state?.room?.game;
  if (!g || g.phase !== 'playing') return;
  if (g.turn !== state.user.id) { toast('对方正在走棋，请稍候。'); return; }
  const p = g.board[point[1] * 9 + point[0]], c = g.players.red === state.user.id ? 'red' : 'black';
  if (p && p[0] === (c === 'red' ? 'r' : 'b')) { selected = selected?.join(',') === point.join(',') ? null : point; render(); return; }
  if (!selected) { toast('先选择一枚自己的棋子。'); return; }
  const move = legalMoves(g.board, c, selected).find(m => m.to.join(',') === point.join(','));
  if (!move) { toast('这里不能落子，请留意蹩马腿、塞象眼和将军。'); return; }
  await execute('rooms/action', { type: 'move', gameId: g.id, ply: g.ply, ...move }, () => { selected = null; });
}
document.addEventListener('click', async e => {
  const el = e.target.closest('button'); if (!el || el.disabled) return;
  if (el.hasAttribute('data-close')) { $('#modal').close(); return; }
  if (el.dataset.auth) { authTab = el.dataset.auth; renderAuth(); return; }
  if (el.dataset.tab) { tab = el.dataset.tab; selected = null; render(); window.scrollTo({ top: 0 }); return; }
  if (el.dataset.point) { await selectPoint(el.dataset.point.split(',').map(Number)); return; }
  if (el.dataset.join) { if (el.dataset.join === state.room?.id) { tab = 'game'; render(); } else await execute('rooms/join', { roomId: el.dataset.join }, () => { tab = 'game'; flipped = false; }); return; }
  if (el.dataset.add) { await execute('friends/request', { userId: el.dataset.add }, () => toast('好友申请已发送')); return; }
  if (el.dataset.respond) { await execute('friends/respond', { requestId: el.dataset.respond, accept: el.dataset.accept === 'true' }); return; }
  if (el.hasAttribute('data-ready')) { await execute('rooms/ready', { ready: el.dataset.ready === 'true' }); return; }
  if (el.dataset.action) { await execute('rooms/action', { type: el.dataset.action, gameId: state.room.game.id }); return; }
  const action = el.dataset.do;
  if (action === 'create') createRoom();
  if (action === 'join') modal('循码入座', '输入朋友发来的六位房间码。', '<label for="room-code">房间码</label><input id="room-code" name="roomId" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required placeholder="例如 123456">', '进入棋室', b => execute('rooms/join', b, () => { tab = 'game'; flipped = false; }));
  if (action === 'leave') modal('退出这间棋室？', '进行中的棋局需要先认输或和棋。只是想逛大厅，可以直接点“返回大厅”。', '', '退出棋室', () => execute('rooms/leave', {}, () => { tab = 'lobby'; selected = null; }));
  if (action === 'resign') modal('这局先让朋友一手？', '认输后本局立即结束，双方可以准备再来一局。', '', '确认认输', () => execute('rooms/action', { type: 'resign', gameId: state.room.game.id }));
  if (action === 'flip') { flipped = !flipped; render(); }
  if (action === 'copy') { const invite = `来棋友下象棋：${location.origin}/\n房间码：${state.room.id}`; try { await navigator.clipboard.writeText(invite); toast('邀请已复制，发给朋友就好。'); } catch { modal('邀请朋友', '复制下面的房间码，让朋友在大厅加入。', `<input aria-label="房间码" value="${state.room.id}" readonly>`, '知道了', () => {}); } }
  if (action === 'rules') modal('朋友局，落子无悔', '红先黑后；马走日、象走田、炮隔一子吃子。禁止送将和将帅照面；将死或无棋可走均判负。每步 5 分钟，断线和逛大厅时继续计时。三次相同局面或连续 120 步未吃子判和；长将长捉采用这一朋友局约定，不作比赛裁决。', '', '明白了', () => {});
  if (action === 'logout') modal('暂时离席？', '账号和棋局会保留。进行中的棋局仍会计时，重新登录后可以回来继续。', '', '退出登录', async () => { try { await request('auth/logout', {}); } catch { /* Session expires server-side in seven days. */ } token = null; state = null; signature = ''; sessionStorage.removeItem('xiangqi-token'); render(); });
});
document.addEventListener('submit', async e => {
  if (!['auth-form', 'friend-form', 'chat-form'].includes(e.target.id)) return;
  e.preventDefault(); const form = e.target, values = Object.fromEntries(new FormData(form));
  if (form.id === 'auth-form') {
    const button = form.querySelector('button'); button.disabled = true; $('#auth-error').textContent = '';
    try { const result = await request('auth/' + authTab, values); token = result.token; sessionStorage.setItem('xiangqi-token', token); await refresh(true); window.scrollTo({ top: 0 }); }
    catch (e) { if ($('#auth-error')) $('#auth-error').textContent = e.name === 'TimeoutError' ? '连接超时，请稍后再试。' : e.message; }
    finally { button.disabled = false; }
  } else if (form.id === 'friend-form') await execute('friends/request', values, () => { friendDraft = ''; toast('好友申请已发送'); });
  else await execute('rooms/chat', { text: values.message }, () => { chatDraft = ''; });
});
document.addEventListener('input', e => { if (e.target.closest('#chat-form')) chatDraft = e.target.value; if (e.target.closest('#friend-form')) friendDraft = e.target.value; });
document.addEventListener('keydown', e => {
  const button = e.target.closest('[data-point]'); if (!button || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) return;
  e.preventDefault(); const buttons = [...document.querySelectorAll('[data-point]')], i = buttons.indexOf(button), delta = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[e.key];
  buttons[Math.max(0, Math.min(89, i + delta))]?.focus();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true); });
window.addEventListener('online', () => refresh(true));
renderAuth();
if (token) refresh(true);
setInterval(() => refresh(), 2000);
setInterval(updateClock, 1000);
