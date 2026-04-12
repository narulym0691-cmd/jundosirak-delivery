// vehicle.js - 기사용 차량 점검 사진 업로드 + Gemini AI 채점

// ── 상수 ──────────────────────────────────────
const GEMINI_API_KEY = 'AIzaSyARaQ_iFPRKBhMOrRcX0fhQtLGlZtC7UHo';
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + GEMINI_API_KEY;

// 사진 타입별 최대 장수
const MAX_PHOTOS = { exterior: 2, interior: 2, checklist: 2 };

// ── 상태 ─────────────────────────────────────
let currentUser = null;
let yearMonth   = '';

// 사진 파일/URL 상태
// photos[type][index] = { file: File, dataUrl: string, storageUrl: string|null }
const photos = { exterior: [null, null], interior: [null, null], checklist: [null, null] };

// AI 평가 결과
let aiScore   = null; // { exterior, interior, checklist, total }
let aiComment = '';

// 현재 파일 인풋 대상
let _currentInputType  = null;
let _currentInputIndex = 0;

// 기존 제출 문서 ID (수정 시 사용)
let existingDocId = null;

// ── 초기화 ───────────────────────────────────
(function init() {
  currentUser = requireAuth(['driver']);
  if (!currentUser) return;

  yearMonth = getCurrentYearMonth();

  // 헤더 업데이트
  document.getElementById('headerSub').textContent =
    yearMonth + ' · ' + (currentUser.name || '');

  // 이번달 제출 현황 로드
  loadCurrentStatus();
})();

// ── 이번달 상태 로드 ─────────────────────────
async function loadCurrentStatus() {
  const banner  = document.getElementById('statusBanner');
  const textEl  = document.getElementById('statusText');
  const subEl   = document.getElementById('statusSub');

  try {
    const snap = await db.collection('vehicle_inspections')
      .where('driverId', '==', currentUser.uid)
      .where('yearMonth', '==', yearMonth)
      .limit(1)
      .get();

    if (!snap.empty) {
      const doc  = snap.docs[0];
      const data = doc.data();
      existingDocId = doc.id;

      if (data.status === 'submitted') {
        // 제출 완료 상태
        banner.className = 'status-banner submitted';
        banner.querySelector('.status-icon').textContent = '✅';
        textEl.textContent = '이번달 제출 완료!';
        subEl.textContent  = '점수: ' + (data.aiScore?.total ?? '-') + '/20점';
        showSubmittedResult(data);
        // 업로드 카드 숨김
        document.getElementById('uploadCard').style.display  = 'none';
        document.getElementById('submitCard').style.display  = 'none';
        document.getElementById('aiResultCard').style.display = 'none';
      } else {
        // draft 상태 (임시저장)
        banner.className = 'status-banner draft';
        banner.querySelector('.status-icon').textContent = '📝';
        textEl.textContent = '임시저장된 내용이 있습니다.';
        subEl.textContent  = '사진을 추가하고 제출을 완료해주세요.';
        // 기존 사진 복원
        restoreDraftPhotos(data);
      }
    } else {
      banner.className = 'status-banner none';
      banner.querySelector('.status-icon').textContent = '📋';
      textEl.textContent = '이번달 미제출';
      subEl.textContent  = '아래에서 사진을 업로드하고 제출해주세요.';
    }
  } catch (e) {
    console.error('상태 로드 실패:', e);
    textEl.textContent = '상태 확인 실패: ' + e.message;
  }
}

