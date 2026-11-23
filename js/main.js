import { CONSONANTS, NAME_OF } from './consonants.js';
import { KnnClassifier, Smoother, Stabilizer } from './classifier.js';
import { Game } from './game.js';
import { TemplateStore } from './templates.js';
import { drawHand, drawTemplate } from './draw.js';
import { sfx, setSoundEnabled } from './sound.js';

const $ = (id) => document.getElementById(id);
const ORDER = CONSONANTS.map((c) => c.ch);
const RECORD = { countdownMs: 3000, captureMs: 2000, maxMs: 5000, minSamples: 12, every: 2 };
const HINT_DELAY_MS = 4000; // 60초 도전에서 힌트가 나오기까지
const RING = 2 * Math.PI * 54;
const BEST_KEY = 'ksl-fingerspelling/best';
const SOUND_KEY = 'ksl-fingerspelling/sound';

const store = new TemplateStore();
const clf = new KnnClassifier();
const smoother = new Smoother(5);
const stab = new Stabilizer();
const game = new Game({ duration: 60 });

const state = {
  mode: 'practice',
  camera: 'off', // off | loading | on | error
  frame: null,
  lastHandAt: 0,
  practiceTarget: null,
  selected: ORDER[0], // 기준 만들기에서 고른 자음
  rec: null, // 녹화 중인 상태
  attackCountdown: null,
  typed: '',
  cardHold: null, // 정답 표시 뒤 다음 자음으로 넘어가기 전까지의 잠깐
  noteTimer: 0,
};

let tracker = null;
let landmarkerPromise = null;

/* ---------- 조사 ---------- */
// 자음 이름은 모두 받침으로 끝난다(기역, 니은 …). '으로/로'만 ㄹ 받침(리을)일 때 '로'가 된다.
const ro = (ch) => (ch === 'ㄹ' ? '로' : '으로');

/* ---------- 기준 손모양 ---------- */
function refit() {
  clf.fit(store.merged(), (label) => store.sourceOf(label));
  if (state.practiceTarget && !hasTemplate(state.practiceTarget)) state.practiceTarget = null;
  renderAll();
}

function hasTemplate(ch) {
  return Boolean(store.sourceOf(ch));
}

function availableLabels() {
  return ORDER.filter(hasTemplate);
}

async function loadDefaults() {
  try {
    const res = await fetch('data/templates.json', { cache: 'no-cache' });
    if (res.ok) store.setDefaults(await res.json());
  } catch {
    // 기본 기준이 없어도 직접 녹화해서 쓸 수 있다
  }
  refit();
}

/* ---------- 카메라 ---------- */
async function enableCamera() {
  if (state.camera === 'loading' || state.camera === 'on') return;
  sfx.unlock();
  state.camera = 'loading';
  renderStage();
  const video = $('video');
  try {
    const { startCamera, loadLandmarker, HandTracker } = await import('./tracker.js');
    if (!landmarkerPromise) {
      landmarkerPromise = loadLandmarker();
      landmarkerPromise.catch(() => {}); // 카메라가 먼저 실패해도 처리되지 않은 오류로 남지 않게
    }
    await startCamera(video);
    let landmarker;
    try {
      landmarker = await landmarkerPromise;
    } catch (err) {
      landmarkerPromise = null;
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { kind: 'model' });
    }
    fitStageToVideo();
    tracker = new HandTracker(landmarker, video, onFrame);
    tracker.start();
    state.camera = 'on';
  } catch (err) {
    console.error(err);
    state.camera = 'error';
    $('stage-text').textContent = cameraErrorText(err);
  }
  renderStage();
}

function cameraErrorText(err) {
  if (err?.kind === 'model') return '손 인식 모델을 불러오지 못했어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.';
  if (err?.name === 'NotAllowedError') return '카메라 권한이 막혀 있어요. 주소창의 카메라 아이콘에서 허용한 뒤 다시 눌러 주세요.';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return '카메라를 찾지 못했어요. 카메라를 연결한 뒤 다시 눌러 주세요.';
  if (err?.name === 'NotReadableError' || err?.name === 'AbortError')
    return '카메라가 응답하지 않아요. Zoom·FaceTime처럼 카메라를 쓰는 프로그램을 닫고, 그래도 안 되면 Chrome을 완전히 종료했다가 다시 열어 주세요.';
  if (!navigator.mediaDevices) return '이 브라우저에서는 카메라를 쓸 수 없어요. 최신 Chrome이나 Safari로 열어 주세요.';
  return `카메라를 켜지 못했어요(${err?.name || '알 수 없는 오류'}). 페이지를 새로고침한 뒤 다시 눌러 주세요.`;
}

