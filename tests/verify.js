/*
 * 퍼즐 엔진 검증: node tests/verify.js [개수]
 *  - 해가 정확히 하나이고 정답과 일치하는지 (판정 함수로 전수 검사)
 *  - 모든 조건이 필수인지 (하나라도 빼면 해가 2개 이상)
 *  - 조건 개수 4~7, 유형 제한/다양성 규칙
 *  - 같은 번호 → 같은 퍼즐 (결정성)
 *  - 색깔/문양 장수에 동점이 없는지
 */
'use strict';
const DC = require('../js/engine.js');

const COUNT = Number(process.argv[2]) || 500;
let failures = 0;
const fail = (n, msg) => { failures++; console.error(`✗ #${n}: ${msg}`); };

const clueCountDist = {};
const typeDist = {};
let totalMs = 0, maxMs = 0;

for (let n = 1; n <= COUNT; n++) {
  const t0 = process.hrtime.bigint();
  const p = DC.generatePuzzle(n);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  totalMs += ms; maxMs = Math.max(maxMs, ms);

  const sols = DC.solutionsOf(p.clues, p.board);
  if (sols.length !== 1) fail(n, `해 개수 ${sols.length}`);
  else if (!DC.isAnswer(p, sols[0])) fail(n, '유일 해가 정답과 다름');
  if (DC.violations(p, p.answer).length) fail(n, '정답이 조건을 위반');

  p.clues.forEach((_, i) => {
    const rest = p.clues.filter((__, j) => j !== i);
    if (DC.solutionsOf(rest, p.board).length === 1) fail(n, `조건 ${i + 1}이(가) 불필요`);
  });

  const k = p.clues.length;
  if (k < DC.MIN_CLUES || k > DC.MAX_CLUES) fail(n, `조건 개수 ${k}`);
  clueCountDist[k] = (clueCountDist[k] || 0) + 1;

  const types = {};
  p.clues.forEach((c) => { types[c.type] = (types[c.type] || 0) + 1; typeDist[c.type] = (typeDist[c.type] || 0) + 1; });
  for (const t in types) if (types[t] > DC.TYPE_LIMIT[t]) fail(n, `${t} 유형 ${types[t]}개`);
  if (Object.keys(types).length < DC.MIN_TYPES) fail(n, '유형 다양성 부족');
  if (!DC.NUMBER_TYPES.some((t) => types[t])) fail(n, '숫자 조건 없음');
  if (!DC.ATTR_TYPES.some((t) => types[t])) fail(n, '색깔/문양 조건 없음');

  p.clues.forEach((c) => {
    const s = DC.clueText(c);
    if (!s || /undefined|NaN/.test(s)) fail(n, `문장 오류: ${JSON.stringify(c)}`);
  });

  for (const attr of ['color', 'shape']) {
    const counts = p.board[attr].counts;
    if (new Set(counts).size !== 5) fail(n, `${attr} 장수 동점`);
    if (counts.reduce((a, b) => a + b, 0) !== 26) fail(n, `${attr} 장수 합 오류`);
  }
}

// 결정성: 캐시를 거치지 않도록 엔진을 새로 불러 다시 생성
delete require.cache[require.resolve('../js/engine.js')];
const DC2 = require('../js/engine.js');
for (const n of [1, 7, 42, 322, COUNT]) {
  if (JSON.stringify(DC.generatePuzzle(n)) !== JSON.stringify(DC2.generatePuzzle(n))) fail(n, '같은 번호인데 퍼즐이 다름');
}

console.log(`퍼즐 ${COUNT}개 검증 — 실패 ${failures}건`);
console.log(`생성 시간: 평균 ${(totalMs / COUNT).toFixed(1)}ms, 최대 ${maxMs.toFixed(1)}ms`);
console.log('조건 개수 분포:', clueCountDist);
console.log('유형별 등장 수:', typeDist);

const sample = DC.generatePuzzle(322);
console.log(`\n예시 #322 (정답 ${sample.answer.map((v) => DC.LETTERS[v - 1]).join('')})`);
sample.clues.forEach((c, i) => console.log(`  ${i + 1}. ${DC.clueText(c)}`));

process.exit(failures ? 1 : 0);
