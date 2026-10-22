import test from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../src/api.mjs';
import { database } from '../scripts/database.mjs';
async function setup() {
  const db=database();
  const call=async (path, data, token) => api(new Request('http://localhost/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})}),{DB:db});
  const users=[];
  for (const name of ['alice','bob','carol']) users.push(await call('auth/register',{username:name,nickname:name,password:'test-password-123'}));
  const [a,b,c]=users, get=t=>call('state',undefined,t), post=(p,d,t=a.token)=>call(p,d,t);
  return {db,call,a,b,c,get,post};
}
test('register/login/logout, case normalization, hashed sessions and authorization', async () => {
  const {db,call,a,post}=await setup();
  try {
    assert.equal((await call('auth/login',{username:'ALICE',password:'test-password-123'})).user.id,a.user.id);
    await assert.rejects(call('auth/login',{username:'alice',password:'wrong-password'}),/不正确/);
    await assert.rejects(call('auth/register',{username:'alice',password:'password123'}),/注册/);
    await assert.rejects(call('state'),e=>e instanceof ApiError && e.status===401);
    const row=db.sqlite.prepare('SELECT * FROM users WHERE id=?').get(a.user.id); assert.notEqual(row.password,'test-password-123'); assert(!JSON.stringify(a.user).includes('salt'));
    assert(!db.sqlite.prepare('SELECT hash FROM sessions').all().some(r=>r.hash===a.token));
    await post('auth/logout',{}); await assert.rejects(call('state',undefined,a.token),/过期/);
  } finally { db.close(); }
});
test('friend requests by username, consent, online listing and duplicate pair race',async()=>{
  const {db,a,b,c,get,post}=await setup();
  try {
    assert.equal((await get(a.token)).users.length,3);
    await post('friends/request',{username:'bob'}); const bs=await get(b.token); assert.equal(bs.requests.length,1);
    await assert.rejects(post('friends/respond',{requestId:bs.requests[0].id,accept:true},c.token),/不存在/);
    await post('friends/respond',{requestId:bs.requests[0].id,accept:true},b.token);
    assert.equal((await get(a.token)).friends[0].id,b.user.id); assert.equal((await get(b.token)).friends[0].id,a.user.id);
    await assert.rejects(post('friends/request',{userId:a.user.id}),/另一位/);
    const results=await Promise.allSettled([post('friends/request',{userId:c.user.id}),post('friends/request',{userId:a.user.id},c.token)]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  } finally{db.close();}
});
test('two seats, concurrent joins, lobby preserves game, server rejects spectators',async()=>{
  const {db,a,b,c,get,post}=await setup();
  try {
    const {roomId}=await post('rooms/create',{name:'测试棋室'});
    const results=await Promise.allSettled([post('rooms/join',{roomId},b.token),post('rooms/join',{roomId},c.token)]); assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    const r=(await get(a.token)).room; assert.equal(r.players.length,2); const second=r.players.find(p=>p.id!==a.user.id); const other=second.id===b.user.id?b:c, spectator=other===b?c:b;
    await post('rooms/ready',{ready:true}); await post('rooms/ready',{ready:true},other.token);
    const before=(await get(a.token)).room.game; assert.equal(before.turn,a.user.id);
    assert.equal((await get(a.token)).room.game.id,before.id); assert.equal((await get(spectator.token)).room,null);
    await assert.rejects(post('rooms/action',{type:'resign',gameId:before.id},spectator.token),/房间/);
    await assert.rejects(post('rooms/leave',{}),/进行中/); await assert.rejects(post('rooms/create',{}),/退出/);
    const action={type:'move',gameId:before.id,ply:0,from:[0,6],to:[0,5]};
    const moves=await Promise.allSettled([post('rooms/action',action),post('rooms/action',action)]); assert.equal(moves.filter(x=>x.status==='fulfilled').length,1);
    const after=(await get(other.token)).room.game; assert.equal(after.ply,1); assert.equal(after.board[45],'rp');
    await post('rooms/action',{type:'resign',gameId:before.id},other.token);
    await post('rooms/ready',{ready:true}); await post('rooms/ready',{ready:true},other.token);
    const rematch=(await get(a.token)).room.game; assert.equal(rematch.players.red,other.user.id); assert.notEqual(rematch.id,before.id);
    await assert.rejects(post('rooms/action',{type:'resign',gameId:before.id}),/更新/);
  }finally{db.close();}
});
test('draw does not reset clock, timeout server adjudication and empty room cleanup',async()=>{
  const {db,a,b,get,post}=await setup();
  try {
    const {roomId}=await post('rooms/create',{}); await post('rooms/join',{roomId},b.token);
    await post('rooms/ready',{ready:true}); await post('rooms/ready',{ready:true},b.token);
    const g=(await get(a.token)).room.game;
    await post('rooms/action',{type:'offer-draw',gameId:g.id},b.token); assert.equal((await get(a.token)).room.game.deadline,g.deadline);
    const row=db.sqlite.prepare("SELECT data FROM app_state WHERE id='lobby'").get(); const lobby=JSON.parse(row.data); lobby.rooms[roomId].deadline=Date.now()-1;
    db.sqlite.prepare("UPDATE app_state SET data=? WHERE id='lobby'").run(JSON.stringify(lobby));
    const ended=(await get(b.token)).room.game; assert.equal(ended.reason,'timeout'); assert.equal(ended.winner,b.user.id);
    await post('rooms/leave',{}); await post('rooms/leave',{},b.token); assert.equal((await get(a.token)).rooms.length,0);
  }finally{db.close();}
});
test('invalid JSON, oversized payloads, field validation and chat remain bounded',async()=>{
  const {db,a,call,post,get}=await setup();
  try {
    await assert.rejects(post('rooms/join',{roomId:'oops'}),/六位/); await assert.rejects(post('rooms/ready',{ready:'yes'}),/无效/);
    await post('rooms/create',{}); await post('rooms/chat',{text:'<script>alert(1)</script>'}); assert.equal((await get(a.token)).room.messages.length,1);
    await assert.rejects(post('rooms/chat',{text:'x'.repeat(161)}),/长度/);
    await assert.rejects(api(new Request('http://localhost/api/auth/login',{method:'POST',body:'bad json'}),{DB:db}),/JSON/);
    await assert.rejects(call('auth/register',{username:'xxx',password:'p'.repeat(9000)}),e=>e.status===413);
  }finally{db.close();}
});