// 이미 제출된 결과 표시
function showSubmittedResult(data) {
  const card     = document.getElementById('submittedResultCard');
  const scoreBox = document.getElementById('submittedScoreBox');
  const photosEl = document.getElementById('submittedPhotos');

  card.style.display = 'block';

  const sc = data.aiScore || {};
  scoreBox.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
      <div style="background:#f0f4f1;border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:#718096;">외부</div>
        <div style="font-size:20px;font-weight:800;color:#1a4731;">${sc.exterior ?? '-'}<span style="font-size:12px;color:#a0aec0;">/7</span></div>
      </div>
      <div style="background:#f0f4f1;border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:#718096;">내부</div>
        <div style="font-size:20px;font-weight:800;color:#1a4731;">${sc.interior ?? '-'}<span style="font-size:12px;color:#a0aec0;">/7</span></div>
      </div>
      <div style="background:#f0f4f1;border-radius:10px;padding:10px;text-align:center;">
        <div style="font-size:11px;color:#718096;">점검표</div>
        <div style="font-size:20px;font-weight:800;color:#1a4731;">${sc.checklist ?? '-'}<span style="font-size:12px;color:#a0aec0;">/6</span></div>
      </div>
    </div>
    <div style="background:linear-gradient(135deg,#1a4731,#2d6a4f);color:#fff;border-radius:10px;padding:12px;text-align:center;margin-bottom:12px;">
      <div style="font-size:11px;opacity:0.75;">총점</div>
      <div style="font-size:32px;font-weight:900;">${sc.total ?? 0}<span style="font-size:16px;opacity:0.7;">/20</span></div>
    </div>
    ${data.aiComment ? `<div style="background:#f7fafc;border-left:3px solid #38a169;border-radius:0 8px 8px 0;padding:10px 12px;font-size:12px;color:#4a5568;line-height:1.6;">${escHtml(data.aiComment)}</div>` : ''}
  `;

  // 제출된 사진 표시
  const allUrls = [
    ...(data.photos?.exterior  || []),
    ...(data.photos?.interior  || []),
    ...(data.photos?.checklist || []),
  ].filter(Boolean);

  if (allUrls.length) {
    photosEl.innerHTML = `
      <div style="margin-top:14px;font-size:12px;font-weight:600;color:#718096;margin-bottom:8px;">제출된 사진 (${allUrls.length}장)</div>
      <div class="submitted-photos">
        ${allUrls.map(url => `<img src="${url}" onclick="openPhotoOverlay('${url.replace(/'/g, "\\'")}')">`).join('')}
      </div>
    `;
  }
}

// Draft 사진 복원
function restoreDraftPhotos(data) {
  if (!data.photos) return;
  ['exterior', 'interior', 'checklist'].forEach(type => {
    const urls = data.photos[type] || [];
    urls.forEach((url, idx) => {
      if (!url) return;
      photos[type][idx] = { file: null, dataUrl: url, storageUrl: url };
      renderPhotoSlot(type, idx, url);
    });
    updatePhotoCount(type);
  });
  updateUI();
}

// ── 파일 인풋 처리 ─────────────────────────
window.triggerFileInput = function(type, index) {
  _currentInputType  = type;
  _currentInputIndex = index;
  const input = document.getElementById('fileInput');
  input.value = '';
  input.click();
};

window.handleFileSelect = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const type  = _currentInputType;
  const index = _currentInputIndex;

  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    photos[type][index] = { file, dataUrl, storageUrl: null };
    renderPhotoSlot(type, index, dataUrl);
    updatePhotoCount(type);
    updateUI();
    // 새 사진 추가 시 AI 결과 초기화
    clearAIResult();
  };
  reader.readAsDataURL(file);
};

function renderPhotoSlot(type, index, src) {
  const prefix = type === 'exterior' ? 'ext' : type === 'interior' ? 'int' : 'chk';
  const slot   = document.getElementById(prefix + '-slot-' + index);
  if (!slot) return;

  slot.classList.add('has-photo');
  slot.innerHTML = `
    <img src="${src}" onclick="openPhotoOverlay('${src.replace(/'/g, "\\'")}')" alt="">
    <button class="photo-del-btn" onclick="deletePhoto(event,'${type}',${index})">×</button>
  `;
}

function clearPhotoSlot(type, index) {
  const prefix = type === 'exterior' ? 'ext' : type === 'interior' ? 'int' : 'chk';
  const slot   = document.getElementById(prefix + '-slot-' + index);
  if (!slot) return;

  slot.classList.remove('has-photo');
  slot.innerHTML = `
    <div class="photo-add-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M12 4v16m8-8H4"/>
      </svg>
      <span>추가</span>
    </div>
  `;
  slot.onclick = () => triggerFileInput(type, index);
}

window.deletePhoto = function(event, type, index) {
  event.stopPropagation();
  photos[type][index] = null;
  clearPhotoSlot(type, index);
  updatePhotoCount(type);
  updateUI();
  clearAIResult();
};

function updatePhotoCount(type) {
  const prefix = type === 'exterior' ? 'ext' : type === 'interior' ? 'int' : 'chk';
  const cnt    = photos[type].filter(Boolean).length;
  const el     = document.getElementById(prefix + '-count');
  if (el) el.textContent = cnt + '/' + MAX_PHOTOS[type];
}

function getTotalPhotoCount() {
  return ['exterior', 'interior', 'checklist']
    .reduce((sum, t) => sum + photos[t].filter(Boolean).length, 0);
}

function updateUI() {
  const total = getTotalPhotoCount();
  // AI 버튼: 사진 1장 이상
  document.getElementById('btnAI').disabled = (total === 0);
  // 제출 버튼: AI 평가 완료 후
  document.getElementById('btnSubmit').disabled = (aiScore === null);
}

// ── Gemini AI 평가 ─────────────────────────
window.requestAIEval = async function() {
  const btnAI   = document.getElementById('btnAI');
  const spinner = document.getElementById('aiSpinner');

  btnAI.disabled   = true;
  spinner.classList.add('show');
  clearAIResult();

  try {
    // 사진들을 base64로 수집
    const extImgs = await getBase64List('exterior');
    const intImgs = await getBase64List('interior');
    const chkImgs = await getBase64List('checklist');

    const hasExt = extImgs.length > 0;
    const hasInt = intImgs.length > 0;
    const hasChk = chkImgs.length > 0;

    // 점검표는 사진 존재 여부만으로 6점
    const checklistScore = hasChk ? 6 : 0;

    // 외부/내부가 없으면 0점 처리
    let exteriorScore = 0;
    let interiorScore = 0;
    let comment       = '';

    const allImages = [...extImgs, ...intImgs];
    if (allImages.length > 0) {
      // Gemini 프롬프트 구성
      const parts = [];

      // 텍스트 프롬프트
      parts.push({
        text: `당신은 배송 차량 청결도를 평가하는 전문가입니다.
