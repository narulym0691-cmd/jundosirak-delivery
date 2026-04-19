// evaluation.js - 업무수행평가 페이지 로직

// ── 상수 ──────────────────────────────────────
const TEAM_NAMES = {
  team1: '1팀 준고',
  team2: '2팀 해운대',
  team3: '3팀',
  team4: '4팀 연수남',
  team5: '5팀 아가리',
  team6: '6팀',
  team7: '7팀 강서영'
};

// 정량 평가 항목 정의
const QUANT_ITEMS = [
  { key: 'late',        name: '근태 지각',           pointsPer: -2  },
  { key: 'nodir',       name: '지시사항 미이행',       pointsPer: -3  },
  { key: 'wrong',       name: '오배송/누락',           pointsPer: -5  },
  { key: 'signal',      name: '신호위반',              pointsPer: -3  },
  { key: 'accident',    name: '사고',                  pointsPer: -10 },
  { key: 'noheater',    name: '발열통 미제작',          pointsPer: -5  },
  { key: 'lostreport',  name: '끊긴 업체 미보고',       pointsPer: -3  },
  { key: 'newsales',    name: '신규 영업 연결 성공',    pointsPer: +5  },
];

// 동료평가 항목
const PEER_CRITERIA = [
  { key: 'teamwork',    name: '팀화합'      },
  { key: 'cooperation', name: '동료협력'    },
  { key: 'attitude',    name: '긍정적 태도' },
  { key: 'reputation',  name: '배송 평판'   },
];

// ── 전역 상태 ────────────────────────────────
let currentUser = null;    // 현재 로그인 유저
let allDrivers  = [];      // 전체 기사 목록
let myTeamId    = null;    // 현재 유저의 팀 ID

// 동료평가 상태: { driverId: { teamwork:0, cooperation:0, attitude:0, reputation:0, reviewDocId: null } }
let peerState = {};

// 월별집계 상태
let lastAggData = null;    // 마지막 집계 결과 (시상기록 저장에 사용)

// ── 초기화 ───────────────────────────────────
(function init() {
  // 권한 체크: admin, manager, leader만 접근
  currentUser = requireAuth(['admin', 'manager', 'leader']);
  if (!currentUser) return;

  myTeamId = currentUser.teamId || null;

  // 헤더 뒤로가기 설정
  const backBtn = document.getElementById('backBtn');
  if (['admin', 'manager'].includes(currentUser.role)) {
    backBtn.href = '/admin.html';
  } else {
    backBtn.href = '/dashboard.html';
  }

  const sub = document.getElementById('headerSub');
  sub.textContent = currentUser.name + ' · ' + (TEAM_NAMES[myTeamId] || '');

  // 탭 노출 권한 설정
  applyTabPermissions();

  // 기사 목록 로드
  loadDrivers().then(() => {
    // 기본 탭 선택
    if (['admin', 'manager'].includes(currentUser.role)) {
      switchTab('quant');
    } else {
      switchTab('peer');
    }
  });

  // 날짜 기본값
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  document.getElementById('q-date').value = todayStr;

  // 정량 점수 미리보기 이벤트
  QUANT_ITEMS.forEach(item => {
    const el = document.getElementById('q-' + item.key);
    if (el) el.addEventListener('input', updateQuantPreview);
  });

  // 월별집계 기본 연월
  const ym = getCurrentYearMonth();
  document.getElementById('m-month').value = ym;

  // 동료평가 연월 표시
  document.getElementById('peerYearMonth').textContent = ym;
})();

// ── 탭 권한 제어 ─────────────────────────────
function applyTabPermissions() {
  const isAdmin = ['admin', 'manager'].includes(currentUser.role);
  const isLeader = currentUser.role === 'leader';

  if (isLeader) {
    // 리더: 탭2(동료평가)만 보임
    document.getElementById('tabBtn-quant').style.display   = 'none';
    document.getElementById('tabBtn-monthly').style.display = 'none';
    document.getElementById('panel-quant').innerHTML =
      '<div class="access-denied">⛔ 관리자만 접근할 수 있습니다.</div>';
    document.getElementById('panel-monthly').innerHTML =
      '<div class="access-denied">⛔ 관리자만 접근할 수 있습니다.</div>';
  }

  if (isAdmin) {
    // 관리자: 모든 탭 보임 (기본값)
  }
}