function fitStageToVideo() {
  const v = $('video');
  const w = v.videoWidth || 640;
  const h = v.videoHeight || 480;
  const c = $('overlay');
  c.width = w;
  c.height = h;
  $('stage').style.aspectRatio = `${w} / ${h}`;
}

/* ---------- 프레임 처리 ---------- */
function onFrame(frame) {
  state.frame = frame;
  if (frame.hand) state.lastHandAt = frame.now;
  const ctx = $('overlay').getContext('2d');
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (state.mode === 'record') {
    // 기준 만들기에서는 인식하지 않고 손만 그린다. 고리는 녹화 진행만 보여 준다.
    if (state.rec) handleRecording(frame);
    if (frame.hand) drawHand(ctx, frame.lm, { color: state.rec?.phase === 'capture' ? '#FFFFFF' : '#F2A900' });
    renderStageHint();
    return;
  }

  const pred = frame.hand && clf.size ? clf.predict(frame.p) : null;
  const sm = smoother.push(pred?.label ?? null, pred?.confidence ?? 0);
  const st = stab.push(sm.label, sm.confidence, frame.now);
  const target = currentTarget();
  const progress = target ? (st.candidate === target ? st.progress : 0) : st.progress;

  if (frame.hand) drawHand(ctx, frame.lm, { color: '#F2A900', progress });
  setRing(progress);
  if (state.mode === 'practice') {
    renderGuesses(frame.hand ? pred : null);
    if (!state.practiceTarget) {
      if (sm.label) setGlyph(sm.label);
      else setPlaceholder(!frame.hand ? '손을 보여 주세요' : clf.size ? '알아보는 중' : '기준 손모양이 없어요');
    }
  }
  if (st.committed) onCommit(st.committed, frame.now);
  renderStageHint();
}

function currentTarget() {
  if (state.mode === 'attack') return game.running ? game.target : null;
  if (state.mode === 'practice') return state.practiceTarget;
  return null;
}

function onCommit(label, now) {
  if (state.mode === 'practice') {
    state.typed = (state.typed + label).slice(-24);
    $('typed').textContent = state.typed;
    const target = state.practiceTarget;
    if (!target) return;
    if (label === target) {
      celebrate('정답');
      sfx.correct();
      clearTimeout(state.cardHold);
      state.cardHold = setTimeout(() => {
        state.cardHold = null;
        if (state.mode !== 'practice' || state.practiceTarget !== target) return;
        const list = availableLabels();
        const next = list[(list.indexOf(target) + 1) % list.length];
        // 확정 잠금은 그대로 둔다: 방금 맞힌 손모양을 계속 들고 있어도 다음 자음에서 오답으로 잡히지 않게
        selectPracticeTarget(next, { keepLock: true });
      }, 700);
    } else {
      note(`지금은 ${label}${ro(label)} 보여요.`);
    }
    return;
  }
  if (state.mode === 'attack' && game.running) {
    const r = game.submit(label);
    if (r.correct) {
      // 다음 자음은 늘 방금 것과 다르므로 확정 잠금을 풀지 않는다(같은 손모양을 들고 있어도 오답으로 잡히지 않게)
      celebrate(r.combo >= 3 ? `${r.combo}연속` : '정답');
      sfx.correct(r.combo);
      renderAttack();
      renderCard();
    } else if (r.wrong) {
      note(`지금은 ${r.wrong}${ro(r.wrong)} 보여요.`);
    }
  }
}

/* ---------- 연습 ---------- */
function selectPracticeTarget(ch, { keepLock = false } = {}) {
  state.practiceTarget = ch;
  if (!keepLock) {
    stab.reset();
    smoother.reset();
  }
  renderCard();
  renderLetters();
  renderPracticeLead();
}

