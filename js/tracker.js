// 웹캠 영상에서 손 관절을 찾는다(MediaPipe Hand Landmarker, 브라우저 안에서 실행).
// 영상은 이 페이지 밖으로 나가지 않는다. 내려받는 것은 인식 프로그램과 모델 파일뿐이다.
import { toCanonical, worldToCanonical } from './features.js';

export const MP_VERSION = '1.2.3';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export async function loadLandmarker() {
  const { FilesetResolver, HandLandmarker } = await import(`${CDN}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch (err) {
    console.warn('GPU로 실행하지 못해 CPU로 실행합니다.', err);
    return HandLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

export async function startCamera(video) {
  // 원하는 해상도로 먼저 시도하고, 안 되면 조건 없이 다시 시도한다(카메라마다 지원하는 조건이 다르다)
  const attempts = [
    { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: true, audio: false },
  ];
  let lastError;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      video.srcObject = stream;
      await video.play();
      return stream;
    } catch (err) {
      lastError = err;
      console.warn('카메라 켜기 실패', constraints, err);
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') break; // 권한 문제는 다시 해도 같다
    }
  }
  throw lastError;
}

/**
 * 프레임마다 손 관절을 찾아 onFrame으로 넘긴다.
 * onFrame(frame): frame.hand가 false면 손이 안 보이는 것이다.
 */
export class HandTracker {
  constructor(landmarker, video, onFrame) {
    this.landmarker = landmarker;
    this.video = video;
    this.onFrame = onFrame;
    this.running = false;
    this.lastTime = -1;
    this.pRight = 0.5; // 오른손일 확률을 프레임마다 부드럽게 갱신(라벨이 한두 프레임 뒤집히는 것을 막는다)
    this.missing = 0;
    this.loop = this.loop.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  stop() {
    this.running = false;
  }

  loop() {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= 2 && v.currentTime !== this.lastTime) {
      this.lastTime = v.currentTime;
      const now = performance.now();
      try {
        const res = this.landmarker.detectForVideo(v, now);
        this.onFrame(this.toFrame(res, now));
      } catch (err) {
        console.error(err);
      }
    }
    requestAnimationFrame(this.loop);
  }

  toFrame(res, now) {
    const v = this.video;
    if (!res.landmarks?.length) {
      if (++this.missing > 15) this.pRight = 0.5;
      return { hand: false, now };
    }
    this.missing = 0;
    const lm = res.landmarks[0];
    const world = res.worldLandmarks?.[0];
    const cat = (res.handedness || res.handednesses)?.[0]?.[0];
    if (cat) {
      const right = cat.categoryName === 'Right' ? cat.score : 1 - cat.score;
      this.pRight = 0.7 * this.pRight + 0.3 * right;
    }
    // 'Left'로 보이는 손은 좌우를 뒤집어 한쪽 손 기준으로 맞춘다.
    // MediaPipe의 왼손·오른손 표시가 실제와 반대여도, 같은 손에는 늘 같은 처리가 되므로 녹화와 인식이 서로 맞는다.
    const mirror = this.pRight < 0.5;
    const aspect = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 4 / 3;
    return {
      hand: true,
      now,
      lm,
      mirror,
      p: toCanonical(lm, mirror, aspect),
      w: world ? worldToCanonical(world, mirror) : undefined,
    };
  }
}
