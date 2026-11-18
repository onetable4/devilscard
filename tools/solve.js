/*
 * 퍼즐 하나를 사람처럼 풀어 과정을 보여준다.
 *   node tools/solve.js 31744
 * 여러 퍼즐의 난이도 분포:
 *   node tools/solve.js --stats 1000
 */
'use strict';
const DC = require('../js/engine.js');
const S = require('../js/solver.js');

const args = process.argv.slice(2);

if (args[0] === '--stats') {
  const count = Number(args[1]) || 500;
  const dist = {};
  const byClues = {};
  let wrong = 0, total = 0, maxMs = 0;
  const examples = {};
  for (let n = 1; n <= count; n++) {
    const p = DC.generatePuzzle(n);
    const t0 = Date.now();
    const r = S.solve(p);
    const ms = Date.now() - t0;
    total += ms; maxMs = Math.max(maxMs, ms);
    if (r.solved && !DC.isAnswer(p, r.answer)) wrong++;
    const label = r.rating.label;
    dist[label] = (dist[label] || 0) + 1;
    const k = p.clues.length;
    byClues[k] = byClues[k] || {};
    byClues[k][label] = (byClues[k][label] || 0) + 1;
    (examples[label] = examples[label] || []).length < 5 && examples[label].push(n);
  }
  console.log(`퍼즐 ${count}개 풀이 — 정답과 다른 풀이 ${wrong}건`);
  console.log(`풀이 시간: 평균 ${(total / count).toFixed(1)}ms, 최대 ${maxMs}ms`);
  console.log('난이도 분포:');
  for (const t of S.TIERS) {
    const v = dist[t.label] || 0;
    console.log(`  ${t.label.padEnd(6)} ${String(v).padStart(4)}  ${(v / count * 100).toFixed(1).padStart(5)}%   예: ${(examples[t.label] || []).map((x) => '#' + x).join(' ')}`);
  }
  console.log('조건 개수별:', byClues);
  process.exit(wrong ? 1 : 0);
}

const n = Number(args[0]);
if (!n) {
  console.log('사용법: node tools/solve.js <퍼즐 번호> | --stats [개수]');
  process.exit(1);
}

const p = DC.generatePuzzle(n);
const r = S.solve(p);
const L = (v) => DC.LETTERS[v - 1];

console.log(`퍼즐 #${n} — 난이도 ${r.rating.label} (점수 ${r.rating.score}, 단계 ${r.steps.length})`);
p.clues.forEach((c, i) => console.log(`  ${i + 1}. ${DC.clueText(c)}`));
console.log(`\n시작 (오름차순만 고려): ${r.start.map((m, i) => `${S.ORD[i]} ${S.domText(m)}`).join(', ')}\n`);
r.steps.forEach((s, i) => {
  const d = S.describeStep(s, p);
  console.log(`${String(i + 1).padStart(2)}. ${d.head}`);
  d.changes.forEach((c) => console.log(`      ${c}`));
});
if (r.solved) {
  console.log(`\n풀이 완료: ${r.answer.map(L).join('')} (${r.answer.join(', ')})${DC.isAnswer(p, r.answer) ? '' : '  ✗ 정답과 다름!'}`);
} else {
  console.log('\n조건 하나씩 적용 + 한 단계 가정으로는 더 좁힐 수 없음:');
  r.final.forEach((m, i) => console.log(`  ${S.ORD[i]}: ${S.domText(m, 30)}`));
  console.log(`정답: ${p.answer.map(L).join('')}`);
}
