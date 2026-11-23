import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_LENGTH, featuresFromFlat, isFlat, toCanonical } from '../js/features.js';
import { distance } from '../js/classifier.js';
import { SHAPES, rng, synthHand } from './synth.mjs';

const hand = (label, opts = {}) => synthHand({ ...SHAPES[label], noise: 0, random: rng(7), ...opts });

test('특징 벡터 길이가 FEATURE_LENGTH와 같다', () => {
  const f = featuresFromFlat(toCanonical(hand('ㄴ')));
  assert.equal(f.length, FEATURE_LENGTH);
  assert.ok(f.every(Number.isFinite));
});

test('toCanonical은 63개 숫자를 만든다', () => {
  assert.ok(isFlat(toCanonical(hand('ㄱ'), false, 4 / 3)));
});

test('손이 화면 어디에 있든, 크기가 어떻든 특징은 같다', () => {
  const a = featuresFromFlat(toCanonical(hand('ㄹ', { cx: 0.3, cy: 0.4, scale: 0.15 })));
  const b = featuresFromFlat(toCanonical(hand('ㄹ', { cx: 0.6, cy: 0.7, scale: 0.28 })));
  assert.ok(distance(a, b) < 0.02, `거리 ${distance(a, b)}`);
});

test('같은 손모양이라도 방향이 다르면 다른 특징이 된다(지문자는 방향이 중요)', () => {
  const up = featuresFromFlat(toCanonical(hand('ㄴ', { angle: 0 })));
  const side = featuresFromFlat(toCanonical(hand('ㄴ', { angle: 90 })));
  assert.ok(distance(up, side) > 1, `거리 ${distance(up, side)}`);
});

test('반대쪽 손(좌우가 뒤집힌 손)은 mirror로 같은 기준에 맞춰진다', () => {
  const right = hand('ㄷ');
  const left = right.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
  const a = featuresFromFlat(toCanonical(right, false));
  const b = featuresFromFlat(toCanonical(left, true));
  const c = featuresFromFlat(toCanonical(left, false));
  assert.ok(distance(a, b) < 0.02, `뒤집어 맞춘 거리 ${distance(a, b)}`);
  assert.ok(distance(a, c) > 0.5, `뒤집지 않은 거리 ${distance(a, c)}`);
});

test('가로세로 비율을 반영해 x 단위를 맞춘다', () => {
  const lm = hand('ㅂ');
  const flat = toCanonical(lm, false, 16 / 9);
  assert.equal(flat[0], Math.round(lm[0].x * (16 / 9) * 10000) / 10000);
  assert.equal(flat[1], Math.round(lm[0].y * 10000) / 10000);
});