function renderPracticeLead() {
  const lead = $('practice-lead');
  if (!clf.size) {
    lead.innerHTML = '';
    lead.append('아직 기준 손모양이 없어요. ', button('기준 만들기', () => setMode('record'), 'link'), '에서 자음을 녹화하면 연습할 수 있어요.');
    return;
  }
  lead.textContent = state.practiceTarget
    ? `${state.practiceTarget} 손모양을 만들어 잠깐 유지해 보세요. 맞히면 다음 자음으로 넘어가요. 자음을 한 번 더 누르면 자유 연습이에요.`
    : '보이는 손모양을 바로 알려 줘요. 아래에서 자음을 고르면 그 자음을 목표로 연습해요.';
}

function renderGuesses(pred) {
  const box = $('guesses');
  const rows = pred?.top?.slice(0, 3) ?? [];
  box.classList.toggle('unsure', Boolean(pred && !pred.known));
  const html = [];
  for (let i = 0; i < 3; i++) {
    const r = rows[i];
    const pct = r ? Math.round(r.score * 100) : 0;
    html.push(
      `<div class="guess${r ? '' : ' empty'}"><span class="g-glyph">${r ? r.label : ''}</span>` +
        `<span class="g-bar"><span style="width:${pct}%"></span></span>` +
        `<span class="g-pct">${r ? pct + '%' : ''}</span></div>`,
    );
  }
  const caption = !state.frame?.hand
    ? '손을 화면에 보여 주세요.'
    : pred && !pred.known
      ? '기준 손모양과 많이 달라서 확실하지 않아요.'
      : '지금 손모양과 가까운 자음';
  box.innerHTML = `<p class="g-caption">${caption}</p>${html.join('')}`;
}

/* ---------- 60초 도전 ---------- */
function startAttack() {
  sfx.unlock();
  if (state.camera !== 'on') return toast('먼저 카메라를 켜 주세요.');
  const labels = availableLabels();
  if (labels.length < 2) return toast('기준 손모양이 있는 자음이 2개 이상 있어야 시작할 수 있어요.');
  game.stop();
  game.reset();
  state.attackCountdown = { start: performance.now(), last: 4 };
  showPanelPart('live');
  renderAttack();
  renderCard();
}

function beginAttack() {
  state.attackCountdown = null;
  $('countdown').textContent = '';
  game.start(availableLabels());
  stab.reset();
  smoother.reset();
  sfx.go();
  renderAttack();
  renderCard();
  renderLetters();
}

function endAttack(result) {
  sfx.end();
  const best = Number(localStorage.getItem(BEST_KEY) || 0);
  const isBest = result.score > best;
  if (isBest) {
    try {
      localStorage.setItem(BEST_KEY, String(result.score));
    } catch {
      // 저장 못 해도 결과는 보여 준다
    }
  }
  $('final-score').textContent = result.score;
  $('final-correct').textContent = `${result.correct}개`;
  $('final-combo').textContent = `${result.maxCombo}번`;
  $('final-time').textContent = result.avgTime === null ? '-' : `${result.avgTime.toFixed(1)}초`;
  const notes = [];
  if (isBest && result.score > 0) notes.push('최고 점수예요.');
  if (result.skippedLetters.length) {
    notes.push(`건너뛴 자음: ${result.skippedLetters.map((s) => s.label).join(', ')}. 연습 모드에서 다시 해 보세요.`);
  }
  $('result-note').textContent = notes.join(' ');
  showPanelPart('result');
  renderBest();
  renderCard();
}

function renderAttack() {
  $('score').textContent = game.score;
  $('combo').textContent = game.combo;
  const left = state.attackCountdown ? game.duration : game.remaining();
  $('time-left').textContent = Math.ceil(left);
  $('timer-fill').style.transform = `scaleX(${left / game.duration})`;
}

function renderBest() {
  const best = Number(localStorage.getItem(BEST_KEY) || 0);
  $('best').textContent = best ? `이 브라우저 최고 점수 ${best}점` : '';
}

function showPanelPart(part) {
  $('attack-ready').hidden = part !== 'ready';
  $('attack-live').hidden = part !== 'live';
  $('attack-result').hidden = part !== 'result';
}

/* ---------- 기준 만들기 ---------- */
function startRecording() {
  sfx.unlock();
  if (state.camera !== 'on') return toast('먼저 카메라를 켜 주세요.');
  if (state.rec) return;
  state.rec = { label: state.selected, phase: 'countdown', start: performance.now(), last: 4, samples: [], frames: 0 };
  renderRecordPanel();
}

