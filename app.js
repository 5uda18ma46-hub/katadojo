(function () {
  'use strict';
  const S = Shogi, T = Trainer, LESSONS = Lessons.LESSONS;
  const STORE_KEY = 'katadojo:v1';
  const OPP_DELAY = 650;
  const $ = id => document.getElementById(id);

  // ---------- 進捗の保存 ----------
  function loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE_KEY));
      if (p && p.castle && p.line) return p;
    } catch (e) { /* 保存できない環境でも動かす */ }
    return { castle: {}, line: {} };
  }
  let progress = loadProgress();
  function saveProgress() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* noop */ }
  }

  function leafCount(lesson) { return lesson.kind === 'line' ? T.leafPaths(lesson.line).length : 1; }
  function clearedCount(lesson) {
    if (lesson.kind === 'castle') return progress.castle[lesson.id] ? 1 : 0;
    const got = progress.line[lesson.id] || {};
    return T.leafPaths(lesson.line).filter(p => got[T.pathKey(p)]).length;
  }

  // ---------- 一覧 ----------
  const ICON = { mino: '玉', takamino: '金', ginkan: '銀', funa: '舟', yagura: '矢', bougin: '銀', shiken: '飛', nakabisha: '飛' };

  function renderHome() {
    const list = $('lesson-list');
    list.innerHTML = '';
    let group = null, total = 0, cleared = 0;
    for (const lesson of LESSONS) {
      if (lesson.group !== group) {
        group = lesson.group;
        const h = document.createElement('h2');
        h.className = 'group-title';
        h.textContent = group;
        list.appendChild(h);
      }
      const n = leafCount(lesson), c = clearedCount(lesson);
      total += n; cleared += c;
      const card = document.createElement('button');
      card.className = 'lesson-card';
      const state = lesson.kind === 'castle'
        ? (c ? '✓ 完成' : '未完成')
        : (c === n ? '✓ 全変化' : `変化 ${c}/${n}`);
      card.innerHTML = `
        <div class="lesson-icon">${ICON[lesson.id] || '駒'}</div>
        <div class="lesson-body">
          <div class="lesson-name">${lesson.title}<span class="tag">${lesson.tag}</span></div>
          <div class="lesson-sum">${lesson.summary}</div>
        </div>
        <div class="lesson-state ${c === n ? 'cleared' : ''}">${state}</div>`;
      card.addEventListener('click', () => openLesson(lesson.id));
      list.appendChild(card);
    }
    $('overall').innerHTML = `習得 <b>${cleared}</b> / ${total}(囲いの完成＋戦法の変化)`;
  }

  // ---------- 練習の状態 ----------
  let st = null;

  function openLesson(id, opts) {
    const lesson = T.lessonById(LESSONS, id);
    st = {
      lesson, mode: 'practice', busy: false, history: [], selected: null,
      hint: 0, mistakes: 0, stepMistakes: 0, entries: [], msgKind: 'info', finished: false,
      forcedPath: (opts && opts.path) || null,
      ghost: true, demoK: 0, demoPath: null,
    };
    if (lesson.kind === 'castle') {
      st.plan = lesson.plan.map(T.planItem);
      st.final = T.finalPosition(LESSONS, lesson);
    }
    $('home').hidden = true;
    $('lesson').hidden = false;
    $('lesson-title').textContent = lesson.title;
    $('lesson-tag').textContent = lesson.tag;
    $('btn-ghost').hidden = lesson.kind !== 'castle';
    setMode('practice');
    window.scrollTo(0, 0);
  }

  function resetPractice() {
    const lesson = st.lesson;
    st.pos = T.startPosition(LESSONS, lesson);
    st.history = []; st.selected = null; st.hint = 0; st.mistakes = 0; st.stepMistakes = 0;
    st.finished = false; st.busy = false;
    if (lesson.kind === 'castle') {
      st.remaining = st.plan.map((_, i) => i);
    } else {
      st.node = lesson.line; st.i = 0; st.path = [];
    }
    st.msgKind = 'info';
    st.entries = [{ html: introHtml() }];
  }

  function introHtml() {
    const l = st.lesson;
    const how = l.kind === 'castle'
      ? '駒をタップして動かし、囲いを完成させよう。順番は自由ですが、駒が通り道をふさぐと先に進めなくなります。相手の手は省略しています。'
      : 'あなたは先手(▲・下側)。相手の手は自動で指されます。相手の応じ方によって変化が分かれます。';
    return `<div class="msg-title">${l.summary}</div>
      <ul>${l.points.map(p => `<li>${p}</li>`).join('')}</ul>
      <div class="note">${how}</div>`;
  }

  function goHome() {
    st = null;
    $('lesson').hidden = true;
    $('done').hidden = true;
    $('home').hidden = false;
    renderHome();
    window.scrollTo(0, 0);
  }

  function setMode(mode) {
    st.mode = mode;
    document.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.mode === mode));
    $('practice-actions').hidden = mode !== 'practice';
    $('demo-actions').hidden = mode !== 'demo';
    $('demo-variations').hidden = !(mode === 'demo' && st.lesson.kind === 'line');
    if (mode === 'practice') resetPractice();
    else { st.demoK = 0; st.demoPath = st.lesson.kind === 'line' ? T.leafPaths(st.lesson.line)[0] : null; }
    render();
  }

  // ---------- 期待される手 ----------
  function currentStep() {
    if (st.lesson.kind !== 'line') return null;
    return st.i < st.node.moves.length ? T.stepOf(st.node.moves[st.i]) : null;
  }

  function hintTarget() {
    if (st.lesson.kind === 'castle') {
      const i = T.castleHint(st.pos, st.plan, st.remaining);
      return i === null ? null : st.plan[i].mv;
    }
    const step = currentStep();
    return step ? step.mv : null;
  }

  // ---------- 入力 ----------
  function canInput() {
    if (!st || st.mode !== 'practice' || st.busy || st.finished) return false;
    return st.pos.turn === S.SENTE;
  }

  function onCellTap(f, r) {
    if (!canInput()) return;
    const pc = st.pos.board[f][r];
    const sel = st.selected;
    if (sel) {
      const cands = S.legalMoves(st.pos).filter(m => m.to[0] === f && m.to[1] === r &&
        (sel.drop ? m.drop === sel.drop : (!m.drop && m.from[0] === sel.from[0] && m.from[1] === sel.from[1])));
      if (cands.length) { choosePromotion(cands).then(mv => { if (mv) submitMove(mv); }); return; }
    }
    if (pc && pc.s === S.SENTE) {
      st.selected = sel && !sel.drop && sel.from[0] === f && sel.from[1] === r ? null : { from: [f, r] };
    } else {
      st.selected = null;
    }
    render();
  }

  function onHandTap(t) {
    if (!canInput()) return;
    st.selected = st.selected && st.selected.drop === t ? null : { drop: t };
    render();
  }

  function choosePromotion(cands) {
    if (cands.length === 1) return Promise.resolve(cands[0]);
    const yes = cands.find(m => m.promote), no = cands.find(m => !m.promote);
    const pc = st.pos.board[yes.from[0]][yes.from[1]];
    $('promo-yes').innerHTML = pieceHtml({ t: pc.t, s: S.SENTE, p: true }) + '<span class="caption">成る</span>';
    $('promo-no').innerHTML = pieceHtml({ t: pc.t, s: S.SENTE, p: false }) + '<span class="caption">成らない</span>';
    $('promo').hidden = false;
    return new Promise(resolve => {
      const finish = mv => {
        $('promo').hidden = true;
        $('promo-yes').onclick = $('promo-no').onclick = $('promo').onclick = null;
        resolve(mv);
      };
      $('promo-yes').onclick = e => { e.stopPropagation(); finish(yes); };
      $('promo-no').onclick = e => { e.stopPropagation(); finish(no); };
      $('promo').onclick = e => { if (e.target === $('promo')) { finish(null); } };
    });
  }

  function snapshot() {
    return {
      pos: st.pos, remaining: st.remaining && st.remaining.slice(),
      node: st.node, i: st.i, path: st.path && st.path.slice(),
      entries: st.entries.slice(), msgKind: st.msgKind,
    };
  }

  function submitMove(mv) {
    st.selected = null;
    if (st.lesson.kind === 'castle') submitCastleMove(mv);
    else submitLineMove(mv);
  }

  const CASTLE_REASON = {
    blocks: 'その手は囲いに必要ですが、今指すと他の駒の通り道をふさいでしまいます。先に別の駒を動かしましょう。',
    wrongDest: 'その駒は使いますが、行き先が違います。',
    unused: 'その駒は、今回の囲いでは動かしません。',
  };

  function submitCastleMove(mv) {
    const judge = T.judgeCastleMove(st.pos, st.plan, st.remaining, mv);
    if (!judge.ok) { miss(CASTLE_REASON[judge.reason]); return; }
    st.history.push(snapshot());
    const item = st.plan[judge.index];
    const label = S.toJapanese(st.pos, mv);
    st.pos = S.applyOwnMove(st.pos, mv);
    st.remaining = st.remaining.filter(i => i !== judge.index);
    st.hint = 0; st.stepMistakes = 0;
    st.msgKind = 'good';
    st.entries = [{ move: label, note: item.note }];
    if (!st.remaining.length) finishLesson();
    render();
  }

  function submitLineMove(mv) {
    const step = currentStep();
    if (!step) return;
    if (!S.sameMove(step.mv, mv)) {
      const near = step.near[S.toUsi(mv)];
      miss(near || 'その手ではありません。もう一度考えてみよう。', !!near);
      return;
    }
    st.history.push(snapshot());
    const label = S.toJapanese(st.pos, mv);
    st.pos = S.applyMove(st.pos, mv);
    st.i++;
    st.hint = 0; st.stepMistakes = 0;
    st.msgKind = 'good';
    st.entries = [{ move: label, note: step.note }];
    render();
    advanceOpponent();
  }

  function miss(text, soft) {
    if (!soft) { st.mistakes++; st.stepMistakes++; }
    if (st.stepMistakes >= 2 && st.hint < 1) st.hint = 1;
    st.msgKind = 'bad';
    st.entries = [{ html: `<div class="msg-title">${soft ? '惜しい！' : 'ちがいます'}</div>${text}` +
      (st.hint ? '<div class="note">光っている駒を動かしてみよう。</div>' : '') }];
    render();
    const board = $('board');
    board.classList.remove('shake');
    void board.offsetWidth;
    board.classList.add('shake');
  }

  // 相手の番になったら自動で指す。分岐点では未クリアの変化を優先して選ぶ
  function advanceOpponent() {
    if (st.i >= st.node.moves.length) {
      if (!st.node.branches || !st.node.branches.length) { finishLesson(); render(); return; }
    }
    if (st.pos.turn !== S.GOTE) return;
    st.busy = true;
    const lessonAtStart = st.lesson;
    setTimeout(() => {
      if (!st || st.lesson !== lessonAtStart || st.mode !== 'practice') return;
      let branchNote = '';
      if (st.i >= st.node.moves.length) {
        const k = pickBranch();
        const count = st.node.branches.length;
        st.node = st.node.branches[k];
        st.path.push(k);
        st.i = 0;
        branchNote = `この局面で相手の応じ方は${count}通り。今回は「${st.node.name}」の変化です。`;
      }
      const step = currentStep();
      const label = S.toJapanese(st.pos, step.mv);
      st.pos = S.applyMove(st.pos, step.mv);
      st.i++;
      st.entries.push({ move: label, note: step.note, opp: true, extra: branchNote });
      st.busy = false;
      if (st.i >= st.node.moves.length && (!st.node.branches || !st.node.branches.length)) finishLesson();
      render();
    }, OPP_DELAY);
  }

  function pickBranch() {
    const depth = st.path.length;
    if (st.forcedPath && st.forcedPath.length > depth) return st.forcedPath[depth];
    const got = progress.line[st.lesson.id] || {};
    const fresh = [];
    st.node.branches.forEach((b, k) => {
      const leaves = T.leafPaths(b, st.path.concat(k));
      if (leaves.some(p => !got[T.pathKey(p)])) fresh.push(k);
    });
    const pool = fresh.length ? fresh : st.node.branches.map((_, k) => k);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  // ---------- クリア ----------
  function finishLesson() {
    st.finished = true;
    const l = st.lesson;
    if (l.kind === 'castle') {
      const prev = progress.castle[l.id];
      progress.castle[l.id] = { best: prev ? Math.min(prev.best, st.mistakes) : st.mistakes };
    } else {
      progress.line[l.id] = progress.line[l.id] || {};
      progress.line[l.id][T.pathKey(st.path)] = true;
    }
    saveProgress();
    setTimeout(showDone, l.kind === 'castle' ? 500 : 900);
  }

  function showDone() {
    if (!st || !st.finished) return;
    const l = st.lesson;
    const end = l.kind === 'castle' ? l : st.node;
    $('done-badge').textContent = l.kind === 'castle' ? '完成' : 'クリア';
    $('done-title').textContent = l.kind === 'castle' ? l.title : `${l.title}:${st.node.name}`;
    $('done-text').textContent = end.done;
    $('done-score').textContent = st.mistakes ? `ミス ${st.mistakes}回` : 'ノーミス！';

    const vars = $('done-vars');
    vars.innerHTML = '';
    const actions = $('done-actions');
    actions.innerHTML = '';
    const addAction = (label, fn, primary) => {
      const b = document.createElement('button');
      b.className = 'btn' + (primary ? ' primary' : '');
      b.textContent = label;
      b.onclick = () => { $('done').hidden = true; fn(); };
      actions.appendChild(b);
    };

    if (l.kind === 'line') {
      const got = progress.line[l.id] || {};
      const paths = T.leafPaths(l.line);
      paths.forEach(p => {
        const ok = !!got[T.pathKey(p)];
        const li = document.createElement('li');
        li.innerHTML = `<span class="mark ${ok ? 'ok' : ''}">${ok ? '✓' : '・'}</span>
          <span class="name">${T.branchNames(l.line, p).join(' → ')}</span>`;
        const b = document.createElement('button');
        b.textContent = '練習';
        b.onclick = () => { $('done').hidden = true; openLesson(l.id, { path: p }); };
        li.appendChild(b);
        vars.appendChild(li);
      });
      const todo = paths.find(p => !got[T.pathKey(p)]);
      if (todo) addAction('残りの変化を練習', () => openLesson(l.id, { path: todo }), true);
      addAction('もう一度', () => openLesson(l.id, { path: st.path.slice() }), !todo);
    } else {
      const idx = LESSONS.indexOf(l);
      const next = LESSONS[idx + 1];
      if (next) addAction(`次へ:${next.title}`, () => openLesson(next.id), true);
      addAction('もう一度', () => openLesson(l.id), !next);
    }
    addAction('一覧へ', goHome);
    $('done').hidden = false;
  }

  // ---------- お手本 ----------
  function demoSteps() {
    const l = st.lesson;
    if (l.kind === 'castle') return st.plan.map(p => ({ mv: p.mv, note: p.note, own: true }));
    return T.flatten(l.line, st.demoPath).steps;
  }

  function demoState() {
    const steps = demoSteps();
    let pos = T.startPosition(LESSONS, st.lesson);
    const entries = [];
    for (let k = 0; k < st.demoK; k++) {
      const label = S.toJapanese(pos, steps[k].mv);
      pos = steps[k].own ? S.applyOwnMove(pos, steps[k].mv) : S.applyMove(pos, steps[k].mv);
      if (k >= st.demoK - 2) entries.push({ move: label, note: steps[k].note, opp: !steps[k].own && k % 2 === 1 });
    }
    // 囲いは自分の手だけなので、最新の1手だけ見せる
    const shown = st.lesson.kind === 'castle' ? entries.slice(-1) : entries;
    return { pos, steps, entries: shown };
  }

  // ---------- 描画 ----------
  function pieceHtml(pc, extra) {
    const ch = pc.t === 'K' ? (pc.s === S.SENTE ? '玉' : '王') : (pc.p ? S.PROMOTED_NAMES[pc.t] : S.NAMES[pc.t]);
    const cls = ['piece', pc.s === S.GOTE ? 'gote' : '', pc.p ? 'promoted' : '', extra || ''].join(' ');
    return `<div class="${cls}">${ch}</div>`;
  }

  function render() {
    if (!st) return;
    let pos, entries, msgKind;
    if (st.mode === 'demo') {
      const d = demoState();
      pos = d.pos; msgKind = 'info';
      entries = d.entries.length ? d.entries : [{ html: introHtml() }];
      renderDemoControls(d.steps.length);
      renderProgress(st.demoK, d.steps.length);
    } else {
      pos = st.pos; entries = st.entries; msgKind = st.msgKind;
      renderPracticeProgress();
    }
    renderBoard(pos);
    renderHands(pos);
    renderMsg(entries, msgKind);
    $('btn-undo').disabled = st.mode !== 'practice' || !st.history.length || st.busy;
    $('btn-hint').disabled = !canInput();
    $('btn-ghost').classList.toggle('on', st.ghost);
  }

  function renderBoard(pos) {
    const board = $('board');
    const sel = st.mode === 'practice' ? st.selected : null;
    let dests = [];
    if (sel && canInput()) {
      dests = S.legalMoves(pos).filter(m => sel.drop ? m.drop === sel.drop
        : (!m.drop && m.from[0] === sel.from[0] && m.from[1] === sel.from[1]));
    }
    const hint = st.mode === 'practice' && st.hint && canInput() ? hintTarget() : null;
    const showGhost = st.lesson.kind === 'castle' && st.ghost;
    const last = pos.last;
    let html = '';
    for (let r = 1; r <= 9; r++) {
      for (let f = 9; f >= 1; f--) {
        const pc = pos.board[f][r];
        const cls = ['cell'];
        if (last && last.to[0] === f && last.to[1] === r) cls.push('last');
        if (last && last.from && last.from[0] === f && last.from[1] === r) cls.push('last');
        if (sel && !sel.drop && sel.from[0] === f && sel.from[1] === r) cls.push('sel');
        if (dests.some(m => m.to[0] === f && m.to[1] === r)) cls.push('dest', pc ? 'capture' : '');
        if (hint && hint.from && hint.from[0] === f && hint.from[1] === r) cls.push('hint-from');
        if (hint && st.hint >= 2 && hint.to[0] === f && hint.to[1] === r) cls.push('hint-to');
        if ((f === 7 || f === 4) && (r === 3 || r === 6)) cls.push('star');
        let inner = '';
        if (pc) inner = pieceHtml(pc);
        else if (showGhost) {
          const g = st.final.board[f][r];
          if (g && g.s === S.SENTE && !samePieceAt(pos, st.final, f, r)) inner = pieceHtml(g, 'ghost');
        }
        html += `<div class="${cls.join(' ')}" data-f="${f}" data-r="${r}">${inner}</div>`;
      }
    }
    board.innerHTML = html;
  }

  function samePieceAt(a, b, f, r) {
    const x = a.board[f][r], y = b.board[f][r];
    return x && y && x.t === y.t && x.s === y.s && x.p === y.p;
  }

  function renderHands(pos) {
    const sel = st.mode === 'practice' ? st.selected : null;
    const hint = st.mode === 'practice' && st.hint && canInput() ? hintTarget() : null;
    [[S.GOTE, 'hand-gote', '△持駒'], [S.SENTE, 'hand-sente', '▲持駒']].forEach(([side, id, label]) => {
      const el = $(id);
      const hand = pos.hands[side];
      const items = S.HAND_ORDER.filter(t => hand[t]);
      let html = side === S.GOTE ? `<span class="hand-label">${label}</span>` : '';
      for (const t of items) {
        const cls = ['hand-piece'];
        if (side === S.SENTE && sel && sel.drop === t) cls.push('sel');
        if (side === S.SENTE && hint && hint.drop === t) cls.push('hint-from');
        const style = side === S.SENTE && sel && sel.drop === t ? ' style="background:var(--hl-sel);border-radius:6px"' : '';
        html += `<button class="${cls.join(' ')}" data-side="${side}" data-t="${t}"${style}>
          ${pieceHtml({ t, s: side, p: false }, 'small')}${hand[t] > 1 ? `<span class="count">${hand[t]}</span>` : ''}</button>`;
      }
      if (!items.length) html += '<span class="hand-label">なし</span>';
      if (side === S.SENTE) html += `<span class="hand-label">${label}</span>`;
      el.innerHTML = html;
    });
  }

  function renderMsg(entries, kind) {
    const el = $('msg');
    el.className = 'card msg ' + kind;
    el.innerHTML = entries.map(e => {
      if (e.html) return `<div class="msg-entry">${e.html}</div>`;
      return `<div class="msg-entry"><span class="msg-move ${e.opp ? 'opp' : ''}">${e.move}</span>${e.note}` +
        (e.extra ? `<div class="note">${e.extra}</div>` : '') + '</div>';
    }).join('');
  }

  function renderProgress(done, total) {
    $('progress-fill').style.width = (total ? (done / total) * 100 : 0) + '%';
    $('progress-text').textContent = `${done} / ${total} 手`;
  }

  function renderPracticeProgress() {
    if (st.lesson.kind === 'castle') {
      renderProgress(st.plan.length - st.remaining.length, st.plan.length);
      return;
    }
    // 分岐のどちらに進むか未定のうちは、最初の変化の長さを目安にする
    const path = st.path.length ? st.path : (st.forcedPath || T.leafPaths(st.lesson.line)[0]);
    let total = st.lesson.line.moves.length, done = 0, node = st.lesson.line;
    for (const k of path) { node = node.branches[k]; total += node.moves.length; }
    node = st.lesson.line;
    for (const k of st.path) { done += node.moves.length; node = node.branches[k]; }
    done += st.i;
    renderProgress(done, total);
  }

  function renderDemoControls(total) {
    $('demo-prev').disabled = st.demoK === 0;
    $('demo-first').disabled = st.demoK === 0;
    $('demo-next').disabled = st.demoK >= total;
    if (st.lesson.kind !== 'line') return;
    const box = $('demo-variations');
    const paths = T.leafPaths(st.lesson.line);
    box.innerHTML = '<span class="label">変化を選ぶ</span>';
    paths.forEach(p => {
      const b = document.createElement('button');
      b.className = 'chip' + (T.pathKey(p) === T.pathKey(st.demoPath) ? ' on' : '');
      b.textContent = T.branchNames(st.lesson.line, p).join(' → ');
      b.onclick = () => {
        // 分かれる前の手数までは今の位置を保つ
        const shared = st.lesson.line.moves.length;
        st.demoPath = p;
        st.demoK = Math.min(st.demoK, shared);
        render();
      };
      box.appendChild(b);
    });
  }

  // ---------- イベント ----------
  $('board').addEventListener('click', e => {
    const cell = e.target.closest('.cell');
    if (cell) onCellTap(Number(cell.dataset.f), Number(cell.dataset.r));
  });
  $('hand-sente').addEventListener('click', e => {
    const b = e.target.closest('.hand-piece');
    if (b) onHandTap(b.dataset.t);
  });
  $('back').addEventListener('click', goHome);
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    if (st && st.mode !== b.dataset.mode) setMode(b.dataset.mode);
  }));
  $('btn-hint').addEventListener('click', () => {
    if (!canInput()) return;
    st.hint = Math.min(st.hint + 1, 2);
    const target = hintTarget();
    if (target && st.hint >= 2) {
      st.msgKind = 'info';
      st.entries = [{ html: `<div class="msg-title">ヒント</div>答えは <b>${S.toJapanese(st.pos, target)}</b> です。光っている升に動かそう。` }];
    } else if (target) {
      st.msgKind = 'info';
      st.entries = [{ html: '<div class="msg-title">ヒント</div>光っている駒を動かします。もう一度押すと行き先も表示します。' }];
    }
    render();
  });
  $('btn-undo').addEventListener('click', () => {
    if (!st || st.busy || !st.history.length) return;
    const snap = st.history.pop();
    Object.assign(st, snap);
    st.selected = null; st.hint = 0; st.stepMistakes = 0; st.finished = false;
    render();
  });
  $('btn-reset').addEventListener('click', () => {
    if (!st || st.busy) return;
    resetPractice();
    render();
  });
  $('btn-ghost').addEventListener('click', () => { st.ghost = !st.ghost; render(); });
  $('demo-next').addEventListener('click', () => { st.demoK++; render(); });
  $('demo-prev').addEventListener('click', () => { st.demoK = Math.max(0, st.demoK - 1); render(); });
  $('demo-first').addEventListener('click', () => { st.demoK = 0; render(); });

  // touch-action が効かない iOS でも、素早い2回目のタップの既定動作(拡大)を止める
  let lastTouchEnd = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTouchEnd < 350) {
      e.preventDefault();
      // 既定動作を止めるとクリックも出ないので、自分で送る
      const target = e.target.closest('button, .cell');
      if (target) target.click();
    }
    lastTouchEnd = now;
  }, { passive: false });

  // 座標
  $('files').innerHTML = [9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => `<span>${n}</span>`).join('');
  $('ranks').innerHTML = ['一', '二', '三', '四', '五', '六', '七', '八', '九'].map(n => `<span>${n}</span>`).join('');

  renderHome();
})();
