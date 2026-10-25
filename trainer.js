// 練習の判定ロジック。UIに依存しない(テストからも読み込む)
(function (root) {
  'use strict';
  const S = root.Shogi || require('./engine.js');

  function lessonById(lessons, id) { return lessons.find(l => l.id === id); }

  function planItem(item) { return { piece: item[0], mv: S.parseUsi(item[1]), usi: item[1], note: item[2] }; }

  // 囲いの開始局面。'after:mino' なら美濃囲いをお手本順に組んだ局面から
  function startPosition(lessons, lesson) {
    if (lesson.kind === 'line' || lesson.start === 'initial') return S.fromSfen(S.INITIAL_SFEN);
    const prev = lessonById(lessons, lesson.start.slice('after:'.length));
    let pos = startPosition(lessons, prev);
    for (const item of prev.plan) pos = S.applyOwnMove(pos, planItem(item).mv);
    return pos;
  }

  function finalPosition(lessons, lesson) {
    let pos = startPosition(lessons, lesson);
    for (const item of lesson.plan) pos = S.applyOwnMove(pos, planItem(item).mv);
    return pos;
  }

  // ---- 囲い(順番自由) ----
  function planMoveAvailable(pos, item) {
    const [f, r] = item.mv.from;
    const pc = pos.board[f][r];
    if (!pc || pc.s !== S.SENTE || pc.t !== item.piece) return false;
    return S.legalMoves(pos).some(m => S.sameMove(m, item.mv));
  }

  // 残りの手をすべて指し終えられるか(どこかで駒が道をふさいで詰まらないか)
  function completable(pos, plan, remaining, memo) {
    if (!remaining.length) return true;
    const key = remaining.join(',');
    if (memo.has(key)) return memo.get(key);
    let ok = false;
    for (const i of remaining) {
      if (!planMoveAvailable(pos, plan[i])) continue;
      const next = S.applyOwnMove(pos, plan[i].mv);
      if (completable(next, plan, remaining.filter(j => j !== i), memo)) { ok = true; break; }
    }
    memo.set(key, ok);
    return ok;
  }

  // 返り値: { ok: true, index } / { ok: false, reason: 'blocks' | 'wrongDest' | 'unused' }
  function judgeCastleMove(pos, plan, remaining, mv) {
    const idx = remaining.find(i => S.sameMove(plan[i].mv, mv) && planMoveAvailable(pos, plan[i]));
    if (idx !== undefined) {
      const next = S.applyOwnMove(pos, mv);
      if (completable(next, plan, remaining.filter(j => j !== idx), new Map())) return { ok: true, index: idx };
      return { ok: false, reason: 'blocks', index: idx };
    }
    if (!mv.drop && remaining.some(i => plan[i].mv.from[0] === mv.from[0] && plan[i].mv.from[1] === mv.from[1])) {
      return { ok: false, reason: 'wrongDest' };
    }
    return { ok: false, reason: 'unused' };
  }

  // ヒント: お手本の順番で、今指せて詰まらない最初の手
  function castleHint(pos, plan, remaining) {
    for (const i of remaining) {
      if (!planMoveAvailable(pos, plan[i])) continue;
      const next = S.applyOwnMove(pos, plan[i].mv);
      if (completable(next, plan, remaining.filter(j => j !== i), new Map())) return i;
    }
    return null;
  }

  // ---- 手順(分岐あり) ----
  function stepOf(raw) { return { usi: raw[0], mv: S.parseUsi(raw[0]), note: raw[1], near: raw[2] || {} }; }

  // 分岐の行き止まりまでの道筋。path は各分岐点で選んだ番号の配列
  function leafPaths(node, prefix) {
    prefix = prefix || [];
    if (!node.branches || !node.branches.length) return [prefix];
    return node.branches.flatMap((b, i) => leafPaths(b, prefix.concat(i)));
  }

  function pathKey(path) { return path.join('-') || 'main'; }

  function branchNames(lineRoot, path) {
    const names = [];
    let node = lineRoot;
    for (const i of path) { node = node.branches[i]; names.push(node.name); }
    return names;
  }

  // path に沿った手の一覧と、最後のノード
  function flatten(lineRoot, path) {
    const steps = [];
    let node = lineRoot;
    lineRoot.moves.forEach(m => steps.push(stepOf(m)));
    for (const i of path) {
      node = node.branches[i];
      node.moves.forEach(m => steps.push(stepOf(m)));
    }
    return { steps, end: node };
  }

  const api = {
    lessonById, planItem, startPosition, finalPosition, planMoveAvailable, completable,
    judgeCastleMove, castleHint, stepOf, leafPaths, pathKey, branchNames, flatten,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Trainer = api;
})(this);