function handleRecording(frame) {
  const r = state.rec;
  const t = frame.now - r.start;
  if (r.phase === 'countdown') {
    const left = Math.ceil((RECORD.countdownMs - t) / 1000);
    if (left > 0 && left !== r.last) {
      r.last = left;
      $('countdown').textContent = left;
      sfx.tick();
    }
    if (t >= RECORD.countdownMs) {
      r.phase = 'capture';
      r.captureStart = frame.now;
      $('countdown').textContent = '';
      sfx.go();
    }
    return;
  }
  const ct = frame.now - r.captureStart;
  if (frame.hand) {
    r.frames++;
    if (r.frames % RECORD.every === 0) r.samples.push({ p: frame.p, w: frame.w, m: frame.mirror ? 1 : 0 });
  }
  setRing(Math.min(1, ct / RECORD.captureMs));
  if ((ct >= RECORD.captureMs && r.samples.length >= RECORD.minSamples) || ct >= RECORD.maxMs) finishRecording();
}

function finishRecording() {
  const r = state.rec;
  state.rec = null;
  setRing(0);
  $('countdown').textContent = '';
  if (r.samples.length < RECORD.minSamples) {
    sfx.wrong();
    toast('손이 잘 보이지 않아 녹화하지 못했어요. 손 전체가 화면에 들어오게 하고 다시 녹화해 주세요.');
    renderRecordPanel();
    return;
  }
  const res = store.addTake(r.label, r.samples);
  if (!res.saved) {
    toast('브라우저 저장 공간이 부족해 저장하지 못했어요. 기준 파일로 저장한 뒤 내 기준을 지우고 다시 시도해 주세요.');
    renderRecordPanel();
    return;
  }
  sfx.correct();
  celebrate('저장');
  refit();
  const takes = store.takes(r.label);
  if (takes >= 2) {
    const next = ORDER.find((ch) => store.takes(ch) < 2);
    if (next) {
      state.selected = next;
      renderAll();
      toast(`${r.label} ${takes}번째 녹화를 저장했어요. 다음은 ${next}이에요.`);
    } else {
      toast('자음 14개를 모두 두 번 이상 녹화했어요. 기준 점검을 눌러 확인해 보세요.');
    }
  } else {
    toast(`${r.label} 녹화를 저장했어요(표본 ${res.count}개). 손 각도를 조금 바꿔 한 번 더 녹화해 주세요.`);
  }
}

function renderRecordPanel() {
  const ch = state.selected;
  const local = store.takes(ch);
  const src = store.sourceOf(ch);
  const status =
    local > 0
      ? `${ch}: 내 기준 ${local}번 녹화, 표본 ${store.samples(ch)}개`
      : src === 'default'
        ? `${ch}: 기본 기준을 쓰는 중이에요. 녹화하면 내 기준으로 바뀌어요.`
        : `${ch}: 아직 녹화하지 않았어요.`;
  $('record-status').textContent = state.rec ? `${ch} 녹화 중이에요. 손모양을 유지해 주세요.` : status;
  $('record-btn').disabled = Boolean(state.rec);
  $('record-btn').textContent = state.rec ? '녹화 중' : `${ch} 녹화`;
  $('record-clear').disabled = local === 0 || Boolean(state.rec);
  const total = ORDER.filter((c) => store.takes(c) > 0).length;
  $('export-btn').disabled = total === 0;
  $('clear-all').hidden = total === 0;
  $('default-note').textContent = store.hasDefaults()
    ? '사이트에 들어 있는 기본 기준은 제작자의 손으로 녹화했어요. 내 손으로 녹화한 자음은 기본 기준 대신 쓰여요.'
    : '';
}

