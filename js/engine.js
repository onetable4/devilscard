/*
 * Devil's Card — 퍼즐 엔진
 * DOM에 의존하지 않아 브라우저(window.DC)와 Node(require) 양쪽에서 쓴다.
 *
 * 핵심 아이디어: 26장 중 4장을 고르는 경우는 C(26,4) = 14,950가지뿐이라
 * 모든 조합을 직접 대입해 "해가 정확히 하나"인지 즉시 검증할 수 있다.
 * 퍼즐 번호(시드)가 같으면 항상 같은 퍼즐이 나온다.
 */
(function (root) {
  'use strict';

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const NUM_CARDS = 26;
  const COLS = 6;
  const MIN_CLUES = 4;
  const MAX_CLUES = 7;

  const COLORS = [
    { id: 'green', name: '초록' },
    { id: 'yellow', name: '노랑' },
    { id: 'blue', name: '파랑' },
    { id: 'pink', name: '핑크' },
    { id: 'purple', name: '보라' },
  ];
  const SHAPES = [
    { id: 'diamond', name: '다이아' },
    { id: 'heart', name: '하트' },
    { id: 'square', name: '네모' },
    { id: 'star', name: '별' },
    { id: 'circle', name: '동그라미' },
  ];
  const ATTRS = {
    color: { name: '색깔', list: COLORS },
    shape: { name: '문양', list: SHAPES },
  };

  // 한 퍼즐에서 유형별로 등장할 수 있는 최대 개수
  const TYPE_LIMIT = { sum: 1, pair: 3, parity: 1, grid: 1, kinds: 2, rank: 2, same: 2 };
  const NUMBER_TYPES = ['sum', 'pair'];
  const ATTR_TYPES = ['kinds', 'rank', 'same'];
  const MIN_TYPES = 3;
  // 한 조건이 남은 후보를 이 비율 범위로 줄일 때 "적당한" 조건으로 본다
  const GOOD_MIN = 0.15;
  const GOOD_MAX = 0.7;

  // ---------------------------------------------------------------- RNG
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const next = mulberry32(seed);
    return {
      next,
      int(lo, hi) { return lo + Math.floor(next() * (hi - lo + 1)); }, // 양 끝 포함
      pick(arr) { return arr[Math.floor(next() * arr.length)]; },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
      },
    };
  }

  // 퍼즐 번호 → 시드 (인접 번호끼리도 시드가 크게 달라지도록 섞는다)
  function seedFor(n) {
    let h = Math.imul((n | 0) ^ 0x5bd1e995, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return h >>> 0;
  }

  // ---------------------------------------------------------------- 조합
  const COMBOS = [];
  for (let a = 1; a <= NUM_CARDS; a++)
    for (let b = a + 1; b <= NUM_CARDS; b++)
      for (let c = b + 1; c <= NUM_CARDS; c++)
        for (let d = c + 1; d <= NUM_CARDS; d++) COMBOS.push([a, b, c, d]);
  const N = COMBOS.length; // 14,950

  // 5종류가 "서로 다른" 장수(2~9장)로 26장을 채우는 분할 목록.
  // 장수가 모두 달라야 "가장 많은 / n번째로 많은" 순위에 동점이 생기지 않는다.
  const PARTITIONS = [];
  (function build(start, acc, sum) {
    if (acc.length === 5) { if (sum === NUM_CARDS) PARTITIONS.push(acc.slice()); return; }
    for (let v = start; v <= 9; v++) {
      if (sum + v > NUM_CARDS) break;
      acc.push(v); build(v + 1, acc, sum + v); acc.pop();
    }
  })(2, [], 0);

  // ---------------------------------------------------------------- 보드
  function makeAttribute(rng) {
    const counts = rng.shuffle(rng.pick(PARTITIONS).slice()); // counts[v] = v번 값의 장수
    const bag = [];
    counts.forEach((c, v) => { for (let i = 0; i < c; i++) bag.push(v); });
    rng.shuffle(bag);
    const values = [0].concat(bag); // values[카드번호] (1부터)
    const rankOrder = [0, 1, 2, 3, 4].sort((x, y) => counts[y] - counts[x]); // rankOrder[r] = r번째로 많은 값
    const rankOf = [];
    rankOrder.forEach((v, r) => { rankOf[v] = r; });
    return { values, counts, rankOrder, rankOf };
  }

  function makeBoard(rng) {
    return { color: makeAttribute(rng), shape: makeAttribute(rng) };
  }

  // ---------------------------------------------------------------- 조건 판정
  // 카드는 오름차순이므로 p < q 이면 combo[p] < combo[q]. 차는 항상 "큰 수 − 작은 수".
  function opValue(op, x, y) {
    return op === 'add' ? x + y : op === 'sub' ? y - x : x * y;
  }
  const OP_MIN = { add: 3, sub: 1, mul: 2 };

  function distinct4(a, b, c, d) {
    let k = 1;
    if (b !== a) k++;
    if (c !== a && c !== b) k++;
    if (d !== a && d !== b && d !== c) k++;
    return k;
  }

  function checkClue(clue, combo, board) {
    switch (clue.type) {
      case 'sum': {
        const s = combo[0] + combo[1] + combo[2] + combo[3];
        return s >= clue.min && s <= clue.max;
      }
      case 'pair': {
        const v = opValue(clue.op, combo[clue.p], combo[clue.q]);
        return v >= clue.min && v <= clue.max;
      }
      case 'parity': {
        let k = 0;
        for (let i = 0; i < 4; i++) k += combo[i] & 1;
        return k === clue.k;
      }
      case 'grid': {
        const x = combo[clue.p] - 1, y = combo[clue.q] - 1;
        return clue.axis === 'col'
          ? x % COLS === y % COLS
          : Math.floor(x / COLS) === Math.floor(y / COLS);
      }
      case 'kinds': {
        const v = board[clue.attr].values;
        return distinct4(v[combo[0]], v[combo[1]], v[combo[2]], v[combo[3]]) === clue.k;
      }
      case 'rank': {
        const a = board[clue.attr];
        return a.rankOf[a.values[combo[clue.p]]] === clue.rank;
      }
      case 'same': {
        const v = board[clue.attr].values;
        return (v[combo[clue.p]] === v[combo[clue.q]]) === clue.same;
      }
    }
    throw new Error('알 수 없는 조건 유형: ' + clue.type);
  }

  // ---------------------------------------------------------------- 조건 문장
  const ORD = ['첫 번째', '두 번째', '세 번째', '네 번째'];
  const RANK_WORD = ['가장 많은', '두 번째로 많은', '세 번째로 많은', '두 번째로 적은', '가장 적은'];
  const OP_WORD = { add: '합은', sub: '차는', mul: '곱은' };
  const COUNT_WORD = ['', '한', '두', '세'];

  function rangeText(min, max) {
    return min === max ? `${min}이다` : `${min} 이상 ${max} 이하이다`;
  }

  function clueText(c) {
    switch (c.type) {
      case 'sum':
        return `네 카드의 합은 ${rangeText(c.min, c.max)}.`;
      case 'pair':
        return `${ORD[c.p]}와 ${ORD[c.q]} 카드의 ${OP_WORD[c.op]} ${rangeText(c.min, c.max)}.`;
      case 'parity':
        if (c.k === 0) return '홀수 카드는 한 장도 없다.';
        if (c.k === 4) return '네 카드 모두 홀수이다.';
        return `홀수 카드는 ${COUNT_WORD[c.k]} 장이다.`;
      case 'grid':
        return `${ORD[c.p]}와 ${ORD[c.q]} 카드는 같은 ${c.axis === 'col' ? '세로줄' : '가로줄'}에 있다.`;
      case 'kinds': {
        const nm = ATTRS[c.attr].name;
        if (c.k === 1) return `네 카드의 ${nm}이 모두 같다.`;
        if (c.k === 4) return `네 카드의 ${nm}이 모두 다르다.`;
        return `네 카드에 사용된 ${nm}은 ${c.k}가지이다.`;
      }
      case 'rank': {
        const nm = ATTRS[c.attr].name;
        return `${ORD[c.p]} 카드의 ${nm}은 보드 전체에서 ${RANK_WORD[c.rank]} ${nm}이다.`;
      }
      case 'same': {
        const nm = ATTRS[c.attr].name;
        return `${ORD[c.p]}와 ${ORD[c.q]} 카드는 ${nm}이 ${c.same ? '같다' : '다르다'}.`;
      }
    }
    return '';
  }

  // ---------------------------------------------------------------- 생성
  // 정답에 대해 "참"인 조건 후보를 모두 만든다.
  function buildPool(ans, board, rng) {
    const pool = [];
    const S = ans[0] + ans[1] + ans[2] + ans[3];
    pool.push({ type: 'sum', min: S, max: S });
    for (let i = 0; i < 3; i++) {
      const w = rng.int(6, 16);
      const lo = Math.max(10, S - rng.int(0, w));
      pool.push({ type: 'sum', min: lo, max: lo + w });
    }

    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        for (const op of ['add', 'sub', 'mul']) {
          const v = opValue(op, ans[p], ans[q]);
          pool.push({ type: 'pair', p, q, op, min: v, max: v });
          const w = Math.max(3, Math.round(v * (0.2 + rng.next() * 0.3)));
          const lo = Math.max(OP_MIN[op], v - rng.int(0, w));
          pool.push({ type: 'pair', p, q, op, min: lo, max: lo + w });
        }
        const x = ans[p] - 1, y = ans[q] - 1;
        if (x % COLS === y % COLS) pool.push({ type: 'grid', p, q, axis: 'col' });
        if (Math.floor(x / COLS) === Math.floor(y / COLS)) pool.push({ type: 'grid', p, q, axis: 'row' });
      }
    }

    let odd = 0;
    for (let i = 0; i < 4; i++) odd += ans[i] & 1;
    pool.push({ type: 'parity', k: odd });

    for (const attr of ['color', 'shape']) {
      const a = board[attr], v = a.values;
      pool.push({ type: 'kinds', attr, k: distinct4(v[ans[0]], v[ans[1]], v[ans[2]], v[ans[3]]) });
      for (let p = 0; p < 4; p++) pool.push({ type: 'rank', attr, p, rank: a.rankOf[v[ans[p]]] });
      for (let p = 0; p < 4; p++)
        for (let q = p + 1; q < 4; q++)
          pool.push({ type: 'same', attr, p, q, same: v[ans[p]] === v[ans[q]] });
    }

    // 문장이 같은 조건은 하나만 남긴다
    const seen = new Set();
    return pool.filter((c) => {
      const key = clueText(c);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function maskOf(clue, board) {
    const m = new Uint8Array(N);
    for (let i = 0; i < N; i++) m[i] = checkClue(clue, COMBOS[i], board) ? 1 : 0;
    return m;
  }

  function countSolutions(items) {
    let count = 0;
    outer: for (let i = 0; i < N; i++) {
      for (let k = 0; k < items.length; k++) if (!items[k].mask[i]) continue outer;
      count++;
    }
    return count;
  }

  function isBalanced(clues) {
    if (clues.length < MIN_CLUES || clues.length > MAX_CLUES) return false;
    const types = new Set(clues.map((c) => c.type));
    if (types.size < MIN_TYPES) return false;
    if (!NUMBER_TYPES.some((t) => types.has(t))) return false; // 숫자 조건 최소 1개
    if (!ATTR_TYPES.some((t) => types.has(t))) return false; // 색깔/문양 조건 최소 1개
    return true;
  }

  // 정답 하나에 대해 조건 세트를 만들어 본다. 실패하면 null.
  function tryBuild(ans, board, rng) {
    const pool = buildPool(ans, board, rng).map((clue) => ({ clue, mask: maskOf(clue, board), used: false }));
    let alive = [];
    for (let i = 0; i < N; i++) alive.push(i);
    let chosen = [];
    const typeCount = {};

    while (alive.length > 1 && chosen.length < MAX_CLUES + 3) {
      const cur = alive.length;
      const good = {};
      const fallback = [];
      for (const item of pool) {
        if (item.used) continue;
        const t = item.clue.type;
        if ((typeCount[t] || 0) >= TYPE_LIMIT[t]) continue;
        let r = 0;
        const m = item.mask;
        for (let i = 0; i < cur; i++) r += m[alive[i]];
        if (r >= cur) continue; // 후보를 하나도 못 줄이는 조건
        if (r >= GOOD_MIN * cur && r <= GOOD_MAX * cur) (good[t] = good[t] || []).push(item);
        else fallback.push(item);
      }
      // 유형을 먼저 고르고 그 안에서 조건을 고른다 → 후보가 많은 유형(pair)으로 쏠리지 않음
      const types = Object.keys(good).sort();
      let pick;
      if (types.length) pick = rng.pick(good[rng.pick(types)]);
      else if (fallback.length) pick = rng.pick(fallback);
      else break;
      pick.used = true;
      chosen.push(pick);
      typeCount[pick.clue.type] = (typeCount[pick.clue.type] || 0) + 1;
      alive = alive.filter((i) => pick.mask[i]);
    }
    if (alive.length !== 1) return null;

    // 최소화: 빼도 해가 하나로 유지되는 조건은 제거 → 남은 조건은 모두 필수
    rng.shuffle(chosen);
    for (let i = 0; i < chosen.length;) {
      const rest = chosen.slice(0, i).concat(chosen.slice(i + 1));
      if (countSolutions(rest) === 1) chosen = rest;
      else i++;
    }

    const clues = chosen.map((it) => it.clue);
    return isBalanced(clues) ? clues : null;
  }

  function solutionsOf(clues, board) {
    const out = [];
    for (let i = 0; i < N; i++) {
      if (clues.every((c) => checkClue(c, COMBOS[i], board))) out.push(COMBOS[i]);
    }
    return out;
  }

  const cache = new Map();

  function generatePuzzle(n) {
    n = Math.max(1, Math.floor(Number(n)) || 1);
    if (cache.has(n)) return cache.get(n);
    const rng = makeRng(seedFor(n));
    for (let b = 0; b < 50; b++) {
      const board = makeBoard(rng);
      for (let t = 0; t < 40; t++) {
        const ans = COMBOS[Math.floor(rng.next() * N)];
        const clues = tryBuild(ans, board, rng);
        if (!clues) continue;
        // 최종 안전 검사: 판정 함수로 처음부터 다시 세어 해가 정확히 하나인지 확인
        const sols = solutionsOf(clues, board);
        if (sols.length !== 1 || sols[0] !== ans) continue;
        const puzzle = { n, board, answer: ans.slice(), clues };
        if (cache.size > 50) cache.clear();
        cache.set(n, puzzle);
        return puzzle;
      }
    }
    throw new Error('퍼즐을 만들지 못했습니다: #' + n);
  }

  // 추측(오름차순 4장)이 어긋나는 조건의 인덱스 목록
  function violations(puzzle, combo) {
    const out = [];
    puzzle.clues.forEach((c, i) => { if (!checkClue(c, combo, puzzle.board)) out.push(i); });
    return out;
  }

  function isAnswer(puzzle, combo) {
    return combo.length === 4 && combo.every((v, i) => v === puzzle.answer[i]);
  }

  const DC = {
    LETTERS, NUM_CARDS, COLS, MIN_CLUES, MAX_CLUES, COLORS, SHAPES, ATTRS,
    COMBO_COUNT: N, TYPE_LIMIT, NUMBER_TYPES, ATTR_TYPES, MIN_TYPES,
    generatePuzzle, checkClue, clueText, violations, isAnswer, solutionsOf,
  };

  if (typeof module === 'object' && module.exports) module.exports = DC;
  else root.DC = DC;
})(typeof globalThis !== 'undefined' ? globalThis : this);