// ── 탭 전환 ──────────────────────────────────
function switchTab(tab) {
  ['quant', 'peer', 'monthly'].forEach(t => {
    document.getElementById('panel-' + t).classList.toggle('active', t === tab);
    const btn = document.getElementById('tabBtn-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
  });

  if (tab === 'peer') loadPeerTab();
}
window.switchTab = switchTab;

// ── 기사 목록 로드 ───────────────────────────
async function loadDrivers() {
  try {
    const snap = await db.collection('users').get();
    allDrivers = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.role !== 'admin' && d.role !== 'manager' && d.active !== false) {
        allDrivers.push({ id: doc.id, ...d });
      }
    });
    allDrivers.sort((a, b) => (a.teamId || '').localeCompare(b.teamId || '') || (a.name || '').localeCompare(b.name || ''));

    // 기사 선택 드롭다운 채우기
    const sel = document.getElementById('q-driver');
    sel.innerHTML = '<option value="">-- 기사 선택 --</option>';
    allDrivers.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name + ' (' + (TEAM_NAMES[d.teamId] || d.teamId || '-') + ')';
      sel.appendChild(opt);
    });
  } catch (e) {
    console.error('기사 목록 로드 실패:', e);
  }
}

// ── 정량 기록 ────────────────────────────────

// 점수 미리보기 업데이트
function updateQuantPreview() {
  let total = 0;
  QUANT_ITEMS.forEach(item => {
    const el = document.getElementById('q-' + item.key);
    const count = parseInt(el?.value) || 0;
    total += count * item.pointsPer;
  });
  const el = document.getElementById('q-preview-score');
  el.textContent = (total >= 0 ? '+' : '') + total + '점';
  el.style.color = total > 0 ? '#276749' : total < 0 ? '#e53e3e' : '#1a4731';
}

