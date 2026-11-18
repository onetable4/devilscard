/*
 * Devil's Card — 사람처럼 푸는 풀이기
 *
 * 생성기는 14,950개 조합을 전부 대입해 "해가 하나"인지만 확인한다.
 * 풀이기는 사람이 추론하는 방식을 흉내 내 "얼마나 어렵게 풀리는지"를 잰다.
 *
 *  - 첫 번째~네 번째 카드 자리마다 들어갈 수 있는 숫자 후보를 들고 시작한다.
 *  - 한 번에 조건 하나만 보고, 그 조건과 지금 후보로 불가능해진 숫자를 지운다.
 *    (오름차순 조건은 항상 함께 고려) 쉬운 조건부터 시도하고, 후보가 줄면
 *    다시 가장 쉬운 조건부터 본다.
 *  - 조건 하나씩으로 막히면 쉬운 기법부터:
 *      경우 따지기   남은 조합이 몇 개 안 되면 하나씩 대입
 *      두 조건 함께  조건 두 개를 동시에 만족하는지로 지움
 *      가정해보기    한 자리를 한 숫자로 가정해 모순이 나면 지움(귀류법)
 *  - 그래도 막히면 사람이 추론으로 풀기 어려운 퍼즐(매우 어려움)로 본다.
 */
