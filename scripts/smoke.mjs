// Creates two isolated QA accounts, completes a match, leaves the room and logs out.
// Passwords and tokens live only in memory. QA accounts remain offline afterwards.
import assert from 'node:assert/strict';
const origin = process.env.SITE_URL || 'http://127.0.0.1:3100';
const suffix = crypto.randomUUID().slice(0, 8), password = crypto.randomUUID() + crypto.randomUUID();
const sessions = [];
async function call(path, data, token) {
  const response = await fetch(origin + '/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(20000) });
  const raw = await response.text();
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`${path}: HTTP ${response.status}, received an HTML/network gateway response instead of the game API`);
  const body = JSON.parse(raw); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${body.error}`); return body;
}
try {
  assert.equal((await call('health')).ok, true);
  for (const [name, nickname] of [['red','发布验证红方'],['black','发布验证黑方']]) sessions.push(await call('auth/register', { username: `qa_${name}_${suffix}`, nickname, password }));
  const [a,b] = sessions;
  await call('friends/request', { userId:b.user.id }, a.token);
  const bs=await call('state',undefined,b.token); await call('friends/respond',{requestId:bs.requests[0].id,accept:true},b.token);
  assert((await call('state',undefined,a.token)).friends.some(x=>x.id===b.user.id));
  const {roomId}=await call('rooms/create',{name:'自动发布验证'},a.token);
  await call('rooms/join',{roomId},b.token); await call('rooms/ready',{ready:true},a.token); await call('rooms/ready',{ready:true},b.token);
  const start=(await call('state',undefined,a.token)).room.game;
  const action={type:'move',gameId:start.id,ply:0,from:[1,7],to:[4,7]};
  const results=await Promise.allSettled([call('rooms/action',action,a.token),call('rooms/action',action,a.token)]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  await call('rooms/action',{type:'move',gameId:start.id,ply:1,from:[1,0],to:[2,2]},b.token);
  const resumed=await call('auth/login',{username:a.user.username,password}); sessions.push(resumed);
  assert.equal((await call('state',undefined,resumed.token)).room.game.ply,2);
  await call('rooms/chat',{text:'联机验证完成'},b.token);
  await call('rooms/action',{type:'resign',gameId:start.id},b.token);
  assert.equal((await call('state',undefined,a.token)).room.game.winner,a.user.id);
  await call('rooms/leave',{},a.token); await call('rooms/leave',{},b.token);
  assert(!(await call('state',undefined,a.token)).rooms.some(r=>r.id===roomId));
  console.log('PASS: HTTPS/API, registration, friends, room, ready, concurrent move rejection, two moves, relogin recovery, chat, result and cleanup.');
} finally {
  for (const s of sessions) { try { await call('auth/logout',{},s.token); } catch { /* Preserve original verification failure. */ } }
}
