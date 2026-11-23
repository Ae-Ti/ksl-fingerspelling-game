// 브라우저 자동 테스트(tools/e2e.py)에 쓸 가짜 기준 손모양과 프레임을 만든다.
import { toCanonical } from '../js/features.js';
import { SHAPES, synthTake } from '../tests/synth.mjs';

const ASPECT = 4 / 3;
const letters = {};
const frames = {};
let seed = 11;
for (const label of Object.keys(SHAPES)) {
  letters[label] = [];
  for (let t = 0; t < 2; t++) {
    for (const lm of synthTake(label, { n: 20, seed: seed++ })) letters[label].push({ t, m: 0, p: toCanonical(lm, false, ASPECT) });
  }
  frames[label] = synthTake(label, { n: 40, seed: seed++ }).map((lm) => ({ lm, p: toCanonical(lm, false, ASPECT) }));
}
process.stdout.write(JSON.stringify({ templates: { version: 1, letters }, frames }));
