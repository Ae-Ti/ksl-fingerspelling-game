// 테스트용 가짜 손: 손가락을 폈는지/접었는지와 회전 각도로 손 관절 21개(MediaPipe 형식)를 만든다.
// 실제 한국수어 지문자 모양이 아니라, 분류기 동작을 확인하기 위한 서로 다른 손모양들이다.

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function gauss(r) {
  const u = Math.max(r(), 1e-9);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const BASES = {
  thumb: [-0.35, -0.25],
  index: [-0.32, -0.95],
  middle: [0, -1],
  ring: [0.28, -0.95],
  pinky: [0.52, -0.82],
};
const SEGS = {
  thumb: [0.35, 0.32, 0.28],
  index: [0.45, 0.27, 0.22],
  middle: [0.5, 0.3, 0.24],
  ring: [0.46, 0.28, 0.22],
  pinky: [0.36, 0.22, 0.2],
};
const ORDER = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/**
 * @param {object} o
 * @param {Record<string, boolean>} o.ext 손가락별로 폈는지
 * @param {number} o.angle 화면 안에서 손 전체 회전(도). 0이면 손가락이 위를 향한다.
 * @param {number} o.noise 관절마다 더할 흔들림(손바닥 길이 대비)
 * @param {() => number} o.random
 * @param {number} o.cx,o.cy,o.scale 화면 위치와 크기(0~1)
 */
export function synthHand({ ext, angle = 0, noise = 0.02, random = Math.random, cx = 0.5, cy = 0.62, scale = 0.2 }) {
  const pts = [[0, 0, 0]];
  for (const f of ORDER) {
    const [bx, by] = BASES[f];
    const segs = SEGS[f];
    let p = [bx, by, 0];
    if (f !== 'thumb') {
      // 검지~소지: 손바닥 안쪽(MCP)부터 시작
      pts.push([...p]);
      const spread = bx * 0.25;
      const bends = ext[f] ? [0, 0, 0] : [75, 175, 235];
      for (let i = 0; i < 3; i++) {
        const t = (bends[i] * Math.PI) / 180;
        const dir = [spread * Math.cos(t), -Math.cos(t), -Math.sin(t)];
        const n = Math.hypot(...dir);
        p = [p[0] + (dir[0] / n) * segs[i], p[1] + (dir[1] / n) * segs[i], p[2] + (dir[2] / n) * segs[i]];
        pts.push([...p]);
      }
    } else {
      pts.push([...p]); // CMC
      const dirs = ext.thumb
        ? [[-0.8, -0.6, 0], [-0.8, -0.6, 0], [-0.8, -0.6, 0]]
        : [[0.2, -0.6, -0.3], [0.8, -0.2, -0.3], [0.9, 0.2, -0.2]];
      for (let i = 0; i < 3; i++) {
        const d = dirs[i];
        const n = Math.hypot(...d);
        p = [p[0] + (d[0] / n) * segs[i], p[1] + (d[1] / n) * segs[i], p[2] + (d[2] / n) * segs[i]];
        pts.push([...p]);
      }
    }
  }
  const a = (angle * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  return pts.map(([x, y, z]) => {
    const nx = x + gauss(random) * noise;
    const ny = y + gauss(random) * noise;
    const nz = z + gauss(random) * noise;
    const rx = nx * ca - ny * sa;
    const ry = nx * sa + ny * ca;
    return { x: cx + rx * scale, y: cy + ry * scale, z: nz * scale };
  });
}

const E = (s) => ({
  thumb: s.includes('t'),
  index: s.includes('i'),
  middle: s.includes('m'),
  ring: s.includes('r'),
  pinky: s.includes('p'),
});

/** 테스트용 손모양 8개(이름은 자음을 빌렸을 뿐 실제 지문자 모양과는 다르다) */
export const SHAPES = {
  'ㄱ': { ext: E('ti'), angle: 90 },
  'ㄴ': { ext: E('ti'), angle: 0 },
  'ㄷ': { ext: E('im'), angle: 90 },
  'ㄹ': { ext: E('imr'), angle: 90 },
  'ㅁ': { ext: E(''), angle: 0 },
  'ㅂ': { ext: E('imrp'), angle: 0 },
  'ㅅ': { ext: E('im'), angle: 180 },
  'ㅇ': { ext: E('timrp'), angle: 0 },
};

/** 녹화 한 번을 흉내 낸다: 손 위치·크기·각도가 조금씩 다른 표본 n개 */
export function synthTake(label, { n = 20, seed = 1, noise = 0.02, jitterAngle = 8 } = {}) {
  const r = rng(seed);
  const shape = SHAPES[label];
  const baseAngle = shape.angle + (r() - 0.5) * jitterAngle;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(
      synthHand({
        ext: shape.ext,
        angle: baseAngle + (r() - 0.5) * 4,
        noise,
        random: r,
        cx: 0.45 + r() * 0.1,
        cy: 0.55 + r() * 0.1,
        scale: 0.17 + r() * 0.06,
      }),
    );
  }
  return out;
}
