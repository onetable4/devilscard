/* Devil's Card — 화면/조작 */
(function () {
  'use strict';

  const DC = window.DC;
  const L = DC.LETTERS;
  const $ = (sel) => document.querySelector(sel);

  const STORE_KEY = 'devilscard:v1';
  const DAY_ONE = Date.UTC(2026, 0, 1); // 2026-01-01 = 오늘의 퍼즐 #1
  const MAX_PUZZLE = 99999; // 화면에서 열 수 있는 퍼즐 번호 상한 (#1 ~ #99999)

  // ---------------------------------------------------------------- 저장소
  // 브라우저 저장소는 막혀 있을 수 있으므로 실패해도 게임은 그대로 돈다.
  function loadStore() {
    try {
      const data = JSON.parse(localStorage.getItem(STORE_KEY));
      if (data && typeof data === 'object') return Object.assign({ p: {}, prefs: {} }, data);
    } catch (e) { /* 무시 */ }
    return { p: {}, prefs: {} };
  }
  const saved = loadStore();
  function writeStore() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch (e) { /* 무시 */ }
  }

  // ---------------------------------------------------------------- 상태
  const state = {
    n: 0,
    puzzle: null,
    selected: [], // 고른 순서 그대로 (Backspace용)
    marked: new Set(),
    struck: new Set(),
    guesses: [], // { combo, bad: [위반 조건 인덱스] }
    solved: false,
    gaveUp: false,
    elapsed: 0,
    startedAt: 0,
    running: false, // 시작(또는 계속하기)을 눌러 진행 중인가. false면 조건·카드를 가리고 시간을 멈춘다
    mode: 'select',
    highlight: null, // { attr, v }
    showCounts: !!saved.prefs.counts,
    showHelper: !!saved.prefs.helper, // 색깔·문양 범례(강조/장수 표시). 기본은 숨김
  };

  const finished = () => state.solved || state.gaveUp;
  const gated = () => !state.running && !finished();
  const elapsedNow = () =>
    (finished() || !state.running ? state.elapsed : state.elapsed + (Date.now() - state.startedAt));

  // 시작/계속하기: 가림막을 걷고 시간을 흐르게 한다
  function startGame() {
    if (!gated()) return;
    state.running = true;
    state.startedAt = Date.now();
    renderAll();
  }
  // 일시정지: 지금까지 시간을 고정하고 다시 가린다
  function pauseGame() {
    if (!state.running || finished()) return;
    state.elapsed = elapsedNow();
    state.running = false;
    state.selected = [];
    state.highlight = null;
    persist();
    renderLegend();
    renderAll();
  }

  // 1 ~ MAX_PUZZLE 범위의 정수만 퍼즐 번호로 인정한다. 아니면 0
  function parsePuzzleNo(v) {
    const s = String(v == null ? '' : v).trim();
    if (!/^\d{1,9}$/.test(s)) return 0;
    const n = Number(s);
    return n >= 1 && n <= MAX_PUZZLE ? n : 0;
  }
  const RANGE_MSG = `퍼즐 번호는 1~${MAX_PUZZLE}까지 있어요`;
  const sorted = (arr) => arr.slice().sort((a, b) => a - b);
  const word = (combo) => combo.map((v) => L[v - 1]).join('');
  const sameCombo = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  function todayNumber() {
    const d = new Date();
    const n = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - DAY_ONE) / 86400000) + 1;
    return Math.min(MAX_PUZZLE, Math.max(1, n));
  }

  function fmtTime(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const pad = (x) => String(x).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  }

  // ---------------------------------------------------------------- 진행 저장
  function persist() {
    if (!state.puzzle) return;
    const hasProgress = state.guesses.length || state.marked.size || state.struck.size || finished() || elapsedNow() >= 1000;
    if (!hasProgress) { delete saved.p[state.n]; writeStore(); return; }
    saved.p[state.n] = {
      h: state.guesses.map((g) => g.combo),
      m: [...state.marked],
      s: [...state.struck],
      w: state.solved ? 1 : 0,
      g: state.gaveUp ? 1 : 0,
      t: elapsedNow(),
    };
    writeStore();
  }

  // ---------------------------------------------------------------- 퍼즐 불러오기
  function loadPuzzle(raw) {
    const n = parsePuzzleNo(raw);
    if (!n) {
      toast(RANGE_MSG);
      if (state.puzzle) renderHeader(); // 입력칸을 현재 번호로 되돌림
      return false;
    }
    if (state.puzzle) persist();

    let puzzle;
    try {
      puzzle = DC.generatePuzzle(n);
    } catch (e) {
      toast('퍼즐을 만들지 못했어요. 다른 번호를 골라 주세요.');
      return;
    }

    const resultDlg = $('#result-dialog');
    if (resultDlg.open) resultDlg.close();

    const prog = saved.p[n] || {};
    state.n = n;
    state.puzzle = puzzle;
    state.guesses = (prog.h || []).map((combo) => ({ combo, bad: DC.violations(puzzle, combo) }));
    state.marked = new Set(prog.m || []);
    state.struck = new Set(prog.s || []);
    state.solved = !!prog.w;
    state.gaveUp = !!prog.g;
    state.elapsed = prog.t || 0;
    state.startedAt = Date.now();
    state.running = false; // 새로 연 퍼즐은 항상 시작 버튼부터
    state.selected = finished() ? puzzle.answer.slice() : [];
    state.highlight = null;

    if (location.hash !== '#' + n) {
      try { history.replaceState(null, '', '#' + n); } catch (e) { location.hash = String(n); }
    }

    buildBoard();
    buildClues();
    renderLegend();
    renderAll();
    return true;
  }

  // ---------------------------------------------------------------- 카드
  function cardMarkup(n, board) {
    const color = DC.COLORS[board.color.values[n]];
    const shape = DC.SHAPES[board.shape.values[n]];
    return {
      color,
      shape,
      html:
        `<span class="card-letter">${L[n - 1]}</span>` +
        `<svg class="card-shape" viewBox="0 0 24 24" aria-hidden="true"><use href="#s-${shape.id}"/></svg>` +
        `<span class="card-num">${n}</span>` +
        `<span class="card-badge"></span>`,
    };
  }

  function buildBoard() {
    const el = $('#board');
    el.textContent = '';
    const board = state.puzzle.board;
    for (let n = 1; n <= DC.NUM_CARDS; n++) {
      const { color, shape, html } = cardMarkup(n, board);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `card c-${color.id}`;
      btn.dataset.n = n;
      btn.title = `${color.name} ${shape.name}`;
      btn.dataset.label = `${L[n - 1]} ${n}, ${color.name} ${shape.name}`;
      btn.innerHTML = html;
      el.appendChild(btn);
    }
  }

  function renderCards() {
    const order = sorted(state.selected);
    const answer = new Set(finished() ? state.puzzle.answer : []);
    const board = state.puzzle.board;
    const hl = state.highlight;
    const boardEl = $('#board');
    boardEl.classList.toggle('mode-mark', state.mode === 'mark');
    boardEl.classList.toggle('finished', finished());

    boardEl.querySelectorAll('.card').forEach((btn) => {
      const n = Number(btn.dataset.n);
      const sel = state.selected.includes(n);
      const marked = state.marked.has(n);
      btn.classList.toggle('selected', sel && !answer.has(n));
      btn.classList.toggle('answer', answer.has(n));
      btn.classList.toggle('marked', marked && !answer.has(n));
      btn.classList.toggle('dim', !!hl && board[hl.attr].values[n] !== hl.v);
      btn.classList.toggle('faded', finished() && !answer.has(n)); // 끝나면 정답 4장만 또렷하게
      btn.querySelector('.card-badge').textContent = sel ? String(order.indexOf(n) + 1) : '';
      let label = btn.dataset.label;
      if (sel) label += `, 선택됨 (${order.indexOf(n) + 1}번째)`;
      if (marked) label += ', 지움 표시';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('aria-pressed', sel ? 'true' : 'false');
    });
  }

  function shakeCard(n) {
    const btn = document.querySelector(`.card[data-n="${n}"]`);
    if (!btn) return;
    btn.classList.remove('shake');
    void btn.offsetWidth;
    btn.classList.add('shake');
  }

  function toggleSelect(n) {
    if (gated() || finished() || n < 1 || n > DC.NUM_CARDS) return;
    const i = state.selected.indexOf(n);
    if (i >= 0) {
      state.selected.splice(i, 1);
    } else {
      if (state.selected.length >= 4) {
        shakeCard(n);
        toast('카드는 4장까지 고를 수 있어요');
        return;
      }
      state.selected.push(n);
      state.marked.delete(n);
    }
    renderAll();
  }

  function toggleMark(n) {
    if (gated() || finished()) return;
    if (state.marked.has(n)) state.marked.delete(n);
    else {
      state.marked.add(n);
      const i = state.selected.indexOf(n);
      if (i >= 0) state.selected.splice(i, 1);
    }
    persist();
    renderAll();
  }

  // ---------------------------------------------------------------- 조건
  function buildClues() {
    const el = $('#clues');
    el.textContent = '';
    state.puzzle.clues.forEach((c, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'clue';
      btn.dataset.i = i;
      // 문장은 엔진이 만든 고정 텍스트이므로 숫자만 강조한다
      btn.innerHTML = `<span class="clue-no">${i + 1}</span><span class="clue-text">${DC.clueText(c).replace(/(\d+)/g, '<b>$1</b>')}</span>`;
      li.appendChild(btn);
      el.appendChild(li);
    });
  }

  function renderClues() {
    document.querySelectorAll('.clue').forEach((btn) => {
      const struck = state.struck.has(Number(btn.dataset.i));
      btn.classList.toggle('struck', struck);
      btn.setAttribute('aria-pressed', struck ? 'true' : 'false');
    });
  }

  function flashClues(indices) {
    indices.forEach((i) => {
      const btn = document.querySelector(`.clue[data-i="${i}"]`);
      if (!btn) return;
      btn.classList.remove('flash');
      void btn.offsetWidth;
      btn.classList.add('flash');
    });
  }

  // ---------------------------------------------------------------- 범례
  function renderLegend() {
    const toggle = $('#helper-toggle');
    toggle.textContent = state.showHelper ? '색깔·문양 도우미 숨기기' : '색깔·문양 도우미 보기';
    toggle.setAttribute('aria-expanded', String(state.showHelper));
    $('#legend').hidden = !state.showHelper;
    if (!state.showHelper) return;

    const board = state.puzzle.board;
    const row = (attr) => {
      const info = DC.ATTRS[attr];
      const items = info.list.map((item, v) => {
        const on = !!state.highlight && state.highlight.attr === attr && state.highlight.v === v;
        const icon = attr === 'color'
          ? `<span class="swatch" style="--ink:var(--c-${item.id})"></span>`
          : `<svg class="legend-shape" viewBox="0 0 24 24" aria-hidden="true"><use href="#s-${item.id}"/></svg>`;
        const count = state.showCounts ? `<b class="legend-count">${board[attr].counts[v]}</b>` : '';
        return `<button type="button" class="legend-item${on ? ' on' : ''}" data-attr="${attr}" data-v="${v}" aria-pressed="${on}">${icon}<span>${item.name}</span>${count}</button>`;
      }).join('');
      return `<div class="legend-row"><span class="legend-label">${info.name}</span>${items}</div>`;
    };
    $('#legend').innerHTML =
      row('color') + row('shape') +
      `<div class="legend-foot"><span>범례를 누르면 해당 카드만 강조돼요</span>` +
      `<label class="count-toggle"><input type="checkbox" id="count-toggle"${state.showCounts ? ' checked' : ''}> 장수 표시</label></div>`;
  }

  // ---------------------------------------------------------------- 입력칸 / 기록 / 헤더
  function renderSlots() {
    const order = sorted(state.selected);
    const gold = finished();
    $('#slots').innerHTML = [0, 1, 2, 3].map((i) => {
      const n = order[i];
      if (!n) return '<div class="slot">·</div>';
      return `<div class="slot filled${gold ? ' gold' : ''}">${L[n - 1]}<small>${n}</small></div>`;
    }).join('');
    $('#submit').disabled = finished() || state.selected.length !== 4;
    $('#clear').disabled = finished() || state.selected.length === 0;
  }

  function dotsHtml(bad, total) {
    let html = '<span class="dots">';
    for (let i = 0; i < total; i++) {
      const isBad = bad.includes(i);
      html += `<i class="dot ${isBad ? 'bad' : 'ok'}" title="조건 ${i + 1} ${isBad ? '위반' : '만족'}">${i + 1}</i>`;
    }
    return html + '</span>';
  }

  function renderHistory() {
    const el = $('#history');
    const total = state.puzzle.clues.length;
    if (!state.guesses.length) {
      el.innerHTML = '<li class="empty">아직 시도가 없어요. 틀리면 어긋난 조건이 빨갛게 표시돼요.</li>';
      return;
    }
    el.innerHTML = state.guesses.map((g, i) => {
      const win = g.bad.length === 0;
      const msg = win ? '정답!' : `${g.bad.length}개 위반`;
      return `<li class="guess${win ? ' win' : ''}"><span class="guess-no">${i + 1}</span><span class="guess-word">${word(g.combo)}</span>${dotsHtml(g.bad, total)}<span class="guess-msg">${msg}</span></li>`;
    }).reverse().join('');
  }

  function renderHeader() {
    const input = $('#puzzle-num');
    if (document.activeElement !== input) input.value = state.n;
    $('#today').classList.toggle('active', state.n === todayNumber());
    $('#prev').disabled = state.n <= 1;
    $('#next').disabled = state.n >= MAX_PUZZLE;
    const status = $('#status');
    status.className = 'status';
    if (state.solved) { status.textContent = `해결 · ${state.guesses.length}번 시도`; status.classList.add('win'); }
    else if (state.gaveUp) { status.textContent = '정답 공개됨'; status.classList.add('lose'); }
    else status.textContent = state.guesses.length ? `${state.guesses.length}번 시도` : `${state.puzzle.clues.length}개 조건`;
    $('#giveup').disabled = finished();
    $('#mode-select').setAttribute('aria-pressed', String(state.mode === 'select'));
    $('#mode-mark').setAttribute('aria-pressed', String(state.mode === 'mark'));
    document.title = `Devil's Card #${state.n}`;
  }

  function renderTimer() {
    if (state.puzzle) $('#timer').textContent = fmtTime(elapsedNow());
  }

  // 시작 전/일시정지: 조건·카드를 블러로 가리고, 입력칸 자리에 시작 버튼을 보여준다
  function renderGate() {
    const g = gated();
    document.querySelectorAll('.gate-wrap').forEach((el) => {
      el.classList.toggle('gated', g);
      // inert: 가려진 동안 클릭·탭 이동·스크린리더 접근을 모두 막는다
      el.querySelectorAll(':scope > :not(.veil)').forEach((child) => { child.inert = g; });
    });
    $('#start-view').hidden = !g;
    $('#play-view').hidden = g;
    $('#pause').hidden = g || finished();
    $('.board-tools .seg').classList.toggle('disabled', g);
    if (g) {
      const resumed = state.elapsed >= 1000 || state.guesses.length > 0;
      $('#start-title').textContent = `#${state.n} · 조건 ${state.puzzle.clues.length}개`;
      $('#start').textContent = resumed ? '계속하기' : '시작하기';
      $('#start-hint').textContent = resumed
        ? `${fmtTime(state.elapsed)}에서 이어서 시간이 흘러요`
        : '시작을 누르면 조건과 카드가 공개되고 시간이 흐르기 시작해요';
    }
  }

  function renderAll() {
    renderGate();
    renderCards();
    renderClues();
    renderSlots();
    renderHistory();
    renderHeader();
    renderTimer();
  }

  // ---------------------------------------------------------------- 제출 / 결과
  function endGame(kind) {
    state.elapsed = elapsedNow(); // finished() 가 되기 전에 시간을 고정
    state.running = false;
    if (kind === 'win') state.solved = true;
    else state.gaveUp = true;
    state.selected = state.puzzle.answer.slice();
    state.mode = 'select';
    state.highlight = null;
    renderLegend();
  }

  function submit() {
    if (gated() || finished()) return;
    if (state.selected.length !== 4) { toast('카드 4장을 골라 주세요'); return; }
    const combo = sorted(state.selected);
    if (state.guesses.some((g) => sameCombo(g.combo, combo))) { toast('이미 시도한 조합이에요'); return; }

    const bad = DC.violations(state.puzzle, combo);
    state.guesses.push({ combo, bad });
    if (DC.isAnswer(state.puzzle, combo)) {
      endGame('win');
      persist();
      renderAll();
      setTimeout(showResult, 450);
    } else {
      persist();
      renderAll();
      flashClues(bad);
      toast(`${word(combo)} — 조건 ${bad.map((i) => i + 1).join(', ')}번에 맞지 않아요`);
    }
  }

  function giveUp() {
    if (finished()) return;
    if (!confirm('정답을 공개할까요? 이 퍼즐은 포기로 기록돼요.')) return;
    endGame('giveup');
    persist();
    renderAll();
    showResult();
  }

  function showResult() {
    const P = state.puzzle;
    $('#result-title').textContent = state.solved ? '정답!' : '정답은 이거였어요';
    $('#result-cards').innerHTML = P.answer.map((n) => {
      const { color, html } = cardMarkup(n, P.board);
      return `<div class="card c-${color.id}">${html}</div>`;
    }).join('');
    const solvedCount = Object.values(saved.p).filter((x) => x && x.w).length;
    $('#result-meta').innerHTML = state.solved
      ? `#${state.n} · ${state.guesses.length}번 만에 성공 · ${fmtTime(state.elapsed)}<br><small>지금까지 ${solvedCount}개 해결</small>`
      : `#${state.n} · ${state.guesses.length}번 시도 후 포기 · ${fmtTime(state.elapsed)}`;
    const total = P.clues.length;
    $('#result-grid').innerHTML = state.guesses.map((g) => dotsHtml(g.bad, total)).join('');
    const dlg = $('#result-dialog');
    if (!dlg.open) dlg.showModal();
  }

  function shareText() {
    const P = state.puzzle;
    const lines = [`Devil's Card #${state.n}`];
    lines.push(state.solved
      ? `✅ ${state.guesses.length}번 만에 성공 · ${fmtTime(state.elapsed)}`
      : `🏳️ 포기 · ${fmtTime(state.elapsed)}`);
    state.guesses.forEach((g) => lines.push(P.clues.map((_, i) => (g.bad.includes(i) ? '🟥' : '🟩')).join('')));
    if (/^https?:$/.test(location.protocol)) lines.push(location.href);
    return lines.join('\n');
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  // ---------------------------------------------------------------- 토스트
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------------------------------------------------------------- 이벤트
  function bindEvents() {
    const boardEl = $('#board');
    // 길게 누르기(터치)와 contextmenu(안드로이드·마우스 오른쪽) 중 먼저 온 쪽만 ✕ 표시를 토글한다
    let pressTimer = 0, touchDown = false, longPressed = false, lastMark = 0, pressX = 0, pressY = 0;
    function markByPress(n) {
      clearTimeout(pressTimer);
      if (Date.now() - lastMark < 800) return;
      lastMark = Date.now();
      longPressed = touchDown; // 터치였다면 뒤따르는 click 한 번을 무시
      toggleMark(n);
      if (touchDown && navigator.vibrate) navigator.vibrate(15);
    }

    boardEl.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      if (longPressed) { longPressed = false; return; }
      const n = Number(card.dataset.n);
      if (state.mode === 'mark') toggleMark(n);
      else toggleSelect(n);
    });
    boardEl.addEventListener('contextmenu', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      e.preventDefault();
      markByPress(Number(card.dataset.n));
    });
    boardEl.addEventListener('pointerdown', (e) => {
      longPressed = false;
      if (e.pointerType !== 'touch') return;
      const card = e.target.closest('.card');
      if (!card) return;
      touchDown = true;
      pressX = e.clientX; pressY = e.clientY;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => markByPress(Number(card.dataset.n)), 480);
    });
    boardEl.addEventListener('pointermove', (e) => {
      if (touchDown && Math.hypot(e.clientX - pressX, e.clientY - pressY) > 10) clearTimeout(pressTimer);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => {
      boardEl.addEventListener(type, () => { clearTimeout(pressTimer); touchDown = false; });
    });

    $('#clues').addEventListener('click', (e) => {
      const btn = e.target.closest('.clue');
      if (!btn || gated()) return;
      const i = Number(btn.dataset.i);
      if (state.struck.has(i)) state.struck.delete(i);
      else state.struck.add(i);
      persist();
      renderClues();
    });

    $('#legend').addEventListener('click', (e) => {
      const item = e.target.closest('.legend-item');
      if (!item) return;
      const attr = item.dataset.attr, v = Number(item.dataset.v);
      const on = state.highlight && state.highlight.attr === attr && state.highlight.v === v;
      state.highlight = on ? null : { attr, v };
      renderLegend();
      renderCards();
    });
    $('#legend').addEventListener('change', (e) => {
      if (e.target.id !== 'count-toggle') return;
      state.showCounts = e.target.checked;
      saved.prefs.counts = state.showCounts;
      writeStore();
      renderLegend();
    });

    $('#helper-toggle').addEventListener('click', () => {
      state.showHelper = !state.showHelper;
      if (!state.showHelper) state.highlight = null; // 숨기면 강조도 해제
      saved.prefs.helper = state.showHelper;
      writeStore();
      renderLegend();
      renderCards();
    });

    $('#mode-select').addEventListener('click', () => { state.mode = 'select'; renderAll(); });
    $('#mode-mark').addEventListener('click', () => { if (!finished()) { state.mode = 'mark'; renderAll(); } });
    $('#submit').addEventListener('click', submit);
    $('#clear').addEventListener('click', () => { state.selected = []; renderAll(); });
    $('#giveup').addEventListener('click', giveUp);
    $('#start').addEventListener('click', startGame);
    $('#pause').addEventListener('click', pauseGame);

    $('#prev').addEventListener('click', () => loadPuzzle(state.n - 1));
    $('#next').addEventListener('click', () => loadPuzzle(state.n + 1));
    $('#today').addEventListener('click', () => loadPuzzle(todayNumber()));
    $('#random').addEventListener('click', () => loadPuzzle(1 + Math.floor(Math.random() * 99999)));
    const numInput = $('#puzzle-num');
    // 숫자만, 최대 5자리
    numInput.addEventListener('input', () => {
      const clean = numInput.value.replace(/\D/g, '').slice(0, 5);
      if (clean !== numInput.value) numInput.value = clean;
    });
    numInput.addEventListener('change', () => {
      if (numInput.value === String(state.n)) return;
      if (!loadPuzzle(numInput.value)) numInput.value = state.n; // 범위 밖이면 현재 번호로 되돌림
    });
    numInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') numInput.blur(); });

    $('#help-btn').addEventListener('click', () => $('#help-dialog').showModal());
    $('#share-btn').addEventListener('click', () => {
      copyText(shareText()).then(() => toast('결과를 복사했어요'), () => toast('복사하지 못했어요'));
    });
    $('#next-btn').addEventListener('click', () => {
      $('#result-dialog').close();
      loadPuzzle(state.n + 1);
    });
    // 다이얼로그 바깥(배경)을 누르면 닫기
    document.querySelectorAll('dialog').forEach((dlg) => {
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    });

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;

      // 시작 전/일시정지: Enter·Space로 시작, 그 외 키는 무시
      if (gated()) {
        if ((e.key === 'Enter' || e.key === ' ') && !(t && t.closest && t.closest('button, a'))) {
          e.preventDefault();
          startGame();
        }
        return;
      }

      // e.code(물리 키)를 쓰면 한글 입력 상태에서도 알파벳 키로 카드를 고를 수 있다
      const letter = /^Key[A-Z]$/.test(e.code) ? e.code[3]
        : /^[a-zA-Z]$/.test(e.key) ? e.key.toUpperCase() : '';
      if (letter) {
        e.preventDefault();
        toggleSelect(letter.charCodeAt(0) - 64);
      } else if (e.key === 'Enter') {
        // 다른 버튼(조건, 범례, 메뉴)에 포커스가 있으면 그 버튼의 기본 동작을 따른다.
        // 카드에 포커스가 있을 때는 카드 토글 대신 제출한다.
        if (t && t.closest && t.closest('button:not(.card), a')) return;
        e.preventDefault();
        submit();
      } else if (e.key === 'Backspace') {
        if (finished() || !state.selected.length) return;
        e.preventDefault();
        state.selected.pop();
        renderAll();
      } else if (e.key === 'Escape') {
        if (state.highlight) { state.highlight = null; renderLegend(); renderCards(); }
      }
    });

    window.addEventListener('hashchange', () => {
      const raw = location.hash.slice(1);
      if (raw === String(state.n)) return;
      if (!loadPuzzle(raw)) {
        try { history.replaceState(null, '', '#' + state.n); } catch (e) { /* 무시 */ }
      }
    });
    // 다른 탭/앱으로 가면 자동 일시정지 (돌아와서 '계속하기')
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { pauseGame(); persist(); }
    });
    window.addEventListener('pagehide', persist);
  }

  // ---------------------------------------------------------------- 시작
  bindEvents();
  const hashRaw = location.hash.slice(1);
  if (!(hashRaw && loadPuzzle(hashRaw))) loadPuzzle(todayNumber()); // 범위 밖 번호면 오늘의 퍼즐로
  setInterval(renderTimer, 1000);

  if (!saved.prefs.seenHelp) {
    saved.prefs.seenHelp = true;
    writeStore();
    $('#help-dialog').showModal();
  }
})();
