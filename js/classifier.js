// 녹화해 둔 기준 손모양들과 비교해 가장 가까운 자음을 고르는 k-최근접 이웃 분류기와,
// 프레임마다 흔들리는 결과를 안정시키는 도구들
import { featuresFromFlat, isFlat } from './features.js';

export function distance(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return Math.sqrt(s);
}

function percentile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
  return sorted[i];
}

/**
 * 기준 표본 하나: { p: 63개 숫자, t?: 녹화 번호, m?: 녹화 때 좌우를 뒤집었는지(0/1) }
 * 예전 형식(63개 숫자 배열)도 받는다.
 */
export function normalizeSample(s) {
  if (isFlat(s)) return { p: s, t: 0, m: 0 };
  if (s && isFlat(s.p)) return { p: s.p, t: Number.isInteger(s.t) ? s.t : 0, m: s.m ? 1 : 0, w: s.w };
  return null;
}

export class KnnClassifier {
  /**
   * @param {object} o
   * @param {number} o.k 투표에 쓸 이웃 수
   * @param {number} o.thresholdScale 같은 글자 표본끼리 거리(90번째 백분위수)에 곱해 '모르는 손모양' 기준을 정한다
   * @param {number} o.minThreshold 기준 거리의 최솟값(녹화 때 손을 거의 안 움직였을 때 너무 엄격해지는 것을 막는다)
   */
  constructor({ k = 7, thresholdScale = 1.8, minThreshold = 2.0 } = {}) {
    this.k = k;
    this.thresholdScale = thresholdScale;
    this.minThreshold = minThreshold;
    this.items = [];
    this.threshold = Infinity;
    this.medoids = new Map();
  }

  /**
   * @param {Record<string, any[]>} letters 글자 → 기준 표본 목록
   * @param {(label:string)=>string} [sourceOf] 표본 출처(녹화 묶음을 구분할 때 씀)
   */
  fit(letters, sourceOf = () => '') {
    this.items = [];
    for (const [label, samples] of Object.entries(letters || {})) {
      for (const raw of samples || []) {
        const s = normalizeSample(raw);
        if (!s) continue;
        this.items.push({ label, f: featuresFromFlat(s.p), p: s.p, m: s.m, take: `${sourceOf(label)}:${s.t}` });
      }
    }
    this.threshold = this.autoThreshold();
    this.medoids = this.computeMedoids();
    return this;
  }

  get labels() {
    return [...new Set(this.items.map((i) => i.label))];
  }

  get size() {
    return this.items.length;
  }

  /** 같은 글자 표본끼리의 거리 분포로 '모르는 손모양' 기준 거리를 정한다. */
  autoThreshold() {
    const byLabel = groupBy(this.items, (it) => it.label);
    const ds = [];
    for (const list of byLabel.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) ds.push(distance(list[i].f, list[j].f));
      }
    }
    if (ds.length < 3) return Infinity;
    ds.sort((a, b) => a - b);
    return Math.max(this.minThreshold, percentile(ds, 0.9) * this.thresholdScale);
  }

  /** 글자마다 다른 표본들과 가장 가까운 표본(대표 손모양). 힌트 그림에 쓴다. */
  computeMedoids() {
    const out = new Map();
    for (const [label, list] of groupBy(this.items, (it) => it.label)) {
      let best = null;
      let bestSum = Infinity;
      for (const a of list) {
        let s = 0;
        for (const b of list) s += distance(a.f, b.f);
        if (s < bestSum) {
          bestSum = s;
          best = a;
        }
      }
      if (best) out.set(label, { p: best.p, m: best.m });
    }
    return out;
  }

  representative(label) {
    return this.medoids.get(label) || null;
  }

  /**
   * @param {number[]} f 특징 벡터
   * @param {(item:object)=>boolean} [skip] 비교에서 뺄 표본(점검용)
   */
  predictFeatures(f, skip) {
    const empty = { label: null, confidence: 0, distance: Infinity, known: false, top: [] };
    if (!this.items.length) return empty;
    const scored = [];
    for (const it of this.items) {
      if (skip && skip(it)) continue;
      scored.push({ it, d: distance(f, it.f) });
    }
    if (!scored.length) return empty;
    scored.sort((a, b) => a.d - b.d);
    const near = scored.slice(0, this.k);
    const votes = new Map();
    let total = 0;
    for (const { it, d } of near) {
      const w = 1 / (d + 1e-3);
      votes.set(it.label, (votes.get(it.label) || 0) + w);
      total += w;
    }
    const top = [...votes.entries()]
      .map(([label, w]) => ({ label, score: w / total }))
      .sort((a, b) => b.score - a.score);
    const nearest = near[0].d;
    const known = nearest <= this.threshold;
    return {
      label: known ? top[0].label : null,
      confidence: known ? top[0].score : 0,
      distance: nearest,
      known,
      top,
    };
  }

  /** @param {number[]} flat toCanonical 결과(63개) */
  predict(flat) {
    return this.predictFeatures(featuresFromFlat(flat));
  }

  /**
   * 녹화 묶음 하나를 빼고 나머지 녹화로 맞혀 보는 점검.
   * 같은 녹화 안의 프레임은 거의 같아서, 같은 녹화끼리 비교하면 점수가 부풀려지므로 묶음 단위로 뺀다.
   */
  crossValidateByTake() {
    const takesPerLabel = new Map();
    for (const it of this.items) {
      if (!takesPerLabel.has(it.label)) takesPerLabel.set(it.label, new Set());
      takesPerLabel.get(it.label).add(it.take);
    }
    const tested = [...takesPerLabel.entries()].filter(([, s]) => s.size >= 2).map(([l]) => l);
    const skipped = [...takesPerLabel.entries()].filter(([, s]) => s.size < 2).map(([l]) => l);
    const perLabel = {};
    const confusions = new Map();
    let n = 0;
    let ok = 0;
    for (const it of this.items) {
      if (!tested.includes(it.label)) continue;
      const r = this.predictFeatures(it.f, (other) => other.take === it.take && other.label === it.label);
      const got = r.label;
      const pl = (perLabel[it.label] ||= { n: 0, ok: 0 });
      pl.n++;
      n++;
      if (got === it.label) {
        pl.ok++;
        ok++;
      } else {
        const key = `${it.label}>${got ?? '?'}`;
        confusions.set(key, (confusions.get(key) || 0) + 1);
      }
    }
    return {
      n,
      accuracy: n ? ok / n : null,
      perLabel,
      tested,
      skipped,
      confusions: [...confusions.entries()]
        .map(([key, count]) => {
          const [from, to] = key.split('>');
          return { from, to: to === '?' ? null : to, count };
        })
        .sort((a, b) => b.count - a.count),
    };
  }

  /** 서로 다른 글자 중 표본끼리 가장 가까운 쌍(헷갈릴 수 있는 자음) */
  closestPairs(limit = 3) {
    const byLabel = [...groupBy(this.items, (it) => it.label).entries()];
    const pairs = [];
    for (let a = 0; a < byLabel.length; a++) {
      for (let b = a + 1; b < byLabel.length; b++) {
        let best = Infinity;
        for (const x of byLabel[a][1]) {
          for (const y of byLabel[b][1]) {
            const d = distance(x.f, y.f);
            if (d < best) best = d;
          }
        }
        pairs.push({ a: byLabel[a][0], b: byLabel[b][0], distance: best, ratio: best / this.threshold });
      }
    }
    return pairs.sort((x, y) => x.distance - y.distance).slice(0, limit);
  }
}

