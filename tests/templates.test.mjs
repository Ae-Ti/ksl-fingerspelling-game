import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, TemplateStore, sanitize } from '../js/templates.js';

const P = () => Array.from({ length: 63 }, (_, i) => i / 100);

function memoryStorage({ failWrites = false } = {}) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (failWrites) throw new DOMException('full', 'QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k) => m.delete(k),
    raw: m,
  };
}

test('sanitize: 모르는 글자와 잘못된 표본은 버리고 예전 형식은 받는다', () => {
  const out = sanitize({
    letters: {
      'ㄱ': [P(), { p: P(), t: 2, m: 1 }, { p: [1, 2, 3] }, 'x'],
      'A': [P()],
      'ㄴ': 'nope',
    },
  });
  assert.deepEqual(Object.keys(out.letters), ['ㄱ']);
  assert.equal(out.letters['ㄱ'].length, 2);
  assert.deepEqual(out.letters['ㄱ'][1], { t: 2, m: 1, p: P() });
  assert.deepEqual(sanitize(null), { version: 1, letters: {} });
});

test('녹화를 추가하면 녹화 번호가 붙고 브라우저에 저장된다', () => {
  const storage = memoryStorage();
  const store = new TemplateStore(storage);
  const a = store.addTake('ㄷ', [{ p: P() }, { p: P(), m: 1 }]);
  const b = store.addTake('ㄷ', [{ p: P() }]);
  assert.deepEqual([a.take, a.count, a.saved], [0, 2, true]);
  assert.equal(b.take, 1);
  assert.equal(store.takes('ㄷ'), 2);
  assert.equal(store.samples('ㄷ'), 3);
  assert.ok(storage.raw.get(STORAGE_KEY).includes('ㄷ'));
  assert.equal(new TemplateStore(storage).takes('ㄷ'), 2, '다시 열어도 남아 있다');
});

test('내 기준이 있는 자음은 내 기준을, 없는 자음은 기본 기준을 쓴다', () => {
  const store = new TemplateStore(memoryStorage());
  store.setDefaults({ letters: { 'ㄱ': [P()], 'ㄴ': [P(), P()] } });
  store.addTake('ㄴ', [{ p: P() }]);
  assert.equal(store.sourceOf('ㄱ'), 'default');
  assert.equal(store.sourceOf('ㄴ'), 'local');
  assert.equal(store.sourceOf('ㄷ'), null);
  const merged = store.merged();
  assert.equal(merged['ㄱ'].length, 1);
  assert.equal(merged['ㄴ'].length, 1);
  assert.equal(merged['ㄷ'], undefined);
});

test('저장 공간이 부족하면 방금 녹화를 되돌린다', () => {
  const store = new TemplateStore(memoryStorage({ failWrites: true }));
  const r = store.addTake('ㅁ', [{ p: P() }]);
  assert.equal(r.saved, false);
  assert.equal(store.takes('ㅁ'), 0);
});

test('기준 파일로 저장하고 다시 불러올 수 있다', () => {
  const a = new TemplateStore(memoryStorage());
  a.addTake('ㅂ', [{ p: P() }]);
  a.addTake('ㅅ', [{ p: P() }, { p: P() }]);
  const b = new TemplateStore(memoryStorage());
  assert.equal(b.importJson(a.exportJson()), 2);
  assert.equal(b.samples('ㅅ'), 2);
  assert.throws(() => b.importJson('not json'));
});

test('자음 하나 또는 전부를 지울 수 있다', () => {
  const store = new TemplateStore(memoryStorage());
  store.addTake('ㅇ', [{ p: P() }]);
  store.addTake('ㅈ', [{ p: P() }]);
  store.clearLetter('ㅇ');
  assert.equal(store.takes('ㅇ'), 0);
  assert.equal(store.takes('ㅈ'), 1);
  store.clearAll();
  assert.deepEqual(store.merged(), {});
});