// 저장
window.saveQuantRecord = async function() {
  const driverId = document.getElementById('q-driver').value;
  const date     = document.getElementById('q-date').value;
  const memo     = document.getElementById('q-memo').value.trim();
  const msgEl    = document.getElementById('q-msg');

  if (!driverId) { showMsg(msgEl, '❌ 기사를 선택해주세요.', 'err'); return; }
  if (!date)     { showMsg(msgEl, '❌ 날짜를 선택해주세요.', 'err'); return; }

  const driver   = allDrivers.find(d => d.id === driverId);
  const yearMonth = date.slice(0, 7);

  // 각 항목 수집
  const items = [];
  let totalPoints = 0;
  QUANT_ITEMS.forEach(item => {
    const el    = document.getElementById('q-' + item.key);
    const count = parseInt(el?.value) || 0;
    if (count !== 0) {
      const t = count * item.pointsPer;
      items.push({ name: item.name, count, pointsPer: item.pointsPer, total: t });
      totalPoints += t;
    }
  });

  if (items.length === 0) {
    showMsg(msgEl, '❌ 입력된 항목이 없습니다.', 'err');
    return;
  }

  const record = {
    driverId,
    driverName:  driver?.name || '',
    teamId:      driver?.teamId || '',
    date,
    yearMonth,
    items,
    totalPoints,
    memo,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  showMsg(msgEl, '저장 중...', 'ok');
  try {
    await db.collection('quantitative_records').add(record);
    showMsg(msgEl, '✅ 저장 완료!', 'ok');
    resetQuantForm();
    loadDriverRecords();
  } catch (e) {
    showMsg(msgEl, '❌ 오류: ' + e.message, 'err');
  }
};

// 폼 초기화
function resetQuantForm() {
  QUANT_ITEMS.forEach(item => {
    const el = document.getElementById('q-' + item.key);
    if (el) el.value = 0;
  });
  document.getElementById('q-memo').value = '';
  updateQuantPreview();
}

// 해당 기사의 이번달 기록 로드
window.loadDriverRecords = async function() {
  const driverId = document.getElementById('q-driver').value;
  if (!driverId) {
    document.getElementById('quantRecordsCard').style.display = 'none';
    return;
  }

  const driver     = allDrivers.find(d => d.id === driverId);
  const yearMonth  = getCurrentYearMonth();
  const card       = document.getElementById('quantRecordsCard');
  const titleEl    = document.getElementById('quantRecordsTitle');
  const listEl     = document.getElementById('quantRecordsList');

  card.style.display  = 'block';
  titleEl.textContent = (driver?.name || '') + ' - ' + yearMonth + ' 기록';
  listEl.innerHTML    = '<div class="loading">로딩 중...</div>';

  try {
    const snap = await db.collection('quantitative_records')
      .where('driverId', '==', driverId)
      .where('yearMonth', '==', yearMonth)
      .orderBy('date', 'desc')
      .get();

    if (snap.empty) {
      listEl.innerHTML = '<div class="empty-state">이번달 기록이 없습니다.</div>';
      return;
    }

    let html = '';
    snap.forEach(doc => {
      const r   = doc.data();
      const pts = r.totalPoints || 0;
      const scoreClass = pts > 0 ? 'pos' : pts < 0 ? 'neg' : 'zero';
      const scoreSign  = pts > 0 ? '+' : '';

      // 태그
      const tags = (r.items || []).map(item => {
        const cls = item.pointsPer > 0 ? 'positive' : 'negative';
        return `<span class="record-tag ${cls}">${item.name} ${item.count}건</span>`;
      }).join('');

      const borderClass = pts > 0 ? 'has-plus' : pts < 0 ? 'has-minus' : '';

      html += `
        <div class="record-item ${borderClass}" id="rec-${doc.id}">
          <div class="record-info">
            <div class="record-date">${r.date}</div>
            <div class="record-items">${tags || '<span style="color:#a0aec0;font-size:11px;">항목 없음</span>'}</div>
            ${r.memo ? `<div class="record-memo">"${escHtml(r.memo)}"</div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
            <span class="record-score ${scoreClass}">${scoreSign}${pts}점</span>
            <button class="btn-danger" onclick="deleteQuantRecord('${doc.id}')">삭제</button>
          </div>
        </div>
      `;
    });

    listEl.innerHTML = html;
  } catch (e) {
    listEl.innerHTML = `<div style="color:#c53030;text-align:center;padding:20px;">오류: ${e.message}</div>`;
  }
};

// 기록 삭제
window.deleteQuantRecord = async function(docId) {
  if (!confirm('이 기록을 삭제하시겠습니까?')) return;
  try {
    await db.collection('quantitative_records').doc(docId).delete();
    document.getElementById('rec-' + docId)?.remove();
  } catch (e) {
    alert('삭제 오류: ' + e.message);
  }
};

// ── 동료/팀 평가 ─────────────────────────────

async function loadPeerTab() {
  const listEl  = document.getElementById('peerDriverList');
  const yearMonth = getCurrentYearMonth();
  document.getElementById('peerYearMonth').textContent = yearMonth;
  listEl.innerHTML = '<div class="loading">팀원 목록 로딩 중...</div>';

  // 평가 대상: 리더는 본인 팀만, 관리자는 전체
  const isAdmin = ['admin', 'manager'].includes(currentUser.role);
  const targets = isAdmin
    ? allDrivers
    : allDrivers.filter(d => d.teamId === myTeamId);

  if (targets.length === 0) {
    listEl.innerHTML = '<div class="empty-state">평가할 팀원이 없습니다.</div>';
    return;
  }

  // 이미 제출한 리뷰 로드
  peerState = {};
  try {
    const snap = await db.collection('peer_reviews')
      .where('reviewerId', '==', currentUser.uid || currentUser.id)
      .where('yearMonth', '==', yearMonth)
      .get();
    snap.forEach(doc => {
      const d = doc.data();
      peerState[d.targetId] = {
        teamwork:    d.scores?.teamwork    || 0,
        cooperation: d.scores?.cooperation || 0,
        attitude:    d.scores?.attitude    || 0,
        reputation:  d.scores?.reputation  || 0,
        docId:       doc.id
      };
    });
  } catch (e) {
    console.warn('기존 리뷰 로드 실패:', e);
  }

  // 팀별 그룹핑
  const groups = {};
  targets.forEach(d => {
    const key = d.teamId || 'none';
    if (!groups[key]) groups[key] = [];
    groups[key].push(d);
  });

  let html = '';
  const teamOrder = ['team1','team2','team3','team4','team5','team6','team7','none'];
  teamOrder.forEach(tid => {
    const members = groups[tid];
    if (!members || !members.length) return;

    if (isAdmin) {
      html += `<div style="font-size:12px;font-weight:700;color:#718096;padding:4px 0 8px;margin-top:8px;">${TEAM_NAMES[tid] || tid}</div>`;
    }

    members.forEach(driver => {
      const saved  = peerState[driver.id];
      const isDone = saved && PEER_CRITERIA.some(c => saved[c.key] > 0);
      const criteriaHtml = PEER_CRITERIA.map(c => {
        const score = saved?.[c.key] || 0;
        return `
          <div class="eval-criterion">
            <span class="criterion-name">${c.name}</span>
            <div class="star-row" id="stars-${driver.id}-${c.key}">
              ${[1,2,3,4,5].map(n =>
                `<span class="star ${score >= n ? 'filled' : ''}"
                  onclick="setStar('${driver.id}','${c.key}',${n})">★</span>`
              ).join('')}
            </div>
          </div>
        `;
      }).join('');

      html += `
        <div class="driver-eval-card ${isDone ? 'done' : ''}" id="evalcard-${driver.id}">
          <div class="driver-eval-header">
            <span class="driver-eval-name">${escHtml(driver.name)}</span>
            ${isDone ? '<span class="done-badge">✅ 평가완료 (수정가능)</span>' : ''}
          </div>
          <div class="eval-criteria">${criteriaHtml}</div>
        </div>
      `;
    });
  });

  listEl.innerHTML = html;
}

// 별점 클릭
window.setStar = function(driverId, criterion, value) {
  if (!peerState[driverId]) {
    peerState[driverId] = { teamwork:0, cooperation:0, attitude:0, reputation:0, docId:null };
  }
  peerState[driverId][criterion] = value;

  // UI 업데이트
  const row = document.getElementById('stars-' + driverId + '-' + criterion);
  if (row) {
    row.querySelectorAll('.star').forEach((star, idx) => {
      star.classList.toggle('filled', idx < value);
    });
  }
};

// 전체 저장
window.savePeerReviews = async function() {
  const msgEl    = document.getElementById('peer-msg');
  const yearMonth = getCurrentYearMonth();
  const reviewerId   = currentUser.uid || currentUser.id;
  const reviewerName = currentUser.name;
  const isAdmin      = ['admin', 'manager'].includes(currentUser.role);

  const targets = isAdmin
    ? allDrivers
    : allDrivers.filter(d => d.teamId === myTeamId);

  if (targets.length === 0) {
    showMsg(msgEl, '❌ 저장할 팀원이 없습니다.', 'err');
    return;
  }

  showMsg(msgEl, '저장 중...', 'ok');

  try {
    const batch = db.batch();

    targets.forEach(driver => {
      const state = peerState[driver.id];
      if (!state) return;

      const hasAnyScore = PEER_CRITERIA.some(c => state[c.key] > 0);
      if (!hasAnyScore) return;

      const data = {
        reviewerId,
        reviewerName,
        targetId:   driver.id,
        targetName: driver.name,
        teamId:     driver.teamId || '',
        scores: {
          teamwork:    state.teamwork    || 0,
          cooperation: state.cooperation || 0,
          attitude:    state.attitude    || 0,
          reputation:  state.reputation  || 0,
        },
        yearMonth,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };

      if (state.docId) {
        // 기존 문서 수정
        batch.set(db.collection('peer_reviews').doc(state.docId), data, { merge: true });
      } else {
        // 새 문서
        const ref = db.collection('peer_reviews').doc();
        batch.set(ref, data);
        state.docId = ref.id;
      }

      // done 표시
      const card = document.getElementById('evalcard-' + driver.id);
      if (card) {
        card.classList.add('done');
        const header = card.querySelector('.driver-eval-header');
        if (header && !header.querySelector('.done-badge')) {
          header.insertAdjacentHTML('beforeend', '<span class="done-badge">✅ 평가완료 (수정가능)</span>');
        }
      }
    });

    await batch.commit();
    showMsg(msgEl, '✅ 저장 완료!', 'ok');
  } catch (e) {
    showMsg(msgEl, '❌ 오류: ' + e.message, 'err');
  }
};

// ── 월별 집계 ────────────────────────────────

window.loadMonthlyAggregation = async function() {
  const month     = document.getElementById('m-month').value;
  const container = document.getElementById('monthlyContent');
  const awardCard = document.getElementById('awardSaveCard');

  if (!month) { alert('연월을 선택해주세요.'); return; }

  container.innerHTML = '<div class="loading">집계 중...</div>';
  awardCard.style.display = 'none';
  lastAggData = null;

  try {
    // 1. 정량 기록 로드
    const quantSnap = await db.collection('quantitative_records')
      .where('yearMonth', '==', month).get();

    // 기사별 정량 합산
    const quantByDriver = {}; // { driverId: totalPoints }
    quantSnap.forEach(doc => {
      const r = doc.data();
      quantByDriver[r.driverId] = (quantByDriver[r.driverId] || 0) + (r.totalPoints || 0);
    });

    // 2. 동료평가 로드
    const peerSnap = await db.collection('peer_reviews')
      .where('yearMonth', '==', month).get();

    // 기사별 동료평가 점수 집계 { driverId: {sum, count} }
    const peerByDriver = {};
    peerSnap.forEach(doc => {
      const r = doc.data();
      const avg = ((r.scores?.teamwork || 0) + (r.scores?.cooperation || 0) +
                   (r.scores?.attitude || 0) + (r.scores?.reputation || 0)) / 4;
      if (!peerByDriver[r.targetId]) peerByDriver[r.targetId] = { sum: 0, cnt: 0 };
      peerByDriver[r.targetId].sum += avg;
      peerByDriver[r.targetId].cnt += 1;
    });

    // 3. AI 차량 점수 로드 (vehicle_inspections 컬렉션)
    let vehicleMap = {}; // { driverId: aiScore.total (0~20) }
    try {
      const vSnap = await db.collection('vehicle_inspections')
        .where('yearMonth', '==', month)
        .where('status', '==', 'submitted')
        .get();
      vSnap.forEach(doc => {
        const d = doc.data();
        vehicleMap[d.driverId] = d.aiScore?.total || 0;
      });
    } catch (e) {
      // vehicle_inspections 없으면 무시
    }

    // 3-1. 피드백 이행/미이행 로드 (driver_feedback_log)
    // 기사명 기준으로 집계 (driverName 필드)
    const feedbackMap = {}; // { driverName: { done, expired } }
    try {
      const fbSnap = await db.collection('driver_feedback_log')
        .where('yearMonth', '==', month)
        .get();
      fbSnap.forEach(doc => {
        const f = doc.data();
        const nm = f.driverName || '';
        if (!nm) return;
        if (!feedbackMap[nm]) feedbackMap[nm] = { done: 0, expired: 0 };
        if (f.status === 'done')    feedbackMap[nm].done++;
        if (f.status === 'expired') feedbackMap[nm].expired++;
      });
    } catch (e) {
      // driver_feedback_log 없으면 무시
    }

    // 4. 팀별 집계
    const teamStats = {}; // { teamId: { drivers:[], quantSum, peerSum, vehicleSum } }
    allDrivers.forEach(driver => {
      const tid = driver.teamId || 'none';
      if (!teamStats[tid]) {
        teamStats[tid] = { drivers: [], quantTotal: 0, peerTotal: 0, vehicleTotal: 0 };
      }

      const qPts    = quantByDriver[driver.id]   || 0;
      const peerAvg = peerByDriver[driver.id]
        ? peerByDriver[driver.id].sum / peerByDriver[driver.id].cnt
        : 0;

      // 피드백 점수: 이행 +1점/건, 미이행 -2점/건
      const fbData   = feedbackMap[driver.name] || { done: 0, expired: 0 };
      const fbPts    = (fbData.done * 1) + (fbData.expired * -2);

      // 정량 점수: 50 기준에서 가감 (최소 0) — 피드백 포함
      const quantScore  = Math.max(0, 50 + qPts + fbPts);
      // 동료평가: 평균 별점(1~5) → 30점 환산
      const peerScore   = Math.round(peerAvg / 5 * 30);
      // 차량: AI 채점 결과 (0~20), 미제출 0점
      const vehicleScore = vehicleMap[driver.id] || 0;

      teamStats[tid].drivers.push({
        id: driver.id, name: driver.name,
        quantRaw: qPts, fbPts,
        fbDone: fbData.done, fbExpired: fbData.expired,
        quantScore,
        peerAvg: Math.round(peerAvg * 10) / 10, peerScore,
        vehicleScore,
        total: quantScore + peerScore + vehicleScore
      });
      teamStats[tid].quantTotal   += quantScore;
      teamStats[tid].peerTotal    += peerScore;
      teamStats[tid].vehicleTotal += vehicleScore;
    });

    // 팀 평균 계산 및 정렬
    const teamRows = Object.entries(teamStats).map(([tid, stat]) => {
      const cnt = stat.drivers.length || 1;
      return {
        teamId:        tid,
        teamName:      TEAM_NAMES[tid] || tid,
        quantAvg:      Math.round(stat.quantTotal / cnt),
        peerAvg:       Math.round(stat.peerTotal  / cnt),
        vehicleAvg:    Math.round(stat.vehicleTotal / cnt),
        totalAvg:      Math.round((stat.quantTotal + stat.peerTotal + stat.vehicleTotal) / cnt),
        drivers:       stat.drivers
      };
    }).filter(r => r.drivers.length > 0);

    teamRows.sort((a, b) => b.totalAvg - a.totalAvg);
    teamRows.forEach((r, i) => { r.rank = i + 1; });

    // 저장용 데이터
    lastAggData = { month, teamRows };

    // 5. 테이블 렌더링
    if (!teamRows.length) {
      container.innerHTML = '<div class="empty-state">해당 월의 평가 데이터가 없습니다.</div>';
      return;
    }

    let html = `
      <div style="overflow-x:auto;">
      <table class="score-table">
        <thead>
          <tr>
            <th>팀명</th>
            <th>정량(50점)</th>
            <th>동료(30점)</th>
            <th>차량(20점)</th>
            <th>합계(100점)</th>
            <th>순위</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
    `;

    teamRows.forEach(r => {
      const rankClass = r.rank <= 3 ? 'rank-' + r.rank : '';
      html += `
        <tr>
          <td><strong>${escHtml(r.teamName)}</strong></td>
          <td>${r.quantAvg}</td>
          <td>${r.peerAvg}</td>
          <td>${r.vehicleAvg}</td>
          <td><strong style="color:#1a4731;">${r.totalAvg}</strong></td>
          <td><span class="rank-badge ${rankClass}">${r.rank}</span></td>
          <td><button class="detail-toggle" onclick="toggleDetail('detail-${r.teamId}')">상세</button></td>
        </tr>
        <tr>
          <td colspan="8" style="padding:0;">
            <div class="detail-panel" id="detail-${r.teamId}">
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr style="color:#718096;">
                    <th style="padding:5px;text-align:left;">기사</th>
                    <th style="padding:5px;text-align:center;">정량(가감)</th>
                    <th style="padding:5px;text-align:center;">피드백(가감)</th>
                    <th style="padding:5px;text-align:center;">정량점수</th>
                    <th style="padding:5px;text-align:center;">동료평균</th>
                    <th style="padding:5px;text-align:center;">동료점수</th>
                    <th style="padding:5px;text-align:center;">차량</th>
                    <th style="padding:5px;text-align:center;">합계</th>
                  </tr>
                </thead>
                <tbody>
                  ${r.drivers.map(d => {
                    const fbSign = d.fbPts >= 0 ? '+' : '';
                    const fbColor = d.fbPts > 0 ? '#276749' : d.fbPts < 0 ? '#c53030' : '#718096';
                    const fbTip = d.fbDone || d.fbExpired
                      ? `이행 ${d.fbDone}건 / 미이행 ${d.fbExpired}건`
                      : '피드백 없음';
                    return `
                    <tr style="border-top:1px solid #f0f4f1;">
                      <td style="padding:5px;">${escHtml(d.name)}</td>
                      <td style="padding:5px;text-align:center;color:${d.quantRaw >= 0 ? '#276749' : '#c53030'};">
                        ${d.quantRaw >= 0 ? '+' : ''}${d.quantRaw}
                      </td>
                      <td style="padding:5px;text-align:center;color:${fbColor};" title="${fbTip}">
                        ${d.fbPts !== 0 ? fbSign + d.fbPts : '-'}
                        ${d.fbExpired > 0 ? `<span style="font-size:10px;color:#e53e3e;"> (미이행${d.fbExpired})</span>` : ''}
                      </td>
                      <td style="padding:5px;text-align:center;">${d.quantScore}</td>
                      <td style="padding:5px;text-align:center;">${d.peerAvg > 0 ? d.peerAvg + '점' : '-'}</td>
                      <td style="padding:5px;text-align:center;">${d.peerScore}</td>
                      <td style="padding:5px;text-align:center;">${d.vehicleScore > 0 ? d.vehicleScore + '점' : '❌'}</td>
                      <td style="padding:5px;text-align:center;font-weight:700;">${d.total}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      `;
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
    awardCard.style.display = 'block';

  } catch (e) {
    container.innerHTML = `<div style="color:#c53030;text-align:center;padding:20px;">오류: ${e.message}</div>`;
  }
};

// 상세 패널 토글
window.toggleDetail = function(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
};

// ── 시상 기록 저장 ────────────────────────────
window.saveAwardHistory = async function() {
  const msgEl = document.getElementById('award-msg');
  if (!lastAggData) { showMsg(msgEl, '❌ 먼저 집계를 실행해주세요.', 'err'); return; }

  const { month, teamRows } = lastAggData;
  const sorted = [...teamRows].sort((a, b) => a.rank - b.rank);

  const scores = {};
  sorted.forEach(r => { scores[r.teamId] = r.totalAvg; });

  const record = {
    yearMonth:    month,
    rank1TeamId:  sorted[0]?.teamId   || '',
    rank1TeamName: sorted[0]?.teamName || '',
    rank2TeamId:  sorted[1]?.teamId   || '',
    rank2TeamName: sorted[1]?.teamName || '',
    scores,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  showMsg(msgEl, '저장 중...', 'ok');
  try {
    await db.collection('award_history').doc(month).set(record);
    showMsg(msgEl, '✅ 시상 기록 저장 완료!', 'ok');
  } catch (e) {
    showMsg(msgEl, '❌ 오류: ' + e.message, 'err');
  }
};

// ── 유틸리티 ─────────────────────────────────

function showMsg(el, text, type) {
  if (!el) return;
  el.textContent  = text;
  el.style.color  = type === 'err' ? '#c53030' : '#276749';
  if (type === 'ok' && !text.startsWith('✅')) return;
  if (type === 'ok') {
    setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 3000);
  }
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
