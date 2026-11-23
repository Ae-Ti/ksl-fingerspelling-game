// 손 관절 그리기: 카메라 화면 위의 손과, 기준 손모양 힌트
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const TIPS = [4, 8, 12, 16, 20];

/**
 * 카메라 화면 위에 손을 그린다. 캔버스는 영상과 같이 CSS로 좌우 반전되므로 원본 좌표 그대로 그린다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number,y:number}[]} lm 정규화 좌표 21개
 */
export function drawHand(ctx, lm, { color = '#F2A900', progress = 0 } = {}) {
  const { width: w, height: h } = ctx.canvas;
  const unit = Math.max(2, w / 160);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 테두리를 먼저 그려 밝은 배경에서도 보이게 한다
  for (const [stroke, width] of [['rgba(20,24,52,0.55)', unit * 2.6], [color, unit * 1.4]]) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
    }
    ctx.stroke();
  }
  ctx.fillStyle = '#FFFFFF';
  for (const i of TIPS) {
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, unit * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (progress > 0) {
    // 손목 둘레에 유지 시간을 표시
    const r = unit * 7;
    ctx.strokeStyle = color;
    ctx.lineWidth = unit * 1.4;
    ctx.beginPath();
    ctx.arc(lm[0].x * w, lm[0].y * h, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 기준 표본(63개 숫자)을 작은 캔버스에 획처럼 그린다.
 * @param {HTMLCanvasElement} canvas
 * @param {number[]} p toCanonical 결과
 * @param {boolean} selfie 거울처럼 보이게 좌우를 뒤집을지
 */
export function drawTemplate(canvas, p, { selfie = true, color = '#1C2240', accent = '#E03A2F' } = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = globalThis.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  if (canvas.width !== Math.round(cssW * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!p) return;
  const s = selfie ? -1 : 1;
  const pts = [];
  for (let i = 0; i < 21; i++) pts.push([s * p[i * 3], p[i * 3 + 1]]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = Math.min(cssW, cssH) * 0.14;
  const scale = Math.min((cssW - pad * 2) / (maxX - minX || 1), (cssH - pad * 2) / (maxY - minY || 1));
  const ox = (cssW - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (cssH - (maxY - minY) * scale) / 2 - minY * scale;
  const X = (i) => pts[i][0] * scale + ox;
  const Y = (i) => pts[i][1] * scale + oy;
  const unit = Math.min(cssW, cssH) / 40;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.lineWidth = unit * 1.6;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.moveTo(X(a), Y(a));
    ctx.lineTo(X(b), Y(b));
  }
  ctx.stroke();
  ctx.fillStyle = accent;
  for (const i of TIPS) {
    ctx.beginPath();
    ctx.arc(X(i), Y(i), unit * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
