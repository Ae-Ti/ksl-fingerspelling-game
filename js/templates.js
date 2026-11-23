// 기준 손모양 저장소
// - 기본 기준: data/templates.json (제작자가 녹화해 사이트에 넣은 것)
// - 내 기준: 이 브라우저의 localStorage (방문자가 직접 녹화한 것)
// 자음마다 내 기준이 있으면 내 기준을, 없으면 기본 기준을 쓴다.
import { CONSONANTS } from './consonants.js';
import { isFlat, round4 } from './features.js';

export const STORAGE_KEY = 'ksl-fingerspelling/templates/v1';
const LABELS = new Set(CONSONANTS.map((c) => c.ch));

export function emptyTemplates() {
  return { version: 1, letters: {} };
}

/** 외부에서 들어온 JSON을 검사해 알려진 자음과 올바른 표본만 남긴다. */
export function sanitize(data) {
  const out = emptyTemplates();
  const letters = data && typeof data === 'object' ? data.letters : null;
  if (!letters || typeof letters !== 'object') return out;
  for (const [label, samples] of Object.entries(letters)) {
    if (!LABELS.has(label) || !Array.isArray(samples)) continue;
    const clean = [];
    for (const s of samples) {
      if (isFlat(s)) clean.push({ t: 0, m: 0, p: s });
      else if (s && isFlat(s.p)) {
        const item = { t: Number.isInteger(s.t) && s.t >= 0 ? s.t : 0, m: s.m ? 1 : 0, p: s.p };
        if (isFlat(s.w)) item.w = s.w;
        clean.push(item);
      }
    }
    if (clean.length) out.letters[label] = clean;
  }
  return out;
}

export class TemplateStore {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.defaults = emptyTemplates();
    this.local = this.load();
  }

  load() {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : emptyTemplates();
    } catch {
      return emptyTemplates();
    }
  }

  /** @returns {boolean} 저장에 성공했는지 */
  save() {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.local));
      return true;
    } catch {
      return false;
    }
  }

  setDefaults(data) {
    this.defaults = sanitize(data);
  }

  hasDefaults() {
    return Object.keys(this.defaults.letters).length > 0;
  }

  sourceOf(label) {
    if (this.local.letters[label]?.length) return 'local';
    if (this.defaults.letters[label]?.length) return 'default';
    return null;
  }

  /** 자음마다 내 기준이 있으면 내 기준, 없으면 기본 기준 */
  merged() {
    const letters = {};
    for (const { ch } of CONSONANTS) {
      const src = this.sourceOf(ch);
      if (src) letters[ch] = (src === 'local' ? this.local : this.defaults).letters[ch];
    }
    return letters;
  }

  takes(label, source = 'local') {
    const list = (source === 'local' ? this.local : this.defaults).letters[label] || [];
    return new Set(list.map((s) => s.t)).size;
  }

  samples(label, source = 'local') {
    return ((source === 'local' ? this.local : this.defaults).letters[label] || []).length;
  }

  /**
   * 녹화 한 번에서 모은 표본을 추가한다.
   * @param {string} label 자음
   * @param {{p:number[], w?:number[], m?:number}[]} samples
   * @returns {{take:number, count:number, saved:boolean}}
   */
  addTake(label, samples) {
    if (!LABELS.has(label)) throw new Error(`unknown label: ${label}`);
    const list = (this.local.letters[label] ||= []);
    const take = list.reduce((mx, s) => Math.max(mx, s.t + 1), 0);
    let count = 0;
    for (const s of samples) {
      if (!isFlat(s.p)) continue;
      const item = { t: take, m: s.m ? 1 : 0, p: s.p.map(round4) };
      if (isFlat(s.w)) item.w = s.w.map(round4);
      list.push(item);
      count++;
    }
    if (!list.length) delete this.local.letters[label];
    const saved = this.save();
    if (!saved) {
      // 저장 공간이 부족하면 방금 넣은 녹화를 되돌린다
      this.local.letters[label] = list.filter((s) => s.t !== take);
      if (!this.local.letters[label].length) delete this.local.letters[label];
    }
    return { take, count: saved ? count : 0, saved };
  }

  clearLetter(label) {
    delete this.local.letters[label];
    this.save();
  }

  clearAll() {
    this.local = emptyTemplates();
    this.save();
  }

  exportJson() {
    return JSON.stringify({ ...this.local, version: 1, exportedAt: new Date().toISOString() });
  }

  /** @returns {number} 불러온 자음 수 */
  importJson(text) {
    const data = sanitize(JSON.parse(text));
    this.local = data;
    if (!this.save()) throw new Error('storage');
    return Object.keys(data.letters).length;
  }
}
