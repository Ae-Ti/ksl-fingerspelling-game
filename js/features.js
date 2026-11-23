// 손 관절 21개(MediaPipe Hand Landmarker)를 비교 가능한 숫자 목록(특징 벡터)으로 바꾼다.
//
// 1) toCanonical: 가로·세로 단위를 맞추고, 필요하면 좌우를 뒤집어 한쪽 손 기준으로 통일한다(63개 숫자).
// 2) featuresFromFlat: 손목 기준 위치를 손바닥 크기로 나누고(위치), 손가락 마디 각도,
//    손끝 사이 거리, 손바닥 방향을 붙인다.
//    지문자는 같은 손모양이라도 방향이 다르면 다른 글자가 되므로(예: 손가락이 위를 향하는지 옆을 향하는지)
//    회전은 지우지 않는다.

const W_POS = 1.0;
const W_DEPTH = 0.5; // 깊이(z)는 추정값이라 흔들림이 커서 덜 반영한다
const W_ANG = 1.5;
const W_TIP = 1.0;
const W_ORI = 1.5;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v) => {
  const n = len(v) || 1e-9;
  return [v[0] / n, v[1] / n, v[2] / n];
};

export function round4(v) {
  return Math.round(v * 10000) / 10000;
}

/**
 * 화면 좌표(0~1) 21개를 63개 숫자로 바꾼다.
 * @param {{x:number,y:number,z:number}[]} landmarks MediaPipe 정규화 좌표 21개(좌우 반전 전 원본 영상 기준)
 * @param {boolean} mirror 좌우를 뒤집을지(반대쪽 손을 같은 기준으로 맞출 때)
 * @param {number} aspect 영상 가로/세로 비율. x와 z는 가로 길이 기준이라 곱해서 단위를 맞춘다.
 */
export function toCanonical(landmarks, mirror = false, aspect = 1) {
  const s = mirror ? -1 : 1;
  const out = new Array(63);
  for (let i = 0; i < 21; i++) {
    const p = landmarks[i];
    out[i * 3] = round4(s * p.x * aspect);
    out[i * 3 + 1] = round4(p.y);
    out[i * 3 + 2] = round4(p.z * aspect);
  }
  return out;
}

/** 실제 공간 좌표(미터) 21개를 63개 숫자로 바꾼다. 지금은 저장만 하고 분류에는 쓰지 않는다. */
export function worldToCanonical(world, mirror = false) {
  const s = mirror ? -1 : 1;
  const out = new Array(63);
  for (let i = 0; i < 21; i++) {
    const p = world[i];
    out[i * 3] = round4(s * p.x);
    out[i * 3 + 1] = round4(p.y);
    out[i * 3 + 2] = round4(p.z);
  }
  return out;
}

export function isFlat(a) {
  return Array.isArray(a) && a.length === 63 && a.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function toPoints(flat) {
  const pts = new Array(21);
  for (let i = 0; i < 21; i++) pts[i] = [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]];
  return pts;
}

function cosAt(a, b, c) {
  const u = sub(a, b);
  const v = sub(c, b);
  const d = len(u) * len(v);
  return d < 1e-9 ? 1 : dot(u, v) / d;
}

// 마디 각도를 잴 관절 순서(손목 0에서 손끝까지)
const CHAINS = [
  [0, 1, 2, 3, 4], // 엄지
  [0, 5, 6, 7, 8], // 검지
  [0, 9, 10, 11, 12], // 중지
  [0, 13, 14, 15, 16], // 약지
  [0, 17, 18, 19, 20], // 소지
];

/** @param {number[]} flat toCanonical 결과(63개) */
export function featuresFromFlat(flat) {
  const P = toPoints(flat);
  const w = P[0];
  const size = len(sub(P[9], w)) || 1e-6; // 손바닥 크기(손목~중지 뿌리)
  const rel = P.map((p) => [(p[0] - w[0]) / size, (p[1] - w[1]) / size, (p[2] - w[2]) / size]);
  const f = [];
  // 위치 20개 × 3
  for (let i = 1; i < 21; i++) f.push(rel[i][0] * W_POS, rel[i][1] * W_POS, rel[i][2] * W_DEPTH);
  // 마디 각도 15개(손가락마다 3개)
  for (const c of CHAINS) {
    for (let j = 1; j < c.length - 1; j++) f.push(cosAt(rel[c[j - 1]], rel[c[j]], rel[c[j + 1]]) * W_ANG);
  }
  // 손끝 사이 거리 9개: 엄지 끝↔나머지 손끝, 이웃한 손끝끼리, 엄지 끝↔검지·중지 뿌리(엄지를 접었는지)
  for (const t of [8, 12, 16, 20]) f.push(len(sub(rel[4], rel[t])) * W_TIP);
  for (const [a, b] of [[8, 12], [12, 16], [16, 20]]) f.push(len(sub(rel[a], rel[b])) * W_TIP);
  for (const t of [5, 9]) f.push(len(sub(rel[4], rel[t])) * W_TIP);
  // 손바닥 방향: 손목→중지 뿌리 방향, 손바닥 면의 법선
  const dir = unit(rel[9]);
  const normal = unit(cross(rel[5], rel[17]));
  for (const v of dir) f.push(v * W_ORI);
  for (const v of normal) f.push(v * W_ORI);
  return f;
}

export const FEATURE_LENGTH = 60 + 15 + 9 + 6;