아래 사진들을 분석하고 JSON 형식으로만 답하세요.

${hasExt ? `사진 ${extImgs.length}장: 차량 외부` : '외부 사진 없음'}
${hasInt ? `사진 ${intImgs.length}장: 차량 내부` : '내부 사진 없음'}

평가 기준:
- 외부 청결도 (0~7점): 차량 외부의 청결 상태, 흠집, 오염 여부
- 내부 청결도 (0~7점): 차량 내부의 청결 상태, 정리정돈, 위생 상태

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요:
{
  "exterior": <외부 점수 0~7, 외부 사진 없으면 0>,
  "interior": <내부 점수 0~7, 내부 사진 없으면 0>,
  "comment": "<한 줄 총평 (50자 이내)>"
}`
      });

      // 이미지 파트 추가
      allImages.forEach(({ base64, mimeType }) => {
        parts.push({ inlineData: { mimeType, data: base64 } });
      });

      const response = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 256 }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error('Gemini API 오류: ' + errText.slice(0, 120));
      }

      const result = await response.json();
      const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // JSON 파싱 (마크다운 코드블록 제거)
      const cleaned = rawText.replace(/```json\s*|\s*```/g, '').trim();
      const parsed  = JSON.parse(cleaned);

      exteriorScore = Math.max(0, Math.min(7, Math.round(Number(parsed.exterior) || 0)));
      interiorScore = Math.max(0, Math.min(7, Math.round(Number(parsed.interior) || 0)));
      comment       = String(parsed.comment || '').slice(0, 100);
    } else {
      comment = '사진이 없어 외부/내부 평가를 할 수 없습니다.';
    }

    // 결과 저장
    aiScore = {
      exterior:  exteriorScore,
      interior:  interiorScore,
      checklist: checklistScore,
      total:     exteriorScore + interiorScore + checklistScore
    };
    aiComment = comment;

    // 결과 표시
    showAIResult(aiScore, aiComment);
    updateUI();

  } catch (e) {
    console.error('AI 평가 오류:', e);
    alert('AI 평가에 실패했습니다.\n' + e.message + '\n\n수동으로 점수를 입력하거나 다시 시도해주세요.');
    // 실패 시 기본 점수로 진행 가능하게
    aiScore = { exterior: 0, interior: 0, checklist: 0, total: 0 };
    aiComment = 'AI 평가 실패 (네트워크 오류)';
    showAIResult(aiScore, aiComment);
    updateUI();
  } finally {
    spinner.classList.remove('show');
    document.getElementById('btnAI').disabled = (getTotalPhotoCount() === 0);
  }
};

async function getBase64List(type) {
  const result = [];
  for (const item of photos[type]) {
    if (!item) continue;
    if (item.file) {
      // 새로 선택한 파일
      const b64 = await fileToBase64(item.file);
      result.push({ base64: b64, mimeType: item.file.type || 'image/jpeg' });
    } else if (item.dataUrl && item.dataUrl.startsWith('data:')) {
      // 이미 dataUrl인 경우
      const [header, data] = item.dataUrl.split(',');
      const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
      result.push({ base64: data, mimeType });
    }
    // storageUrl만 있는 경우(이미 업로드된 사진)는 base64 불가 → 스킵
  }
  return result;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showAIResult(score, comment) {
  const card = document.getElementById('aiResultCard');
  card.classList.add('show');

  document.getElementById('score-exterior').textContent  = score.exterior;
  document.getElementById('score-interior').textContent  = score.interior;
  document.getElementById('score-checklist').textContent = score.checklist;
  document.getElementById('score-total').textContent     = score.total;

  document.getElementById('bar-exterior').style.width  = (score.exterior  / 7  * 100) + '%';
  document.getElementById('bar-interior').style.width  = (score.interior  / 7  * 100) + '%';
  document.getElementById('bar-checklist').style.width = (score.checklist / 6  * 100) + '%';

  document.getElementById('aiComment').textContent = comment || '';

  // 스크롤
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearAIResult() {
  aiScore   = null;
  aiComment = '';
  document.getElementById('aiResultCard').classList.remove('show');
}

// ── 제출 ─────────────────────────────────────
window.submitVehicleInspection = async function() {
  const btn    = document.getElementById('btnSubmit');
  const msgEl  = document.getElementById('submitMsg');

  btn.disabled    = true;
  btn.textContent = '업로드 중...';
  msgEl.style.color = '#276749';
  msgEl.textContent = '사진 업로드 중...';

  try {
    // 1. Firebase Storage에 사진 업로드
    const uploadedPhotos = { exterior: [], interior: [], checklist: [] };

    for (const type of ['exterior', 'interior', 'checklist']) {
      for (let i = 0; i < photos[type].length; i++) {
        const item = photos[type][i];
        if (!item) continue;

        if (item.storageUrl) {
          // 이미 업로드된 URL 재사용
          uploadedPhotos[type].push(item.storageUrl);
        } else if (item.file) {
          msgEl.textContent = `${typeLabel(type)} 사진 업로드 중... (${i+1}/${photos[type].filter(Boolean).length})`;
          const url = await uploadPhoto(item.file, type, i);
          uploadedPhotos[type].push(url);
          // 캐시
          photos[type][i].storageUrl = url;
        }
      }
    }

    // 2. Firestore 저장
    msgEl.textContent = '저장 중...';

    const record = {
      driverId:   currentUser.uid,
      driverName: currentUser.name,
      teamId:     currentUser.teamId || '',
      yearMonth,
      photos:     uploadedPhotos,
      aiScore:    aiScore || { exterior: 0, interior: 0, checklist: 0, total: 0 },
      aiComment:  aiComment || '',
      status:     'submitted',
      updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
    };

    if (existingDocId) {
      await db.collection('vehicle_inspections').doc(existingDocId).set(record, { merge: true });
    } else {
      record.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      const ref = await db.collection('vehicle_inspections').add(record);
      existingDocId = ref.id;
    }

    // 성공 UI
    msgEl.textContent = '✅ 제출 완료!';

    // 상태 배너 업데이트
    const banner = document.getElementById('statusBanner');
    banner.className = 'status-banner submitted';
    banner.querySelector('.status-icon').textContent = '✅';
    document.getElementById('statusText').textContent = '이번달 제출 완료!';
    document.getElementById('statusSub').textContent  = '점수: ' + (aiScore?.total ?? 0) + '/20점';

    // 업로드 카드 숨김, 결과 표시
    document.getElementById('uploadCard').style.display  = 'none';
    document.getElementById('submitCard').style.display  = 'none';
    document.getElementById('aiResultCard').style.display = 'none';
    showSubmittedResult({
      photos:     uploadedPhotos,
      aiScore:    aiScore,
      aiComment:  aiComment,
      status:     'submitted'
    });

  } catch (e) {
    msgEl.style.color = '#c53030';
    msgEl.textContent = '❌ 오류: ' + e.message;
    btn.disabled    = false;
    btn.textContent = '제출 완료';
  }
};

async function uploadPhoto(file, type, index) {
  const ext      = file.name.split('.').pop() || 'jpg';
  const fileName = `${type}_${index}_${Date.now()}.${ext}`;
  const path     = `vehicle/${currentUser.uid}/${yearMonth}/${fileName}`;
  const ref      = storage.ref(path);
  await ref.put(file);
  return await ref.getDownloadURL();
}

function typeLabel(type) {
  return type === 'exterior' ? '외부' : type === 'interior' ? '내부' : '점검표';
}

// ── 사진 오버레이 ──────────────────────────
window.openPhotoOverlay = function(src) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.92);z-index:9999;display:flex;align-items:center;justify-content:center;';
  overlay.onclick = () => overlay.remove();

  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'max-width:95%;max-height:92%;object-fit:contain;border-radius:8px;';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
};

// ── 유틸 ─────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