(function (root) {
  'use strict';

  const DC = typeof module === 'object' && module.exports ? require('./engine.js') : root.DC;

  const ORD = ['첫 번째', '두 번째', '세 번째', '네 번째'];

  // 기법 (번호가 클수록 어려움)
  const L_DIRECT = 1; // 한 자리만 보면 되는 조건 (보드 순위, 전부 짝수/홀수)
  const L_PAIR = 2; // 두 자리 관계 (합·차·곱, 같음/다름, 같은 줄)
  const L_GLOBAL = 3; // 네 자리를 함께 봐야 하는 조건 (총합, 종류 수, 홀짝 개수)
  const L_CASES = 4; // 경우 따지기
  const L_TWO = 5; // 두 조건 함께
  const L_HYPO = 6; // 가정해보기
  const LEVEL_NAME = {
    1: '직접', 2: '두 카드 관계', 3: '네 카드 종합',
    4: '경우 따지기', 5: '두 조건 함께', 6: '가정해보기',
  };
  const LEVEL_WEIGHT = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 6, 6: 10 };
  const CASES_MAX = 6; // 남은 조합이 이 이하면 하나씩 대입해 끝낸다

  function clueLevel(c) {
    switch (c.type) {
      case 'rank': return L_DIRECT;
      case 'parity': return c.k === 0 || c.k === 4 ? L_DIRECT : L_GLOBAL;
      case 'pair': case 'same': case 'grid': return L_PAIR;
      default: return L_GLOBAL; // sum, kinds
    }
  }

  // ---------------------------------------------------------------- 비트마스크 후보
  // 숫자 n(1~26)의 후보 여부를 (1 << n) 비트로 표현한다.
  let FULL = 0;
  for (let n = 1; n <= DC.NUM_CARDS; n++) FULL |= 1 << n;

  function bitsOf(m) {
    const out = [];
    while (m) {
      const low = m & -m;
      out.push(31 - Math.clz32(low));
      m ^= low;
    }
    return out;
  }
  function popcount(m) {
    let c = 0;
    while (m) { m &= m - 1; c++; }
    return c;
  }
  const sameDom = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
  const isSolved = (dom) => dom.every((m) => popcount(m) === 1);
  const hasEmpty = (dom) => dom.some((m) => m === 0);

  // 지금 후보에서 나올 수 있는 오름차순 4장 조합을 하나씩 넘겨준다. fn이 true를 돌려주면 중단
  function eachTuple(dom, fn) {
    const A = bitsOf(dom[0]), B = bitsOf(dom[1]), C = bitsOf(dom[2]), D = bitsOf(dom[3]);
    const t = [0, 0, 0, 0];
    for (const a of A) {
      t[0] = a;
      for (const b of B) {
        if (b <= a) continue;
        t[1] = b;
        for (const c of C) {
          if (c <= b) continue;
          t[2] = c;
          for (const d of D) {
            if (d <= c) continue;
            t[3] = d;
            if (fn(t)) return;
          }
        }
      }
    }
  }

  // 조건들(빈 배열이면 오름차순만)을 "동시에" 만족하는 조합이 있는 숫자만 남긴다
  function applyClues(dom, clues, board) {
    const sup = [0, 0, 0, 0];
    eachTuple(dom, (t) => {
      for (let k = 0; k < clues.length; k++) if (!DC.checkClue(clues[k], t, board)) return false;
      sup[0] |= 1 << t[0]; sup[1] |= 1 << t[1]; sup[2] |= 1 << t[2]; sup[3] |= 1 << t[3];
      return sameDom(sup, dom); // 모든 후보가 이미 살아남았으면 더 볼 필요 없음
    });
    return sup;
  }

  function countTuples(dom, limit) {
    let n = 0;
    eachTuple(dom, () => ++n > limit);
    return n;
  }

  // 조건 하나씩 반복 적용 (가정해보기 내부용, 기록 없음). 모순이면 null
  function propagate(dom, clues, board) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of clues) {
        const nd = applyClues(dom, [c], board);
        if (hasEmpty(nd)) return null;
        if (!sameDom(nd, dom)) { dom = nd; changed = true; }
      }
    }
    return dom;
  }

  // 후보가 적은 자리부터 숫자 하나씩 가정 → 모순이 나는 첫 숫자를 지운다
  function hypothesize(dom, clues, board) {
    const order = [0, 1, 2, 3]
      .filter((p) => popcount(dom[p]) > 1)
      .sort((x, y) => popcount(dom[x]) - popcount(dom[y]) || x - y);
    for (const p of order) {
      for (const v of bitsOf(dom[p])) {
        const test = dom.slice();
        test[p] = 1 << v;
        if (propagate(test, clues, board) === null) {
          const after = dom.slice();
          after[p] &= ~(1 << v);
          return { pos: p, value: v, after };
        }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- 풀이
  function solve(puzzle, opts) {
    const maxSteps = (opts && opts.maxSteps) || 400;
    const { clues, board } = puzzle;
    const start = applyClues([FULL, FULL, FULL, FULL], [], board); // 오름차순만으로: 첫 번째 ≤ 23 등
    let dom = start;
    const steps = [];
    const byEase = clues
      .map((c, i) => ({ c, i, level: clueLevel(c) }))
      .sort((x, y) => x.level - y.level || x.i - y.i);
    const pairs = [];
    for (let x = 0; x < byEase.length; x++)
      for (let y = x + 1; y < byEase.length; y++) pairs.push([byEase[x], byEase[y]]);
    pairs.sort((u, v) => (u[0].level + u[1].level) - (v[0].level + v[1].level));

    const push = (step) => { steps.push(step); dom = step.after; };

    while (!isSolved(dom) && steps.length < maxSteps) {
      // 1) 조건 하나씩 — 쉬운 조건부터
      let nd = null, hit = null;
      for (const it of byEase) {
        const r = applyClues(dom, [it.c], board);
        if (!sameDom(r, dom)) { nd = r; hit = it; break; }
      }
      if (hit) { push({ kind: 'clue', level: hit.level, clue: hit.i, before: dom, after: nd }); continue; }

      // 2) 경우 따지기 — 남은 조합이 적으면 전부 대입
      const remain = countTuples(dom, CASES_MAX);
      if (remain <= CASES_MAX) {
        push({ kind: 'cases', level: L_CASES, count: remain, before: dom, after: applyClues(dom, clues, board) });
        continue;
      }

      // 3) 두 조건 함께
      for (const [u, v] of pairs) {
        const r = applyClues(dom, [u.c, v.c], board);
        if (!sameDom(r, dom)) { nd = r; hit = [u.i, v.i].sort((a, b) => a - b); break; }
      }
      if (hit) { push({ kind: 'two', level: L_TWO, clues: hit, before: dom, after: nd }); continue; }

      // 4) 가정해보기
      const h = hypothesize(dom, clues, board);
      if (!h) break;
      push({ kind: 'hypo', level: L_HYPO, pos: h.pos, value: h.value, before: dom, after: h.after });
    }

    const solved = isSolved(dom);
    const answer = solved ? dom.map((m) => bitsOf(m)[0]) : null;
    return { solved, answer, start, final: dom, steps, rating: rate(solved, steps) };
  }

  // ---------------------------------------------------------------- 난이도
  const TIERS = [
    { id: 'easy', label: '쉬움' },
    { id: 'normal', label: '보통' },
    { id: 'hard', label: '어려움' },
    { id: 'extreme', label: '매우 어려움' },
  ];
  // 등급 기준. "고급 기법" = 두 조건 함께 + 가정해보기.
  // 퍼즐 2,000개 분포(쉬움 22% · 보통 53% · 어려움 22% · 매우 어려움 3.5%)를 보고 맞춘 값이며
  // 실제 플레이 기록이 쌓이면 다시 맞추는 것이 좋다.
  const EASY_MAX_SCORE = 14; // 고급 기법 없이 단계 점수가 이 이하 → 쉬움
  const NORMAL_MAX_ADVANCED = 2; // 가정 없이 두 조건 함께 ≤ 2회 → 보통
  const HARD_MAX_ADVANCED = 8; // 고급 기법 ≤ 8회이고
  const HARD_MAX_HYPO = 3; //   가정해보기 ≤ 3회 → 어려움, 넘으면 매우 어려움

  function rate(solved, steps) {
    const count = {};
    let score = 0, maxLevel = 0, advanced = 0, hypo = 0;
    for (const s of steps) {
      count[s.level] = (count[s.level] || 0) + 1;
      score += LEVEL_WEIGHT[s.level];
      maxLevel = Math.max(maxLevel, s.level);
      if (s.level >= L_TWO) advanced++;
      if (s.level === L_HYPO) hypo++;
    }
    let tier;
    if (!solved || advanced > HARD_MAX_ADVANCED || hypo > HARD_MAX_HYPO) tier = 3;
    else if (hypo > 0 || advanced > NORMAL_MAX_ADVANCED) tier = 2;
    else if (advanced > 0 || score > EASY_MAX_SCORE) tier = 1;
    else tier = 0;
    return { tier, id: TIERS[tier].id, label: TIERS[tier].label, score, advanced, hypo, count, maxLevel };
  }

  // ---------------------------------------------------------------- 설명
  function domText(m, limit) {
    const ns = bitsOf(m);
    if (ns.length > (limit || 8)) return `${ns.length}개`;
    return ns.map((n) => DC.LETTERS[n - 1] + n).join(' ');
  }

  // 숫자 뒤 조사: 받침 있는 숫자(0 1 3 6 7 8) → '과/을', 없는 숫자 → '와/를'
  const josa = (n, withBatchim, without) => ([0, 1, 3, 6, 7, 8].includes(n % 10) ? withBatchim : without);

  function describeStep(step, puzzle) {
    const changes = [];
    for (let p = 0; p < 4; p++) {
      if (step.before[p] === step.after[p]) continue;
      changes.push(`${ORD[p]} ${popcount(step.before[p])}→${popcount(step.after[p])}개` +
        (popcount(step.after[p]) <= 8 ? ` (${domText(step.after[p])})` : ''));
    }
    let head;
    switch (step.kind) {
      case 'clue':
        head = `[${LEVEL_NAME[step.level]}] 조건 ${step.clue + 1} 「${DC.clueText(puzzle.clues[step.clue])}」`;
        break;
      case 'cases':
        head = `[경우 따지기] 남은 조합 ${step.count}개를 조건에 하나씩 대입`;
        break;
      case 'two':
      {
        const a = step.clues[0] + 1, b = step.clues[1] + 1;
        head = `[두 조건 함께] 조건 ${a}${josa(a, '과', '와')} 조건 ${b}${josa(b, '을', '를')} 동시에 만족하는지 확인`;
      }
        break;
      default:
        head = `[가정해보기] ${ORD[step.pos]} 카드가 ${DC.LETTERS[step.value - 1]}(${step.value})라고 하면 모순 → 제외`;
    }
    return { head, changes };
  }

  const Solver = { solve, rate, describeStep, domText, clueLevel, LEVEL_NAME, TIERS, ORD, popcount, bitsOf };

  if (typeof module === 'object' && module.exports) module.exports = Solver;
  else root.DCSolver = Solver;
})(typeof globalThis !== 'undefined' ? globalThis : this);
