// Chinese chess for friendly games. Coordinates: black at y=0, red at y=9.
export const opposite = c => c === 'red' ? 'black' : 'red';
const inside = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 9 && y >= 0 && y < 10;
const index = (x, y) => y * 9 + x;
const color = p => p?.[0] === 'r' ? 'red' : 'black';
const prefix = c => c === 'red' ? 'r' : 'b';
const palace = (c, x, y) => x >= 3 && x <= 5 && (c === 'red' ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
const must = (ok, message) => { if (!ok) throw new Error(message); };
export function initialBoard() {
  const b = Array(90).fill(null);
  for (const [c, back, cannon, soldier] of [['b', 0, 2, 3], ['r', 9, 7, 6]]) {
    [...'rheakaehr'].forEach((p, x) => { b[index(x, back)] = c + p; });
    for (const x of [1, 7]) b[index(x, cannon)] = c + 'c';
    for (const x of [0, 2, 4, 6, 8]) b[index(x, soldier)] = c + 'p';
  }
  return b;
}
function between(b, x, y, tx, ty) {
  const dx = Math.sign(tx - x), dy = Math.sign(ty - y);
  let count = 0;
  for (let nx = x + dx, ny = y + dy; nx !== tx || ny !== ty; nx += dx, ny += dy) if (b[index(nx, ny)]) count++;
  return count;
}
export function pseudoLegal(b, from, to) {
  if (!Array.isArray(from) || !Array.isArray(to)) return false;
  const [x, y] = from, [tx, ty] = to;
  if (!inside(x, y) || !inside(tx, ty) || (x === tx && y === ty)) return false;
  const p = b[index(x, y)], target = b[index(tx, ty)];
  if (!p || (target && color(p) === color(target))) return false;
  const c = color(p), dx = tx - x, dy = ty - y, ax = Math.abs(dx), ay = Math.abs(dy);
  switch (p[1]) {
    case 'r': return (dx === 0 || dy === 0) && between(b, x, y, tx, ty) === 0;
    case 'c': return (dx === 0 || dy === 0) && between(b, x, y, tx, ty) === (target ? 1 : 0);
    case 'h': return ax * ay === 2 && !b[index(x + (ax === 2 ? Math.sign(dx) : 0), y + (ay === 2 ? Math.sign(dy) : 0))];
    case 'e': return ax === 2 && ay === 2 && (c === 'red' ? ty >= 5 : ty <= 4) && !b[index(x + dx / 2, y + dy / 2)];
    case 'a': return ax === 1 && ay === 1 && palace(c, tx, ty);
    case 'k':
      if (target === prefix(opposite(c)) + 'k' && dx === 0 && between(b, x, y, tx, ty) === 0) return true;
      return ax + ay === 1 && palace(c, tx, ty);
    case 'p': return (dx === 0 && dy === (c === 'red' ? -1 : 1)) || (dy === 0 && ax === 1 && (c === 'red' ? y <= 4 : y >= 5));
    default: return false;
  }
}
export function isCheck(b, c) {
  const king = b.indexOf(prefix(c) + 'k');
  if (king < 0) return true;
  for (let i = 0; i < 90; i++) if (b[i] && color(b[i]) !== c && pseudoLegal(b, [i % 9, Math.floor(i / 9)], [king % 9, Math.floor(king / 9)])) return true;
  return false;
}
export function isLegal(b, c, from, to) {
  if (!pseudoLegal(b, from, to) || color(b[index(...from)]) !== c) return false;
  const next = [...b]; next[index(...to)] = next[index(...from)]; next[index(...from)] = null;
  return !isCheck(next, c);
}
export function legalMoves(b, c, from = null) {
  const moves = [];
  for (let i = 0; i < 90; i++) {
    if (!b[i] || color(b[i]) !== c || (from && index(...from) !== i)) continue;
    for (let j = 0; j < 90; j++) {
      const f = [i % 9, Math.floor(i / 9)], t = [j % 9, Math.floor(j / 9)];
      if (isLegal(b, c, f, t)) moves.push({ from: f, to: t });
    }
  }
  return moves;
}
const positionKey = g => g.board.map(p => p || '..').join('') + g.turnColor;
export function createGame(ids) {
  must(ids.length === 2 && ids[0] !== ids[1], '需要两位不同玩家');
  const g = { id: crypto.randomUUID(), players: { red: ids[0], black: ids[1] }, board: initialBoard(), turnColor: 'red', turn: ids[0], phase: 'playing', ply: 0, history: [], positions: {}, quietPly: 0, drawOffer: null, winner: null, reason: null, check: false };
  g.positions[positionKey(g)] = 1;
  return g;
}
export function finish(g, winner, reason) { g.phase = 'finished'; g.winner = winner; g.reason = reason; g.drawOffer = null; }
export function applyGameAction(g, userId, action) {
  must(g.phase === 'playing', '对局已经结束');
  must(Object.values(g.players).includes(userId), '你不是本局玩家');
  must(action.gameId === g.id, '棋局已更新，请刷新后操作');
  const c = g.players.red === userId ? 'red' : 'black';
  if (action.type === 'resign') { finish(g, g.players[opposite(c)], 'resign'); return; }
  if (action.type === 'offer-draw') { must(!g.drawOffer, '已有待处理的和棋申请'); g.drawOffer = userId; return; }
  if (action.type === 'accept-draw' || action.type === 'decline-draw') {
    must(g.drawOffer && g.drawOffer !== userId, '没有需要你处理的和棋申请');
    if (action.type === 'accept-draw') finish(g, null, 'agreement'); else g.drawOffer = null;
    return;
  }
  must(action.type === 'move', '无效操作');
  must(g.turn === userId, '还没轮到你走棋');
  must(action.ply === g.ply, '棋盘已更新，请重新选棋', 409);
  must(isLegal(g.board, c, action.from, action.to), '这步棋不符合规则，或会使己方被将军');
  const from = index(...action.from), to = index(...action.to);
  const piece = g.board[from], captured = g.board[to];
  g.board[to] = piece; g.board[from] = null;
  g.ply++; g.quietPly = captured ? 0 : g.quietPly + 1; g.drawOffer = null;
  g.history.push({ from: action.from, to: action.to, piece, captured, by: userId, ply: g.ply });
  g.turnColor = opposite(c); g.turn = g.players[g.turnColor]; g.check = isCheck(g.board, g.turnColor);
  if (captured === prefix(g.turnColor) + 'k') { finish(g, userId, 'capture'); return; }
  if (!legalMoves(g.board, g.turnColor).length) { finish(g, userId, g.check ? 'checkmate' : 'stalemate'); return; }
  const key = positionKey(g); g.positions[key] = (g.positions[key] || 0) + 1;
  if (g.positions[key] >= 3) finish(g, null, 'repetition');
  else if (g.quietPly >= 120) finish(g, null, 'no-capture');
}
export function publicGame(g) {
  const { positions, ...view } = g;
  return view;
}
