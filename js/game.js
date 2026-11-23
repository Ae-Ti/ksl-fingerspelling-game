// 60초 도전: 제시된 자음을 손으로 만들면 점수를 얻는다.
export class Game {
  constructor({ duration = 60, now = () => performance.now(), random = Math.random } = {}) {
    this.duration = duration;
    this.now = now;
    this.random = random;
    this.running = false;
    this.labels = [];
    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.correct = 0;
    this.skipped = 0;
    this.target = null;
    this.targetSince = 0;
    this.bag = [];
    this.times = [];
    this.history = [];
    this.solved = {};
  }

  start(labels) {
    this.labels = [...new Set(labels)];
    this.reset();
    this.running = this.labels.length > 0;
    this.startedAt = this.now();
    this.nextTarget();
  }

  remaining() {
    if (!this.running) return 0;
    return Math.max(0, this.duration - (this.now() - this.startedAt) / 1000);
  }

  /** 모든 자음이 한 번씩 나온 뒤에 다시 섞는다. 같은 자음이 연달아 나오지 않게 한다. */
  nextTarget() {
    if (!this.bag.length) {
      this.bag = shuffle(this.labels, this.random);
      if (this.bag.length > 1 && this.bag[0] === this.target) this.bag.push(this.bag.shift());
    }
    this.target = this.bag.shift() ?? null;
    this.targetSince = this.now();
  }

  /** 확정된 손모양을 넣는다. 정답이면 점수를 올리고 다음 문제로 넘어간다. */
  submit(label) {
    if (!this.running || !label) return { correct: false };
    if (label !== this.target) return { correct: false, wrong: label };
    const t = (this.now() - this.targetSince) / 1000;
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const gain = 10 + Math.min(10, (this.combo - 1) * 2);
    this.score += gain;
    this.correct++;
    this.solved[label] = (this.solved[label] || 0) + 1;
    this.times.push(t);
    this.history.push({ label, t, ok: true });
    this.nextTarget();
    return { correct: true, gain, time: t, combo: this.combo };
  }

  skip() {
    if (!this.running) return;
    this.combo = 0;
    this.skipped++;
    this.history.push({ label: this.target, ok: false });
    this.nextTarget();
  }

  /** 시간이 다 됐으면 끝내고 결과를 돌려준다. */
  tick() {
    if (this.running && this.remaining() <= 0) {
      this.running = false;
      return this.result();
    }
    return null;
  }

  stop() {
    this.running = false;
    return this.result();
  }

  result() {
    const avg = this.times.length ? this.times.reduce((a, b) => a + b, 0) / this.times.length : null;
    const missed = {};
    for (const h of this.history) {
      if (!h.ok) missed[h.label] = (missed[h.label] || 0) + 1;
    }
    return {
      score: this.score,
      correct: this.correct,
      skipped: this.skipped,
      maxCombo: this.maxCombo,
      avgTime: avg,
      skippedLetters: Object.entries(missed)
        .sort((a, b) => b[1] - a[1])
        .map(([label, count]) => ({ label, count })),
    };
  }
}

export function shuffle(list, random = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
