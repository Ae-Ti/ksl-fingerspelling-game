import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, shuffle } from '../js/game.js';
import { rng } from './synth.mjs';

const LABELS = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ'];

function setup() {
  const clock = { t: 0 };
  const game = new Game({ duration: 60, now: () => clock.t, random: rng(5) });
  return { clock, game };
}

test('모든 자음이 한 번씩 나온 뒤에 다시 섞이고, 같은 자음이 연달아 나오지 않는다', () => {
  const { game } = setup();
  game.start(LABELS);
  const seen = [game.target];
  for (let i = 0; i < 39; i++) {
    game.nextTarget();
    seen.push(game.target);
  }
  for (let i = 1; i < seen.length; i++) assert.notEqual(seen[i], seen[i - 1]);
  for (let round = 0; round < 10; round++) {
    assert.deepEqual([...seen.slice(round * 4, round * 4 + 4)].sort(), [...LABELS].sort());
  }
});

test('맞히면 점수와 연속 정답이 오르고, 연속일수록 더 받는다', () => {
  const { clock, game } = setup();
  game.start(LABELS);
  clock.t = 1500;
  const first = game.submit(game.target);
  assert.deepEqual([first.correct, first.gain, first.combo], [true, 10, 1]);
  assert.equal(first.time, 1.5);
  const second = game.submit(game.target);
  assert.equal(second.gain, 12);
  assert.equal(game.score, 22);
  assert.equal(game.maxCombo, 2);
});

test('틀린 손모양은 점수에 영향이 없고 무엇으로 보였는지 알려 준다', () => {
  const { game } = setup();
  game.start(LABELS);
  const wrong = LABELS.find((l) => l !== game.target);
  const r = game.submit(wrong);
  assert.deepEqual(r, { correct: false, wrong });
  assert.equal(game.score, 0);
});

test('건너뛰면 연속 정답이 끊기고 결과에 남는다', () => {
  const { game } = setup();
  game.start(LABELS);
  game.submit(game.target);
  const skipped = game.target;
  game.skip();
  assert.equal(game.combo, 0);
  const res = game.stop();
  assert.equal(res.skipped, 1);
  assert.deepEqual(res.skippedLetters, [{ label: skipped, count: 1 }]);
});

test('시간이 다 되면 끝나고 결과를 돌려준다', () => {
  const { clock, game } = setup();
  game.start(LABELS);
  clock.t = 59_000;
  assert.equal(game.tick(), null);
  assert.equal(Math.ceil(game.remaining()), 1);
  clock.t = 60_000;
  const res = game.tick();
  assert.equal(game.running, false);
  assert.equal(res.score, 0);
  assert.equal(game.submit('ㄱ').correct, false, '끝난 뒤에는 점수가 오르지 않는다');
});

test('자음이 없으면 시작하지 않는다', () => {
  const { game } = setup();
  game.start([]);
  assert.equal(game.running, false);
});

test('shuffle은 원래 목록을 바꾸지 않는다', () => {
  const list = [1, 2, 3, 4, 5];
  const out = shuffle(list, rng(2));
  assert.deepEqual(list, [1, 2, 3, 4, 5]);
  assert.deepEqual([...out].sort(), list);
});
