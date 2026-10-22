import test from 'node:test';
import assert from 'node:assert/strict';
import { initialBoard, pseudoLegal, isLegal, isCheck, legalMoves, createGame, applyGameAction, publicGame } from '../src/game.mjs';
const board = (...entries) => { const b = Array(90).fill(null); for (const [x, y, p] of entries) b[y * 9 + x] = p; return b; };
const play = (g, from, to, extra = {}) => applyGameAction(g, g.turn, { type: 'move', gameId: g.id, ply: g.ply, from, to, ...extra });
test('initial position has 32 pieces and 44 legal red moves', () => {
  const b = initialBoard(); assert.equal(b.filter(Boolean).length, 32); assert.equal(legalMoves(b, 'red').length, 44); assert.equal(isCheck(b, 'red'), false); assert.equal(isCheck(b, 'black'), false);
});
test('rook cannot jump or move diagonally', () => { const b = initialBoard(); assert(!pseudoLegal(b, [0,9], [0,5])); assert(!pseudoLegal(b, [0,9], [1,8])); assert(pseudoLegal(b, [0,9], [0,8])); });
test('horse leg blocks either long axis', () => {
  let b = board([4,4,'rh'],[5,4,'rp']); assert(!pseudoLegal(b,[4,4],[6,5])); assert(pseudoLegal(b,[4,4],[5,6]));
  b = board([4,4,'rh'],[4,5,'rp']); assert(!pseudoLegal(b,[4,4],[5,6])); assert(pseudoLegal(b,[4,4],[6,5]));
});
test('elephant eye, home side of river, advisor palace', () => {
  let b = board([4,7,'re'],[5,6,'rp']); assert(!pseudoLegal(b,[4,7],[6,5])); assert(pseudoLegal(b,[4,7],[2,5])); assert(!pseudoLegal(board([4,5,'re']),[4,5],[6,3]));
  assert(!pseudoLegal(board([3,7,'ra']),[3,7],[2,6])); assert(pseudoLegal(board([3,7,'ra']),[3,7],[4,8]));
});
test('cannon captures across exactly one screen', () => {
  const b = board([0,0,'rc'],[0,2,'rp'],[0,5,'br']); assert(pseudoLegal(b,[0,0],[0,5])); assert(!pseudoLegal(b,[0,0],[0,4]));
  assert(!pseudoLegal(board([0,0,'rc'],[0,5,'br']),[0,0],[0,5])); b[27] = 'bp'; assert(!pseudoLegal(b,[0,0],[0,5]));
});
test('soldiers move forward, gain lateral moves after crossing, never retreat', () => {
  assert(!pseudoLegal(board([4,5,'rp']),[4,5],[5,5])); assert(pseudoLegal(board([4,4,'rp']),[4,4],[5,4])); assert(!pseudoLegal(board([4,4,'rp']),[4,4],[4,5]));
  assert(pseudoLegal(board([4,5,'bp']),[4,5],[3,5])); assert(pseudoLegal(board([4,3,'bp']),[4,3],[4,4]));
});
test('king palace and flying generals; cannot expose own king', () => {
  const b = board([4,0,'bk'],[4,9,'rk'],[4,5,'rr']); assert(!isLegal(b,'red',[4,5],[5,5])); assert(!pseudoLegal(b,[4,9],[4,7]));
  assert(isCheck(board([4,0,'bk'],[4,9,'rk']), 'red')); assert(pseudoLegal(board([4,0,'bk'],[4,9,'rk']),[4,9],[4,0]));
});
test('must evade check; cannot capture a friendly piece or leave board', () => {
  const b = board([4,9,'rk'],[3,0,'bk'],[4,4,'br'],[0,8,'rr']); assert(isCheck(b,'red')); assert(!isLegal(b,'red',[0,8],[0,7]));
  assert(!pseudoLegal(initialBoard(),[0,9],[1,9])); assert(!pseudoLegal(b,[4,9],[9,9])); assert(!pseudoLegal(b,null,[0,0]));
});
test('move changes turn, preserves history and rejects stale/foreign actions', () => {
  const g = createGame(['alice','bob']); play(g,[0,6],[0,5]); assert.equal(g.turn,'bob'); assert.equal(g.ply,1); assert.equal(g.history.length,1);
  assert.throws(() => applyGameAction(g,'alice',{ type:'move',gameId:g.id,ply:1,from:[2,6],to:[2,5] }), /轮到/);
  assert.throws(() => play(g,[0,3],[0,4],{ ply:0 }), /更新/); assert.throws(() => play(g,[0,3],[0,4],{ gameId:'old' }), /更新/);
  assert.throws(() => applyGameAction(g,'outsider',{type:'resign',gameId:g.id}), /不是/); assert(!('positions' in publicGame(g)));
});
test('checkmate wins; stalemate also loses in Chinese chess', () => {
  const g = createGame(['alice','bob']); g.board = board([4,0,'bk'],[4,9,'rk'],[4,5,'rp'],[3,1,'rr'],[5,1,'rr'],[4,3,'rr']);
  play(g,[4,3],[4,1]); assert.equal(g.reason,'checkmate'); assert.equal(g.winner,'alice');
  const s = createGame(['alice','bob']); s.board = board([4,0,'bk'],[4,9,'rk'],[4,2,'rp'],[3,1,'rr'],[5,1,'rr'],[0,5,'rr']);
  play(s,[0,5],[0,4]); assert.equal(s.reason,'stalemate'); assert.equal(s.winner,'alice');
});
test('draw offer needs opponent consent, move clears offer, resignation ends game', () => {
  const g = createGame(['a','b']); const act = (id,type) => applyGameAction(g,id,{type,gameId:g.id});
  act('b','offer-draw'); assert.throws(() => act('b','accept-draw'), /没有/); play(g,[0,6],[0,5]); assert.equal(g.drawOffer,null);
  act('a','offer-draw'); act('b','decline-draw'); act('a','offer-draw'); act('b','accept-draw'); assert.equal(g.phase,'finished'); assert.equal(g.winner,null);
  assert.throws(() => act('a','resign'), /结束/);
  const r = createGame(['a','b']); applyGameAction(r,'b',{type:'resign',gameId:r.id}); assert.equal(r.winner,'a');
});
test('threefold repetition is a friendly-game draw', () => {
  const g = createGame(['a','b']);
  for (let i=0;i<2;i++) { play(g,[1,9],[2,7]); play(g,[1,0],[2,2]); play(g,[2,7],[1,9]); play(g,[2,2],[1,0]); }
  assert.equal(g.reason,'repetition');
});
test('120 quiet half-moves draw; capture resets quiet counter', () => {
  const g = createGame(['a','b']); g.quietPly=119; play(g,[0,6],[0,5]); assert.equal(g.reason,'no-capture');
  const h = createGame(['a','b']); h.board=board([4,0,'bk'],[4,9,'rk'],[4,5,'rp'],[0,5,'rr'],[0,3,'bp']); h.quietPly=119;
  play(h,[0,5],[0,3]); assert.equal(h.quietPly,0); assert.equal(h.phase,'playing');
});
test('legal random play maintains two kings and valid turn progression', () => {
  for (let game=0;game<8;game++) {
    const g=createGame(['a','b']);
    for (let i=0;i<160 && g.phase==='playing';i++) { const moves=legalMoves(g.board,g.turnColor); assert(moves.length); const m=moves[(i*37+game*19)%moves.length]; const mover=g.turnColor; play(g,m.from,m.to); assert(!isCheck(g.board,mover)); }
  }
});