function groupBy(list, key) {
  const m = new Map();
  for (const it of list) {
    const k = key(it);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  return m;
}

/** 최근 몇 프레임 중 가장 많이 나온 글자를 고른다(한두 프레임 튀는 결과를 무시). */
export class Smoother {
  constructor(size = 5) {
    this.size = size;
    this.buf = [];
  }

  reset() {
    this.buf = [];
  }

  /** @returns {{label:string|null, confidence:number}} */
  push(label, confidence) {
    this.buf.push({ label, confidence });
    if (this.buf.length > this.size) this.buf.shift();
    const count = new Map();
    for (const b of this.buf) count.set(b.label, (count.get(b.label) || 0) + 1);
    let best = null;
    let bestN = 0;
    for (const [l, c] of count) {
      if (c > bestN || (c === bestN && l === label)) {
        best = l;
        bestN = c;
      }
    }
    const conf = this.buf.filter((b) => b.label === best).reduce((s, b) => s + b.confidence, 0) / bestN;
    return { label: best, confidence: best === null ? 0 : conf };
  }
}

/**
 * 같은 글자가 holdMs 동안 이어질 때만 '확정'한다.
 * 확정한 뒤에는 손모양을 바꾸거나 unlock()을 부르기 전까지 같은 글자를 다시 확정하지 않는다.
 */
export class Stabilizer {
  constructor({ holdMs = 450, minConfidence = 0.55, minFrames = 3, graceMs = 200 } = {}) {
    this.holdMs = holdMs;
    this.minConfidence = minConfidence;
    this.minFrames = minFrames;
    this.graceMs = graceMs;
    this.reset();
  }

  reset() {
    this.current = null;
    this.since = 0;
    this.frames = 0;
    this.locked = null;
    this.lastOkAt = -Infinity;
    this.lastProgress = 0;
  }

  /** @returns {{candidate:string|null, progress:number, committed:string|null}} */
  push(label, confidence, now) {
    const ok = label && confidence >= this.minConfidence ? label : null;
    if (ok === null) {
      // 손이 잠깐 안 보이는 정도(graceMs)는 흐름을 끊지 않는다
      if (this.current !== null && now - this.lastOkAt < this.graceMs) {
        return { candidate: this.current, progress: this.lastProgress, committed: null };
      }
      this.current = null;
      this.frames = 0;
      this.locked = null;
      this.lastProgress = 0;
      return { candidate: null, progress: 0, committed: null };
    }
    this.lastOkAt = now;
    if (ok !== this.current) {
      this.current = ok;
      this.since = now;
      this.frames = 0;
    }
    this.frames++;
    if (ok === this.locked) {
      this.lastProgress = 0;
      return { candidate: ok, progress: 0, committed: null };
    }
    const elapsed = now - this.since;
    const progress = Math.min(1, elapsed / this.holdMs);
    if (elapsed >= this.holdMs && this.frames >= this.minFrames) {
      this.locked = ok;
      this.lastProgress = 0;
      return { candidate: ok, progress: 1, committed: ok };
    }
    this.lastProgress = progress;
    return { candidate: ok, progress, committed: null };
  }

  /** 다음 문제로 넘어갈 때 잠금을 풀어, 같은 손모양을 계속 유지해도 다시 확정할 수 있게 한다. */
  unlock(now) {
    this.locked = null;
    this.frames = 0;
    if (now !== undefined) this.since = now;
  }
}
