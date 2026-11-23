import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KnnClassifier, Smoother, Stabilizer, normalizeSample } from '../js/classifier.js';
import { toCanonical } from '../js/features.js';
import { SHAPES, rng, synthHand, synthTake } from './synth.mjs';

const LABELS = Object.keys(SHAPES);

function letters({ takes = 2, n = 20, seed = 1 } = {}) {
  const out = {};
  let s = seed;
  for (const label of LABELS) {
    out[label] = [];
    for (let t = 0; t < takes; t++) {
      for (const lm of synthTake(label, { n, seed: s++ })) out[label].push({ t, m: 0, p: toCanonical(lm) });
    }
  }
  return out;
}

test('다른 녹화의 손모양도 맞힌다', () => {
  const clf = new KnnClassifier().fit(letters());
  let ok = 0;
  let total = 0;
  let seed = 900;
  for (const label of LABELS) {
    for (const lm of synthTake(label, { n: 15, seed: seed++ })) {
      total++;
      if (clf.predict(toCanonical(lm)).label === label) ok++;
    }
  }
  assert.ok(ok / total >= 0.95, `정확도 ${ok}/${total}`);
});

test('기준과 많이 다른 손모양은 모른다고 답한다', () => {
  const clf = new KnnClassifier().fit(letters());
  const r = rng(3);
  const weird = Array.from({ length: 21 }, () => ({ x: r(), y: r(), z: (r() - 0.5) * 0.3 }));
  const res = clf.predict(toCanonical(weird));
  assert.equal(res.known, false);
  assert.equal(res.label, null);
  assert.ok(res.top.length > 0, '모를 때도 가까운 후보는 보여 준다');
});

test('기준 점검: 녹화 묶음 단위로 빼고 맞히며, 한 번만 녹화한 자음은 뺀다', () => {
  const data = letters();
  data['ㅁ'] = data['ㅁ'].filter((s) => s.t === 0);
  const cv = new KnnClassifier().fit(data).crossValidateByTake();
  assert.ok(cv.accuracy >= 0.9, `정확도 ${cv.accuracy}`);
  assert.deepEqual(cv.skipped, ['ㅁ']);
  assert.ok(!cv.tested.includes('ㅁ'));
  assert.equal(cv.n, (LABELS.length - 1) * 40);
});

test('가장 비슷한 자음 쌍을 거리 순으로 돌려준다', () => {
  const pairs = new KnnClassifier().fit(letters()).closestPairs(5);
  assert.equal(pairs.length, 5);
  for (let i = 1; i < pairs.length; i++) assert.ok(pairs[i - 1].distance <= pairs[i].distance);
});

test('자음마다 대표 손모양(힌트용)을 고른다', () => {
  const clf = new KnnClassifier().fit(letters());
  for (const label of LABELS) assert.equal(clf.representative(label).p.length, 63);
  assert.equal(clf.representative('ㅎ'), null);
});

test('예전 형식(숫자 배열) 표본도 받는다', () => {
  const p = toCanonical(synthHand({ ...SHAPES['ㄴ'], random: rng(1) }));
  assert.deepEqual(normalizeSample(p), { p, t: 0, m: 0 });
  assert.equal(normalizeSample({ p: [1, 2] }), null);
  assert.equal(normalizeSample(null), null);
});

test('기준이 없으면 아무것도 고르지 않는다', () => {
  const res = new KnnClassifier().fit({}).predict(new Array(63).fill(0));
  assert.equal(res.label, null);
  assert.equal(res.known, false);
});

test('Smoother: 최근 프레임 중 가장 많이 나온 글자를 고른다', () => {
  const s = new Smoother(5);
  s.push('ㄱ', 0.9);
  s.push('ㄱ', 0.8);
  s.push('ㄴ', 0.7);
  assert.equal(s.push('ㄱ', 0.9).label, 'ㄱ');
  s.push('ㄴ', 0.7);
  s.push('ㄴ', 0.7);
  const r = s.push('ㄴ', 0.7);
  assert.equal(r.label, 'ㄴ');
  assert.ok(Math.abs(r.confidence - 0.7) < 1e-9);
});

test('Stabilizer: 일정 시간 유지해야 확정하고, 들고 있는 동안 다시 확정하지 않는다', () => {
  const st = new Stabilizer({ holdMs: 300, minFrames: 3 });
  let t = 0;
  let committed = [];
  for (let i = 0; i < 30; i++, t += 33) {
    const r = st.push('ㄱ', 0.9, t);
    if (r.committed) committed.push([r.committed, t]);
  }
  assert.equal(committed.length, 1);
  assert.equal(committed[0][0], 'ㄱ');
  assert.ok(committed[0][1] >= 300 && committed[0][1] < 340);
});

test('Stabilizer: 손이 잠깐 안 보이는 건 봐주고, 오래 안 보이면 처음부터', () => {
  const st = new Stabilizer({ holdMs: 300, graceMs: 200 });
  st.push('ㄴ', 0.9, 0);
  st.push('ㄴ', 0.9, 100);
  const gap = st.push(null, 0, 150);
  assert.equal(gap.candidate, 'ㄴ');
  const r = st.push('ㄴ', 0.9, 310);
  assert.equal(r.committed, 'ㄴ', '잠깐 끊겨도 유지 시간이 이어진다');
  st.push(null, 0, 400);
  st.push(null, 0, 700);
  assert.equal(st.push('ㄴ', 0.9, 720).committed, null);
  assert.equal(st.push('ㄴ', 0.9, 880).committed, null);
  assert.equal(st.push('ㄴ', 0.9, 1030).committed, 'ㄴ', '손을 내렸다가 다시 들면 다시 확정한다');
});

test('Stabilizer: 글자가 바뀌면 유지 시간을 다시 잰다', () => {
  const st = new Stabilizer({ holdMs: 300 });
  st.push('ㄱ', 0.9, 0);
  st.push('ㄱ', 0.9, 200);
  st.push('ㄷ', 0.9, 250);
  assert.equal(st.push('ㄷ', 0.9, 400).committed, null);
  assert.equal(st.push('ㄷ', 0.9, 560).committed, 'ㄷ');
});

test('Stabilizer: 확신이 낮으면 확정하지 않는다', () => {
  const st = new Stabilizer({ holdMs: 100, minConfidence: 0.6 });
  for (let t = 0; t < 500; t += 33) assert.equal(st.push('ㄱ', 0.4, t).committed, null);
});

test('Stabilizer: unlock하면 같은 손모양도 다시 확정할 수 있다', () => {
  const st = new Stabilizer({ holdMs: 100, minFrames: 2 });
  let t = 0;
  for (; t <= 150; t += 33) st.push('ㅂ', 0.9, t);
  st.unlock(t);
  let again = null;
  for (let i = 0; i < 6; i++, t += 33) again = st.push('ㅂ', 0.9, t).committed || again;
  assert.equal(again, 'ㅂ');
});