function runCheck() {
  const cv = clf.crossValidateByTake();
  const box = $('check-result');
  box.innerHTML = '';
  const p = (text) => {
    const el = document.createElement('p');
    el.textContent = text;
    box.append(el);
  };
  if (!clf.size) return p('녹화한 자음이 없어요.');
  if (!cv.n) {
    p('같은 자음을 두 번 이상 녹화해야 점검할 수 있어요. 서로 다른 녹화끼리 맞혀 보기 때문이에요.');
  } else {
    p(`두 번 이상 녹화한 자음 ${cv.tested.length}개를 서로 다른 녹화끼리 맞혀 봤어요. 맞힌 비율은 ${Math.round(cv.accuracy * 100)}%예요.`);
    const weak = Object.entries(cv.perLabel)
      .map(([label, s]) => ({ label, rate: s.ok / s.n }))
      .filter((s) => s.rate < 0.8)
      .sort((a, b) => a.rate - b.rate);
    if (weak.length) p(`다시 녹화하면 좋은 자음: ${weak.map((w) => `${w.label}(${Math.round(w.rate * 100)}%)`).join(', ')}`);
    for (const c of cv.confusions.slice(0, 3)) {
      p(c.to ? `${c.from}을 ${c.to}${ro(c.to)} 본 경우 ${c.count}번` : `${c.from}을 알아보지 못한 경우 ${c.count}번`);
    }
  }
  if (cv.skipped.length) p(`한 번만 녹화해서 점검에서 빠진 자음: ${cv.skipped.join(', ')}`);
  const pairs = clf.closestPairs(1);
  if (pairs.length) p(`손모양이 가장 비슷한 자음은 ${pairs[0].a}과 ${pairs[0].b}이에요.`);
}

