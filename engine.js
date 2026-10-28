// 将棋の盤面・指し手・表記。UIに依存しない(テストからも読み込む)
(function (root) {
  'use strict';

  const SENTE = 0, GOTE = 1;
  const HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
  const NAMES = { K: '玉', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩' };
  const PROMOTED_NAMES = { R: '龍', B: '馬', S: '全', N: '圭', L: '杏', P: 'と' };
  // 表記用(成銀などは2文字)
  const PROMOTED_LONG = { R: '龍', B: '馬', S: '成銀', N: '成桂', L: '成香', P: 'と' };
  const KANJI_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const ZEN_NUM = ['', '１', '２', '３', '４', '５', '６', '７', '８', '９'];

  // 先手から見た向き。dr<0 が前
  const GOLD_STEPS = [[0, -1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1]];
  const STEPS = {
    K: [[0, -1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1]],
    G: GOLD_STEPS,
    S: [[0, -1], [1, -1], [-1, -1], [1, 1], [-1, 1]],
    N: [[1, -2], [-1, -2]],
    P: [[0, -1]],
  };
  const ORTHO = [[0, -1], [0, 1], [1, 0], [-1, 0]];
  const DIAG = [[1, -1], [-1, -1], [1, 1], [-1, 1]];

  function emptyBoard() {
    const b = [];
    for (let f = 0; f <= 9; f++) b.push(new Array(10).fill(null));
    return b;
  }
  function emptyHands() {
    return [{ R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 }, { R: 0, B: 0, G: 0, S: 0, N: 0, L: 0, P: 0 }];
  }

  const INITIAL_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

  function fromSfen(sfen) {
    const [boardPart, turnPart, handPart] = sfen.split(' ');
    const board = emptyBoard();
    const rows = boardPart.split('/');
    rows.forEach((row, i) => {
      const r = i + 1;
      let f = 9, promoted = false;
      for (const ch of row) {
        if (ch === '+') { promoted = true; continue; }
        if (/\d/.test(ch)) { f -= Number(ch); continue; }
        const upper = ch.toUpperCase();
        board[f][r] = { t: upper, s: ch === upper ? SENTE : GOTE, p: promoted };
        promoted = false;
        f--;
      }
    });
    const hands = emptyHands();
    if (handPart && handPart !== '-') {
      let n = '';
      for (const ch of handPart) {
        if (/\d/.test(ch)) { n += ch; continue; }
        const upper = ch.toUpperCase();
        hands[ch === upper ? SENTE : GOTE][upper] += n ? Number(n) : 1;
        n = '';
      }
    }
    return { board, hands, turn: turnPart === 'w' ? GOTE : SENTE, last: null };
  }

  function clone(pos) {
    return {
      board: pos.board.map(col => col.map(p => (p ? { t: p.t, s: p.s, p: p.p } : null))),
      hands: pos.hands.map(h => Object.assign({}, h)),
      turn: pos.turn,
      last: pos.last,
    };
  }

  const inBoard = (f, r) => f >= 1 && f <= 9 && r >= 1 && r <= 9;
  const inZone = (side, r) => (side === SENTE ? r <= 3 : r >= 7);

  function canPromoteType(t) { return t !== 'K' && t !== 'G'; }

  function mustPromote(t, side, r) {
    const rel = side === SENTE ? r : 10 - r;
    if (t === 'P' || t === 'L') return rel === 1;
    if (t === 'N') return rel <= 2;
    return false;
  }

  // 駒が利いている升(盤上の自駒の上も含む)
  function attacksFrom(pos, f, r) {
    const pc = pos.board[f][r];
    const dir = pc.s === SENTE ? 1 : -1;
    const out = [];
    const step = (df, dr) => {
      const nf = f + df, nr = r + dr * dir;
      if (inBoard(nf, nr)) out.push([nf, nr]);
    };
    const slide = (df, dr) => {
      let nf = f + df, nr = r + dr * dir;
      while (inBoard(nf, nr)) {
        out.push([nf, nr]);
        if (pos.board[nf][nr]) break;
        nf += df; nr += dr * dir;
      }
    };
    if (pc.p && (pc.t === 'S' || pc.t === 'N' || pc.t === 'L' || pc.t === 'P')) {
      GOLD_STEPS.forEach(([df, dr]) => step(df, dr));
    } else if (pc.t === 'R') {
      ORTHO.forEach(([df, dr]) => slide(df, dr));
      if (pc.p) DIAG.forEach(([df, dr]) => step(df, dr));
    } else if (pc.t === 'B') {
      DIAG.forEach(([df, dr]) => slide(df, dr));
      if (pc.p) ORTHO.forEach(([df, dr]) => step(df, dr));
    } else if (pc.t === 'L') {
      slide(0, -1);
    } else {
      STEPS[pc.t].forEach(([df, dr]) => step(df, dr));
    }
    return out;
  }

  function findKing(pos, side) {
    for (let f = 1; f <= 9; f++) for (let r = 1; r <= 9; r++) {
      const p = pos.board[f][r];
      if (p && p.t === 'K' && p.s === side) return [f, r];
    }
    return null;
  }

  function isAttacked(pos, f, r, bySide) {
    for (let af = 1; af <= 9; af++) for (let ar = 1; ar <= 9; ar++) {
      const p = pos.board[af][ar];
      if (!p || p.s !== bySide) continue;
      if (attacksFrom(pos, af, ar).some(([x, y]) => x === f && y === r)) return true;
    }
    return false;
  }

  function inCheck(pos, side) {
    const k = findKing(pos, side);
    return k ? isAttacked(pos, k[0], k[1], 1 - side) : false;
  }

  function pseudoMoves(pos) {
    const side = pos.turn;
    const moves = [];
    for (let f = 1; f <= 9; f++) for (let r = 1; r <= 9; r++) {
      const pc = pos.board[f][r];
      if (!pc || pc.s !== side) continue;
      for (const [tf, tr] of attacksFrom(pos, f, r)) {
        const target = pos.board[tf][tr];
        if (target && target.s === side) continue;
        const promotable = !pc.p && canPromoteType(pc.t) && (inZone(side, r) || inZone(side, tr));
        if (promotable) moves.push({ from: [f, r], to: [tf, tr], promote: true });
        if (!mustPromote(pc.p ? 'G' : pc.t, side, tr)) moves.push({ from: [f, r], to: [tf, tr], promote: false });
      }
    }
    for (const t of HAND_ORDER) {
      if (!pos.hands[side][t]) continue;
      for (let f = 1; f <= 9; f++) {
        if (t === 'P' && hasPawnOnFile(pos, side, f)) continue;
        for (let r = 1; r <= 9; r++) {
          if (pos.board[f][r] || mustPromote(t, side, r)) continue;
          moves.push({ drop: t, to: [f, r], promote: false });
        }
      }
    }
    return moves;
  }

  function hasPawnOnFile(pos, side, f) {
    for (let r = 1; r <= 9; r++) {
      const p = pos.board[f][r];
      if (p && p.t === 'P' && !p.p && p.s === side) return true;
    }
    return false;
  }

  function applyMove(pos, mv) {
    const next = clone(pos);
    const side = pos.turn;
    const [tf, tr] = mv.to;
    if (mv.drop) {
      next.board[tf][tr] = { t: mv.drop, s: side, p: false };
      next.hands[side][mv.drop]--;
    } else {
      const [ff, fr] = mv.from;
      const pc = next.board[ff][fr];
      const captured = next.board[tf][tr];
      if (captured) next.hands[side][captured.t]++;
      next.board[ff][fr] = null;
      next.board[tf][tr] = { t: pc.t, s: side, p: pc.p || !!mv.promote };
    }
    next.turn = 1 - side;
    next.last = mv;
    return next;
  }

  // uchifuzume(打ち歩詰め)は判定しない。型の練習では出てこないため
  function legalMoves(pos) {
    return pseudoMoves(pos).filter(mv => !inCheck(applyMove(pos, mv), pos.turn));
  }

  // 囲いの練習用: 相手は指さない(手番を戻す)
  function applyOwnMove(pos, mv) {
    const next = applyMove(pos, mv);
    next.turn = pos.turn;
    return next;
  }

  // ---- USI ----
  const RANK_CH = 'abcdefghi';
  function parseUsi(s) {
    if (s[1] === '*') {
      return { drop: s[0], to: [Number(s[2]), RANK_CH.indexOf(s[3]) + 1], promote: false };
    }
    return {
      from: [Number(s[0]), RANK_CH.indexOf(s[1]) + 1],
      to: [Number(s[2]), RANK_CH.indexOf(s[3]) + 1],
      promote: s[4] === '+',
    };
  }
  function toUsi(mv) {
    const sq = ([f, r]) => f + RANK_CH[r - 1];
    if (mv.drop) return mv.drop + '*' + sq(mv.to);
    return sq(mv.from) + sq(mv.to) + (mv.promote ? '+' : '');
  }
  function sameMove(a, b) { return toUsi(a) === toUsi(b); }

  // ---- 日本語表記(▲7六歩 など) ----
  function pieceLabel(pc) { return pc.p ? PROMOTED_LONG[pc.t] : NAMES[pc.t]; }

  function toJapanese(pos, mv) {
    const side = pos.turn;
    const mark = side === SENTE ? '▲' : '△';
    const [tf, tr] = mv.to;
    const same = pos.last && pos.last.to[0] === tf && pos.last.to[1] === tr;
    const dest = same ? '同' : ZEN_NUM[tf] + KANJI_NUM[tr];
    if (mv.drop) {
      // 盤上の同じ駒も同じ升へ行けるときだけ「打」を付ける
      const ambiguous = legalMoves(pos).some(m => !m.drop && m.to[0] === tf && m.to[1] === tr &&
        pos.board[m.from[0]][m.from[1]].t === mv.drop && !pos.board[m.from[0]][m.from[1]].p);
      return mark + dest + NAMES[mv.drop] + (ambiguous ? '打' : '');
    }
    const pc = pos.board[mv.from[0]][mv.from[1]];
    let suffix = '';
    const rivals = legalMoves(pos).filter(m => !m.drop && m.to[0] === tf && m.to[1] === tr &&
      !(m.from[0] === mv.from[0] && m.from[1] === mv.from[1]) &&
      pos.board[m.from[0]][m.from[1]].t === pc.t && pos.board[m.from[0]][m.from[1]].p === pc.p);
    if (rivals.length) suffix = disambiguate(side, mv, rivals);
    const promotable = !pc.p && canPromoteType(pc.t) && (inZone(side, mv.from[1]) || inZone(side, tr));
    let promo = '';
    if (mv.promote) promo = '成';
    else if (promotable) promo = '不成';
    return mark + dest + pieceLabel(pc) + suffix + promo;
  }

  function disambiguate(side, mv, rivals) {
    const [ff, fr] = mv.from, [tf, tr] = mv.to;
    // 先手から見た「前」= 段が小さくなる。後手は逆
    const fwd = side === SENTE ? fr - tr : tr - fr;
    const rivalFwd = rivals.map(m => (side === SENTE ? m.from[1] - tr : tr - m.from[1]));
    const movement = fwd > 0 ? '上' : fwd < 0 ? '引' : '寄';
    const movementUnique = rivalFwd.every(rf => Math.sign(rf) !== Math.sign(fwd));
    if (movementUnique) return movement;
    // 右・左は指す側から見て。先手は筋が小さい方が右
    const isRight = rivals.every(m => (side === SENTE ? ff < m.from[0] : ff > m.from[0]));
    const isLeft = rivals.every(m => (side === SENTE ? ff > m.from[0] : ff < m.from[0]));
    if (isRight) return '右';
    if (isLeft) return '左';
    return movement;
  }

  function squareName(f, r) { return ZEN_NUM[f] + KANJI_NUM[r]; }

  const api = {
    SENTE, GOTE, HAND_ORDER, NAMES, PROMOTED_NAMES, INITIAL_SFEN,
    fromSfen, clone, legalMoves, applyMove, applyOwnMove, inCheck, canPromoteType, inZone, mustPromote,
    parseUsi, toUsi, sameMove, toJapanese, squareName, attacksFrom,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Shogi = api;
})(this);
