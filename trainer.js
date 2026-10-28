// 練習の判定ロジック。UIに依存しない(テストからも読み込む)
(function (root) {
  'use strict';
  const S = root.Shogi || require('./engine.js');

  function lessonById(lessons, id) { return lessons.find(l => l.id === id); }

  function planItem(item) { return { piece: item[0], mv: S.parseUsi(item[1]), usi: item[1], note: item[2] }; }

  // 囲いの開始局面。'after:mino' なら美濃囲いをお手本順に組んだ局面(相手の手も含む)から
  function startPosition(lessons, lesson) {
    if (lesson.kind === 'line' || lesson.start === 'initial') return S.fromSfen(S.INITIAL_SFEN);
    const prev = lessonById(lessons, lesson.start.slice('after:'.length));
    return playCastle(lessons, prev, true).pos;
  }

  // ---- 囲いの相手 ----
  // 台本の from 番目以降で、今指せる最初の手。指せない手は飛ばす
  function nextScriptMove(pos, script, from) {
    const legal = S.legalMoves(pos);
    for (let i = from; i < script.length; i++) {
      const mv = S.parseUsi(script[i][0]);
      if (legal.some(m => S.sameMove(m, mv))) return { index: i, mv, note: script[i][1] };
    }
    return null;
  }

  // 相手の番の手。台本が尽きたら手番だけ渡す(パス)
  function applyReply(pos, reply) {
    if (reply) return S.applyMove(pos, reply.mv);
    const next = S.clone(pos);
    next.turn = 1 - pos.turn;
    return next;
  }

  // お手本の順番で、相手の応手もはさみながら囲いを組む
  function playCastle(lessons, lesson, replyAfterLast) {
    let pos = startPosition(lessons, lesson);
    const script = lesson.opponent.script;
    const steps = [];
    let from = 0;
    lesson.plan.forEach((raw, k) => {
      const item = planItem(raw);
      steps.push({ mv: item.mv, note: item.note, side: S.SENTE });
      pos = S.applyMove(pos, item.mv);
      if (k === lesson.plan.length - 1 && !replyAfterLast) return;
      const reply = nextScriptMove(pos, script, from);
      if (reply) { steps.push({ mv: reply.mv, note: reply.note, side: S.GOTE }); from = reply.index + 1; }
      pos = applyReply(pos, reply);
    });
    return { pos, steps };
  }

  function findPiece(pos, side, t) {
    for (let f = 1; f <= 9; f++) for (let r = 1; r <= 9; r++) {
      const p = pos.board[f][r];
      if (p && p.s === side && p.t === t && !p.p) return [f, r];
    }
    return null;
  }

  function pathClear(pos, [f1, r1], [f2, r2]) {
    const df = Math.sign(f2 - f1), dr = Math.sign(r2 - r1);
    for (let f = f1 + df, r = r1 + dr; f !== f2 || r !== r2; f += df, r += dr) {
      if (pos.board[f][r]) return false;
    }
    return true;
  }

  // 咎めの手順(相手番の局面で判定)。当てはまらなければ null
  const RULE_CHECKS = {
    // 角同士がにらみ合っていたら、相手が角を交換する
    bishopTrade(pos) {
      const mine = findPiece(pos, S.SENTE, 'B'), theirs = findPiece(pos, S.GOTE, 'B');
      if (!mine || !theirs) return null;
      if (Math.abs(mine[0] - theirs[0]) !== Math.abs(mine[1] - theirs[1])) return null;
      if (!pathClear(pos, theirs, mine)) return null;
      const promote = S.inZone(S.GOTE, mine[1]);
      return [{ from: theirs, to: mine, promote }];
    },
    // 飛車先の歩が5段目まで来ていて、6段目を歩以外で守っていなければ、歩を交換される
    filePush(pos, rule) {
      const f = rule.file;
      const at = (r, side, t) => { const p = pos.board[f][r]; return p && p.s === side && p.t === t && !p.p; };
      if (!at(5, S.GOTE, 'P') || !at(7, S.SENTE, 'P') || !at(2, S.GOTE, 'R')) return null;
      if (pos.board[f][3] || pos.board[f][4]) return null;
      for (let af = 1; af <= 9; af++) for (let ar = 1; ar <= 9; ar++) {
        const p = pos.board[af][ar];
        if (!p || p.s !== S.SENTE || (af === f && ar === 7)) continue;
        if (S.attacksFrom(pos, af, ar).some(([x, y]) => x === f && y === 6)) return null;
      }
      return [
        { from: [f, 5], to: [f, 6], promote: false },
        { from: [f, 7], to: [f, 6], promote: false },
        { from: [f, 2], to: [f, 6], promote: false },
      ];
    },
    // 相手が得をする駒取り(タダ取り・駒損になる交換)があれば取る
    freeCapture(pos) {
      const best = bestCapture(pos);
      return best && best.gain > 0 ? [best.mv] : null;
    },
  };

  const VALUE = { P: 1, L: 3, N: 3, S: 5, G: 6, B: 8, R: 10, K: 0 };
  function pieceValue(pc) {
    if (!pc) return 0;
    if (pc.p) return pc.t === 'R' ? 12 : pc.t === 'B' ? 10 : 6;
    return VALUE[pc.t];
  }

  // 相手番の局面で、駒取りによる相手の最大の得(取り返されるなら取った駒の分を引く)
  function bestCapture(pos) {
    let best = null;
    for (const m of S.legalMoves(pos)) {
      if (m.drop) continue;
      const target = pos.board[m.to[0]][m.to[1]];
      if (!target || target.s === pos.turn) continue;
      const next = S.applyMove(pos, m);
      let gain = pieceValue(target);
      if (S.isAttacked(next, m.to[0], m.to[1], next.turn)) gain -= pieceValue(next.board[m.to[0]][m.to[1]]);
      if (!best || gain > best.gain) best = { mv: m, gain, target };
    }
    return best;
  }

  function pieceLabel(pc) { return pc.p ? S.PROMOTED_NAMES[pc.t] : S.NAMES[pc.t]; }

  // 咎めの説明。ルールに書いてなければ種類ごとの決まり文句
  function ruleText(rule, pos, moves) {
    if (rule.why) return { why: rule.why, fix: rule.fix };
    if (rule.type === 'bishopTrade') {
      return {
        why: '角道が開いたまま、角同士がにらみ合っていました。角を交換されて、陣形が崩れてしまいます。',
        fix: '角交換を避けたいときは、▲6六歩などで角道を止めておこう。',
      };
    }
    if (rule.type === 'filePush') {
      return {
        why: '飛車先の歩を交換されて、相手の飛車が自由に動けるようになりました。',
        fix: '△8五歩と伸ばされたら、▲7七角などで8六を守っておこう。',
      };
    }
    const mv = moves[0];
    const target = pos.board[mv.to[0]][mv.to[1]];
    const recapture = S.isAttacked(S.applyMove(pos, mv), mv.to[0], mv.to[1], S.SENTE);
    return {
      why: recapture
        ? `${pieceLabel(target)}を取られて、取り返しても駒損になってしまいました。`
        : `${pieceLabel(target)}がタダで取られてしまいました。`,
      fix: '駒を動かす前に、動かした先や空いた升に相手の駒が利いていないか確認しよう。',
    };
  }

  // ルールに当てはまる咎め。{ moves, score } / null(手順がすべて合法なときだけ)
  function checkRule(pos, rule) {
    const moves = RULE_CHECKS[rule.type](pos, rule);
    if (!moves) return null;
    let p = pos;
    for (const mv of moves) {
      if (!S.legalMoves(p).some(m => S.sameMove(m, mv))) return null;
      p = S.applyMove(p, mv);
    }
    const score = rule.type === 'freeCapture' ? bestCapture(pos).gain : 1;
    return { moves, score };
  }

  function withText(rule, pos, moves) {
    return Object.assign({ rule, moves }, ruleText(rule, pos, moves));
  }

  // 囲い用。返り値: { rule, moves, why, fix } / null
  function findPunish(pos, rules) {
    for (const rule of rules || []) {
      const hit = checkRule(pos, rule);
      if (hit) return withText(rule, pos, hit.moves);
    }
    return null;
  }

  // 戦法用: 型の手(expected)なら起きない隙を、指した手(mv)が作ったときだけ咎める
  function findLinePunish(pos, mv, expected, rules) {
    const captured = m => (m.drop ? 0 : pieceValue(pos.board[m.to[0]][m.to[1]]));
    const after = S.applyMove(pos, mv), afterExpected = S.applyMove(pos, expected);
    for (const rule of rules || []) {
      const hit = checkRule(after, rule);
      if (!hit) continue;
      const base = checkRule(afterExpected, rule);
      // 駒取りは、自分が直前に取った駒の分を差し引いて比べる
      const adjust = rule.type === 'freeCapture';
      const score = hit.score - (adjust ? captured(mv) : 0);
      const baseScore = base ? base.score - (adjust ? captured(expected) : 0) : 0;
      if (score > 0 && score > baseScore) return withText(rule, after, hit.moves);
    }
    return null;
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
    lessonById, planItem, startPosition, finalPosition, nextScriptMove, applyReply, playCastle, findPunish, findLinePunish, planMoveAvailable, completable,
    judgeCastleMove, castleHint, stepOf, leafPaths, pathKey, branchNames, flatten,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Trainer = api;
})(this);