function exportTemplates() {
  const blob = new Blob([store.exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `ksl-templates-${stamp}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('기준 파일을 저장했어요.');
}

async function importTemplates(file) {
  try {
    const n = store.importJson(await file.text());
    refit();
    toast(`기준 파일을 불러왔어요(자음 ${n}개).`);
  } catch {
    toast('기준 파일을 읽지 못했어요. 이 게임에서 저장한 JSON 파일인지 확인해 주세요.');
  }
}

/* ---------- 화면 그리기 ---------- */
function setMode(mode) {
  if (state.mode === mode) return;
  if (state.mode === 'attack' && (game.running || state.attackCountdown)) {
    game.stop();
    state.attackCountdown = null;
    $('countdown').textContent = '';
    showPanelPart('ready');
  }
  if (state.rec) {
    state.rec = null;
    $('countdown').textContent = '';
  }
  state.mode = mode;
  stab.reset();
  smoother.reset();
  setRing(0);
  document.body.dataset.mode = mode;
  for (const b of document.querySelectorAll('.mode')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== mode;
  renderAll();
}

function renderAll() {
  renderLetters();
  renderCard();
  renderPracticeLead();
  renderRecordPanel();
  renderAttack();
  renderBest();
  renderStage();
  if (state.mode === 'practice') renderGuesses(null);
}

function renderStage() {
  const cover = $('stage-cover');
  const btn = $('camera-btn');
  cover.hidden = state.camera === 'on';
  if (state.camera === 'off') {
    $('stage-text').textContent = '카메라를 켜면 손을 따라 관절이 그려져요. 영상은 이 브라우저 밖으로 나가지 않아요.';
    btn.textContent = '카메라 켜기';
    btn.disabled = false;
  } else if (state.camera === 'loading') {
    $('stage-text').textContent = '카메라와 손 인식 모델을 준비하고 있어요. 처음에는 몇 초 걸릴 수 있어요.';
    btn.textContent = '준비 중';
    btn.disabled = true;
  } else if (state.camera === 'error') {
    btn.textContent = '다시 시도';
    btn.disabled = false;
  }
}

function renderStageHint() {
  const hint = $('stage-hint');
  let text = '';
  if (state.camera === 'on') {
    if (state.frame && !state.frame.hand && state.frame.now - state.lastHandAt > 800) text = '손 전체가 화면 안에 들어오게 해 주세요.';
    else if (state.rec?.phase === 'capture') text = '기록하는 중이에요. 손을 조금씩 기울여 주세요.';
  }
  if (hint.textContent !== text) hint.textContent = text;
}

function setGlyph(ch) {
  const g = $('glyph');
  if (g.textContent !== ch) g.textContent = ch;
  g.classList.remove('muted');
  const name = NAME_OF[ch] || '';
  if ($('glyph-name').textContent !== name) $('glyph-name').textContent = name;
}

/** 보여 줄 자음이 없을 때: 흐린 물음표와 짧은 안내 */
function setPlaceholder(text, glyph = '?') {
  const g = $('glyph');
  if (g.textContent !== glyph) g.textContent = glyph;
  g.classList.add('muted');
  if ($('glyph-name').textContent !== text) $('glyph-name').textContent = text;
}

function renderCard() {
  let ch = null;
  let showHint = false;
  if (state.mode === 'practice') {
    ch = state.practiceTarget;
    showHint = Boolean(ch);
    if (ch) setGlyph(ch);
    else if (state.camera !== 'on') setPlaceholder(clf.size ? '카메라를 켜면 시작해요' : '기준 손모양이 없어요');
  } else if (state.mode === 'attack') {
    ch = game.running ? game.target : null;
    showHint = game.running && performance.now() - game.targetSince > HINT_DELAY_MS;
    if (ch) setGlyph(ch);
    else if (state.attackCountdown) setPlaceholder('준비', '');
    else if (!$('attack-result').hidden) setPlaceholder('', '끝');
    else setPlaceholder('시작을 누르면 나와요');
  } else {
    ch = state.selected;
    showHint = true;
    setGlyph(ch);
  }
  const rep = ch && showHint ? clf.representative(ch) : null;
  // 힌트는 화면(거울)에 보이는 방향으로 그린다. 좌우를 뒤집어 저장한 손이면 그대로, 아니면 뒤집어서.
  const mirrored = state.frame?.hand ? state.frame.mirror : Boolean(rep?.m);
  drawTemplate($('hint'), rep?.p, { selfie: !mirrored });
  $('hint').classList.toggle('blank', !rep);
  $('hint-caption').textContent = rep
    ? '기준 손모양(거울 방향)'
    : state.mode === 'attack' && game.running
      ? '4초가 지나면 힌트가 나와요'
      : ch && !hasTemplate(ch)
        ? '아직 기준 손모양이 없어요'
        : '';
  const link = $('dict-link');
  link.hidden = !ch || state.mode === 'attack';
  if (ch) link.href = dictUrl(ch);
}

// 한국수어사전 통합검색. 자음 이름(예: 기역)으로 찾으면 전문용어 수어에 'ㄱ[기역]' 항목이 나온다.
function dictUrl(ch) {
  return `https://sldict.korean.go.kr/front/search/searchAllList.do?searchKeyword=${encodeURIComponent(NAME_OF[ch])}`;
}

function renderLetters() {
  const ul = $('letters');
  if (!ul.children.length) {
    for (const { ch, name } of CONSONANTS) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'letter';
      b.dataset.ch = ch;
      b.innerHTML = `<span class="l-glyph">${ch}</span><span class="l-meta"></span>`;
      b.setAttribute('aria-label', `${ch} ${name}`);
      b.addEventListener('click', () => onLetter(ch));
      li.append(b);
      ul.append(li);
    }
  }
  for (const b of ul.querySelectorAll('.letter')) {
    const ch = b.dataset.ch;
    const meta = b.querySelector('.l-meta');
    let pressed = false;
    let disabled = false;
    let text = '';
    if (state.mode === 'practice') {
      pressed = state.practiceTarget === ch;
      disabled = !hasTemplate(ch);
    } else if (state.mode === 'attack') {
      disabled = true;
      pressed = game.running && game.target === ch;
      text = game.solved[ch] ? '✓'.repeat(Math.min(3, game.solved[ch])) : '';
    } else {
      pressed = state.selected === ch;
      const takes = store.takes(ch);
      text = takes ? `${takes}번` : store.sourceOf(ch) === 'default' ? '기본' : '';
    }
    b.setAttribute('aria-pressed', String(pressed));
    b.disabled = disabled;
    b.classList.toggle('no-template', state.mode !== 'record' && !hasTemplate(ch));
    b.classList.toggle('has-local', state.mode === 'record' && store.takes(ch) > 0);
    if (meta.textContent !== text) meta.textContent = text;
  }
}

function onLetter(ch) {
  sfx.unlock();
  if (state.mode === 'practice') {
    if (!hasTemplate(ch)) return;
    selectPracticeTarget(state.practiceTarget === ch ? null : ch);
  } else if (state.mode === 'record') {
    if (state.rec) return;
    state.selected = ch;
    renderAll();
  }
}

function setRing(progress) {
  const fill = $('ring');
  const offset = RING * (1 - Math.max(0, Math.min(1, progress)));
  fill.style.strokeDashoffset = offset.toFixed(1);
}

function celebrate(text) {
  const stamp = $('stamp');
  $('stamp-text').textContent = text;
  stamp.classList.remove('show');
  void stamp.offsetWidth; // 애니메이션을 처음부터 다시 시작
  stamp.classList.add('show');
}

function note(text) {
  const el = $('card-note');
  el.textContent = text;
  clearTimeout(state.noteTimer);
  state.noteTimer = setTimeout(() => (el.textContent = ''), 1400);
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
}

function button(text, onClick, className = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

/* ---------- 매 프레임 화면 갱신(타이머 등) ---------- */
function uiLoop() {
  const now = performance.now();
  if (state.attackCountdown) {
    const t = now - state.attackCountdown.start;
    const left = Math.ceil((3000 - t) / 1000);
    if (left > 0 && left !== state.attackCountdown.last) {
      state.attackCountdown.last = left;
      $('countdown').textContent = left;
      sfx.tick();
    }
    if (t >= 3000) beginAttack();
  }
  if (game.running) {
    renderAttack();
    const result = game.tick();
    if (result) endAttack(result);
    else {
      const wantHint = now - game.targetSince > HINT_DELAY_MS;
      if (wantHint !== state.attackHintShown || game.target !== state.attackHintTarget) {
        state.attackHintShown = wantHint;
        state.attackHintTarget = game.target;
        renderCard();
        renderLetters();
      }
    }
  }
  requestAnimationFrame(uiLoop);
}

/* ---------- 시작 ---------- */
function init() {
  document.body.dataset.mode = state.mode;
  for (const b of document.querySelectorAll('.mode')) b.addEventListener('click', () => setMode(b.dataset.mode));
  $('camera-btn').addEventListener('click', enableCamera);
  $('typed-clear').addEventListener('click', () => {
    state.typed = '';
    $('typed').textContent = '';
  });
  $('attack-start').addEventListener('click', startAttack);
  $('attack-again').addEventListener('click', startAttack);
  $('attack-skip').addEventListener('click', () => {
    if (!game.running) return;
    game.skip();
    stab.reset();
    renderAttack();
    renderCard();
    renderLetters();
  });
  $('record-btn').addEventListener('click', startRecording);
  $('record-clear').addEventListener('click', () => {
    store.clearLetter(state.selected);
    refit();
    toast(`${state.selected}의 내 기준을 지웠어요.`);
  });
  $('check-btn').addEventListener('click', runCheck);
  $('export-btn').addEventListener('click', exportTemplates);
  $('import-input').addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    if (f) importTemplates(f);
    e.target.value = '';
  });
  $('clear-all').addEventListener('click', () => {
    if (!$('clear-all').dataset.armed) {
      $('clear-all').dataset.armed = '1';
      $('clear-all').textContent = '한 번 더 누르면 모두 지워요';
      setTimeout(() => {
        delete $('clear-all').dataset.armed;
        $('clear-all').textContent = '내 기준 모두 지우기';
      }, 3000);
      return;
    }
    delete $('clear-all').dataset.armed;
    $('clear-all').textContent = '내 기준 모두 지우기';
    store.clearAll();
    refit();
    toast('내 기준을 모두 지웠어요.');
  });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && state.mode === 'attack' && game.running && !e.target.closest?.('input, textarea')) {
      e.preventDefault();
      $('attack-skip').click();
    }
  });
  const soundOn = localStorage.getItem(SOUND_KEY) !== 'off';
  setSound(soundOn);
  $('sound-btn').addEventListener('click', () => setSound($('sound-btn').getAttribute('aria-pressed') !== 'true'));

  const m = location.pathname.split('/').filter(Boolean);
  if (location.hostname.endsWith('github.io') && m.length) {
    const owner = location.hostname.split('.')[0];
    $('repo-link').href = `https://github.com/${owner}/${m[0]}`;
  }

  if (new URLSearchParams(location.search).has('test')) exposeTestHooks();
  renderAll();
  loadDefaults();
  requestAnimationFrame(uiLoop);
}

function setSound(on) {
  setSoundEnabled(on);
  $('sound-btn').setAttribute('aria-pressed', String(on));
  $('sound-btn').textContent = on ? '소리 켬' : '소리 끔';
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // 무시
  }
}

// 자동 테스트용: 카메라 없이 손 관절 데이터를 직접 넣어 본다(?test 주소에서만)
function exposeTestHooks() {
  window.__ksl = {
    store,
    clf,
    game,
    state,
    refit,
    cameraOn() {
      state.camera = 'on';
      renderStage();
    },
    feed(frame) {
      onFrame({ ...frame, now: frame.now ?? performance.now() });
    },
  };
}

init();
