import { createGame, applyGameAction, publicGame, finish } from './game.mjs';

const SESSION_MS = 7 * 24 * 3600_000;
const TURN_MS = 300_000;
const enc = new TextEncoder();
let nextMaintenance = 0;
export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const fail = (message, status = 400) => { throw new ApiError(message, status); };
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => Uint8Array.from(s.match(/../g), x => parseInt(x, 16));
const random = (n = 24) => hex(crypto.getRandomValues(new Uint8Array(n)));
const hash = async text => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))));
const publicUser = u => ({ id: u.id, username: u.username, nickname: u.nickname });
export async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: unhex(salt), iterations: 100_000, hash: 'SHA-256' }, key, 256)));
}
function equal(a, b) { let d = a.length ^ b.length; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0); return d === 0; }
async function first(db, sql, ...args) { return db.prepare(sql).bind(...args).first(); }
async function all(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results; }
async function run(db, sql, ...args) { return db.prepare(sql).bind(...args).run(); }
async function rateLimit(db, key, max, period) {
  const now = Date.now();
  const bucket = `${key}:${Math.floor(now / period)}`;
  const row = await first(db, 'INSERT INTO rate_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', bucket, now + period);
  if (row.count > max) fail('操作太频繁，请稍后再试', 429);
}
async function body(request) {
  if (Number(request.headers.get('content-length')) > 8192) fail('请求过大', 413);
  const reader = request.body?.getReader();
  let size = 0; const chunks = [];
  if (!reader) return {};
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > 8192) { await reader.cancel(); fail('请求过大', 413); }
    chunks.push(value);
  }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  let parsed; try { parsed = JSON.parse(new TextDecoder().decode(data) || '{}'); } catch { fail('无效的 JSON 请求'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('无效的请求');
  return parsed;
}
function text(value, min, max, name) {
  if (typeof value !== 'string') fail(`请填写${name}`);
  const v = value.trim(); if (v.length < min || v.length > max) fail(`${name}长度须为 ${min}–${max} 个字符`);
  if (/[\x00-\x1f\x7f]/.test(v)) fail(`${name}包含无效字符`);
  return v;
}
async function session(db, request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) fail('请先登录', 401);
  const tokenHash = await hash(token);
  const u = await first(db, 'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>?', tokenHash, Date.now());
  if (!u) fail('登录已过期，请重新登录', 401);
  if (Date.now() - u.last_seen > 10_000) await run(db, 'UPDATE users SET last_seen=? WHERE id=?', Date.now(), u.id);
  return { user: u, tokenHash };
}
async function issueSession(db, u) {
  const token = random(32);
  await run(db, 'INSERT INTO sessions(hash,user_id,expires_at) VALUES(?,?,?)', await hash(token), u.id, Date.now() + SESSION_MS);
  return { token, user: publicUser(u) };
}
async function loadLobby(db) {
  let row = await first(db, "SELECT * FROM app_state WHERE id='lobby'");
  if (!row) {
    await run(db, "INSERT OR IGNORE INTO app_state(id,version,data) VALUES('lobby',0,?)", JSON.stringify({ rooms: {} }));
    row = await first(db, "SELECT * FROM app_state WHERE id='lobby'");
  }
  return { value: JSON.parse(row.data), version: row.version };
}
// One CAS row serializes membership and game actions together. This deliberately
// favors correctness for a small friends group over large public-lobby scale.
async function mutate(db, fn) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const { value, version } = await loadLobby(db);
    const result = fn(value);
    const update = await run(db, "UPDATE app_state SET data=?,version=version+1 WHERE id='lobby' AND version=?", JSON.stringify(value), version);
    if (update.meta.changes === 1) return result;
  }
  fail('棋局正在同步，请重试', 409);
}
function myRoom(lobby, userId) { return Object.values(lobby.rooms).find(r => r.players.some(p => p.id === userId)); }
function requireRoom(lobby, userId) { const r = myRoom(lobby, userId); if (!r) fail('请先加入房间', 404); return r; }
function roomSummary(r, online) {
  return { id: r.id, name: r.name, ownerId: r.ownerId, phase: r.game?.phase || 'waiting', players: r.players.map(p => ({ ...p, online: online.has(p.id) })) };
}
function addMessage(r, user, message) {
  r.messages.push({ id: random(6), userId: user.id, nickname: user.nickname, text: message, at: Date.now() });
  r.messages = r.messages.slice(-40);
}
function startIfReady(r) {
  if (r.players.length === 2 && r.players.every(p => p.ready)) {
    r.round = (r.round || 0) + 1;
    const seats = r.players.map(p => p.id);
    r.game = createGame(r.round % 2 ? seats : seats.reverse());
    r.deadline = Date.now() + TURN_MS;
    r.players.forEach(p => { p.ready = false; });
    r.updatedAt = Date.now();
  }
}
function act(r, userId, action) {
  if (!r.game) fail('棋局尚未开始');
  if (r.deadline <= Date.now()) fail('走棋时间已到，请刷新棋局', 409);
  try { applyGameAction(r.game, userId, action); } catch (e) { fail(e.message); }
  if (r.game.phase === 'finished') r.deadline = null;
  else if (action.type === 'move') r.deadline = Date.now() + TURN_MS;
  r.updatedAt = Date.now();
}
async function tick(db) {
  const { value } = await loadLobby(db);
  const now = Date.now();
  if (!Object.values(value.rooms).some(r => (r.deadline && r.deadline <= now) || now - r.updatedAt > 24 * 3600_000)) return;
  await mutate(db, lobby => {
    for (const r of Object.values(lobby.rooms)) {
      if (now - r.updatedAt > 24 * 3600_000) { delete lobby.rooms[r.id]; continue; }
      if (!r.game || r.game.phase === 'finished' || !r.deadline || r.deadline > now) continue;
      const g = r.game;
      finish(g, Object.values(g.players).find(id => id !== g.turn), 'timeout');
      r.deadline = null; r.updatedAt = now;
      addMessage(r, { id: 'system', nickname: '棋室助手' }, '走棋超时，本局结束');
    }
  });
}
async function state(db, u) {
  await tick(db);
  const { value: lobby } = await loadLobby(db);
  const users = await all(db, `SELECT DISTINCT u.id,u.username,u.nickname,u.last_seen FROM users u WHERE u.last_seen>? OR u.id IN (SELECT CASE WHEN from_id=? THEN to_id ELSE from_id END FROM friend_requests WHERE (from_id=? OR to_id=?) AND status='accepted') ORDER BY u.nickname`, Date.now() - 35_000, u.id, u.id, u.id);
  const online = new Set(users.filter(x => Date.now() - x.last_seen < 35_000).map(x => x.id));
  const describe = x => ({ ...publicUser(x), online: online.has(x.id), roomId: myRoom(lobby, x.id)?.id || null });
  const edges = await all(db, "SELECT * FROM friend_requests WHERE (from_id=? OR to_id=?) AND status='accepted'", u.id, u.id);
  const friendIds = new Set(edges.map(e => e.from_id === u.id ? e.to_id : e.from_id));
  const requests = await all(db, "SELECT f.id,f.from_id AS fromId,u.nickname AS fromNickname FROM friend_requests f JOIN users u ON f.from_id=u.id WHERE f.to_id=? AND f.status='pending'", u.id);
  const outgoing = await all(db, "SELECT to_id AS userId FROM friend_requests WHERE from_id=? AND status='pending'", u.id);
  const r = myRoom(lobby, u.id);
  return { user: publicUser(u), users: users.filter(x => online.has(x.id)).map(describe), friends: users.filter(x => friendIds.has(x.id)).map(describe), requests, outgoing: outgoing.map(x => x.userId), rooms: Object.values(lobby.rooms).map(x => roomSummary(x, online)), room: r ? { ...roomSummary(r, online), game: r.game ? { ...publicGame(r.game, u.id), deadline: r.deadline } : null, messages: r.messages } : null, serverTime: Date.now() };
}
export async function api(request, env) {
  const db = env.DB; if (!db) fail('数据库未配置', 503);
  const path = new URL(request.url).pathname;
  const method = request.method;
  if (path === '/api/health') return { ok: true, version: '1.0.0' };
  if (Date.now() >= nextMaintenance) {
    nextMaintenance = Date.now() + 10 * 60_000;
    await run(db, 'DELETE FROM sessions WHERE expires_at<?', Date.now());
    await run(db, 'DELETE FROM rate_limits WHERE expires_at<?', Date.now());
  }
  if (!['GET', 'POST'].includes(method)) fail('不支持的请求方法', 405);
  if (path.startsWith('/api/auth/') && ['register', 'login'].includes(path.split('/').pop())) {
    if (method !== 'POST') fail('请使用 POST', 405);
    const b = await body(request);
    const ip = request.headers.get('cf-connecting-ip') || 'local';
    await rateLimit(db, `auth:${await hash(ip)}`, 30, 15 * 60_000);
    const username = text(b.username, 3, 24, '用户名').toLowerCase();
    if (!/^[a-z0-9_]+$/.test(username)) fail('用户名只支持英文字母、数字和下划线');
    if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 128) fail('密码长度须为 8–128 个字符');
    if (path.endsWith('/register')) {
      await rateLimit(db, `register:${await hash(ip)}`, 10, 3600_000);
      const nickname = text(b.nickname || username, 1, 16, '昵称');
      const salt = random(16);
      const u = { id: crypto.randomUUID(), username, nickname, password: await passwordHash(b.password, salt), salt };
      try { await run(db, 'INSERT INTO users(id,username,nickname,password,salt,created_at,last_seen) VALUES(?,?,?,?,?,?,?)', u.id, username, nickname, u.password, salt, Date.now(), Date.now()); }
      catch (e) { if (/UNIQUE/i.test(e.message)) fail('这个用户名已被注册', 409); throw e; }
      return issueSession(db, u);
    }
    const u = await first(db, 'SELECT * FROM users WHERE username=?', username);
    const computed = await passwordHash(b.password, u?.salt || '00000000000000000000000000000000');
    if (!u || !equal(computed, u.password)) fail('用户名或密码不正确', 401);
    await run(db, 'UPDATE users SET last_seen=? WHERE id=?', Date.now(), u.id);
    return issueSession(db, u);
  }
  const { user: u, tokenHash } = await session(db, request);
  if (path === '/api/state' && method === 'GET') return state(db, u);
  if (method !== 'POST') fail('接口不存在', 404);
  const b = await body(request);
  await rateLimit(db, `action:${u.id}`, 120, 60_000);
  if (path === '/api/auth/logout') {
    await run(db, 'DELETE FROM sessions WHERE hash=?', tokenHash);
    await run(db, 'UPDATE users SET last_seen=0 WHERE id=?', u.id);
    return { ok: true };
  }
  if (path === '/api/friends/request') {
    if (b.username) { const target = await first(db, 'SELECT id FROM users WHERE username=?', text(b.username, 3, 24, '用户名').toLowerCase()); if (!target) fail('用户不存在', 404); b.userId = target.id; }
    if (typeof b.userId !== 'string' || b.userId === u.id) fail('请选择另一位玩家');
    if (!await first(db, 'SELECT id FROM users WHERE id=?', b.userId)) fail('用户不存在', 404);
    const edge = await first(db, 'SELECT * FROM friend_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)', u.id, b.userId, b.userId, u.id);
    if (edge?.status === 'accepted') fail('你们已经是好友');
    if (edge?.status === 'pending') fail(edge.to_id === u.id ? '对方已向你发出申请，请在好友栏处理' : '好友申请已发送');
    try {
      if (edge) {
        const changed = await run(db, "UPDATE friend_requests SET from_id=?,to_id=?,status='pending',created_at=? WHERE id=? AND status='declined'", u.id, b.userId, Date.now(), edge.id);
        if (!changed.meta.changes) fail('申请状态已更新，请刷新', 409);
      } else {
        await run(db, "INSERT INTO friend_requests(id,from_id,to_id,status,created_at) VALUES(?,?,?,'pending',?)", crypto.randomUUID(), u.id, b.userId, Date.now());
      }
    } catch (e) { if (/UNIQUE/i.test(e.message)) fail('好友申请已发送，请刷新查看', 409); throw e; }
    return { ok: true };
  }
  if (path === '/api/friends/respond') {
    if (typeof b.accept !== 'boolean') fail('请选择接受或拒绝');
    if (typeof b.requestId !== 'string' || b.requestId.length > 64) fail('好友申请编号无效');
    const result = await run(db, "UPDATE friend_requests SET status=? WHERE id=? AND to_id=? AND status='pending'", b.accept ? 'accepted' : 'declined', b.requestId || '', u.id);
    if (!result.meta.changes) fail('好友申请已处理或不存在', 404);
    return { ok: true };
  }
  if (path === '/api/rooms/create') {
    const name = text(b.name || `${u.nickname}的棋室`, 1, 24, '房间名');
    const roomId = await mutate(db, lobby => {
      if (myRoom(lobby, u.id)) fail('请先退出当前房间');
      if (Object.keys(lobby.rooms).length >= 100) fail('房间已满，请先加入已有房间');
      let id; do { id = String(100000 + crypto.getRandomValues(new Uint32Array(1))[0] % 900000); } while (lobby.rooms[id]);
      lobby.rooms[id] = { id, name, ownerId: u.id, players: [{ ...publicUser(u), ready: false }], game: null, messages: [], updatedAt: Date.now(), deadline: null };
      return id;
    });
    return { ok: true, roomId };
  }
  if (path === '/api/rooms/join') {
    if (typeof b.roomId !== 'string' || !/^\d{6}$/.test(b.roomId)) fail('请输入六位房间码');
    await mutate(db, lobby => {
      const current = myRoom(lobby, u.id); if (current) { if (current.id === b.roomId) return; fail('请先退出当前房间'); }
      const r = lobby.rooms[String(b.roomId)]; if (!r) fail('房间不存在', 404);
      if (r.players.length >= 2 || (r.game && r.game.phase !== 'finished')) fail('房间已满或正在游戏');
      r.players.push({ ...publicUser(u), ready: false }); r.updatedAt = Date.now();
      // A new participant must never inherit an old player's completed game.
      if (r.game) { r.game = null; r.players.forEach(p => { p.ready = false; }); }
    }); return { ok: true };
  }
  if (path === '/api/rooms/leave') {
    await mutate(db, lobby => {
      const r = requireRoom(lobby, u.id);
      if (r.game && r.game.phase !== 'finished') fail('棋局进行中，暂不能离开；可返回大厅或断线后回来继续，超时判负');
      r.players = r.players.filter(p => p.id !== u.id);
      if (!r.players.length) delete lobby.rooms[r.id];
      else { r.ownerId = r.players.some(p => p.id === r.ownerId) ? r.ownerId : r.players[0].id; r.game = null; r.players.forEach(p => { p.ready = false; }); r.updatedAt = Date.now(); }
    }); return { ok: true };
  }
  if (path === '/api/rooms/ready') {
    if (typeof b.ready !== 'boolean') fail('准备状态无效');
    await mutate(db, lobby => {
      const r = requireRoom(lobby, u.id);
      if (r.game && r.game.phase !== 'finished') fail('棋局已开始');
      r.players.find(p => p.id === u.id).ready = b.ready; r.updatedAt = Date.now(); startIfReady(r);
    }); return { ok: true };
  }
  if (path === '/api/rooms/action') {
    await tick(db);
    await mutate(db, lobby => act(requireRoom(lobby, u.id), u.id, b)); return { ok: true };
  }
  if (path === '/api/rooms/chat') {
    const message = text(b.text, 1, 160, '消息');
    await rateLimit(db, `chat:${u.id}`, 15, 60_000);
    await mutate(db, lobby => addMessage(requireRoom(lobby, u.id), u, message)); return { ok: true };
  }
  fail('接口不存在', 404);
}
