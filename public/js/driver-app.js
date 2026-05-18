/* ================================================================
   ae87f 새 기사 앱 (영민님 통합 흐름 / 2026-05-05)
   ================================================================
   사용자: 배송기사 + 팀리더 + 파트장
   핵심 흐름:
     1. sales_targets (a15bc → ae87f 푸시) 로드 → 영업할 곳 표시
     2. field_visits 추가 → 영업 활동 입력 (sales_targets에서 사라짐)
     3. daily_sales 추가 → 본인 메뉴별 배송 수량 입력
     4. evaluations / member_evaluations 추가 → 평가 시스템 (주 1회)
     5. vehicle_logs 추가 → 차량관리 (세차 / 수리 / 사고)
     6. 본인 점수 자동 계산
   ================================================================ */

// ========== 전역 상태 ==========
let currentUser = null;
let myTeam = null;
let allTeams = [];
let allUsers = [];          // 평가용 (전체 사용자)
let myVehicle = null;       // 본인 차량 정보
let salesTargets = [];
let myFieldVisits = [];
let myDailySales = null;
let myVehicleLogs = [];     // 본인 차량 이력
let monthlyScore = { activity: 0, conversion: 0, total: 0, expectedReward: 0 };
let awardsConfig = { activityWeight: 1, conversionWeight: 5 };
let myEvaluations = { teamThisWeek: {}, memberThisWeek: {} };  // 이번주 평가 이력
let userRole = 'driver';    // 'driver' / 'leader' / 'partLeader' (파트장)
let trackingClients = [];    // 🆕 추적 대상 신규업체 (영민님이 시작한 것)

// ========== 초기화 ==========
async function initApp() {
  currentUser = getSavedUser();
  if (!currentUser) {
    location.href = '/index.html';
    return;
  }

  if (currentUser.role === 'admin' || currentUser.role === 'manager') {
    location.href = '/admin.html';
    return;
  }

  document.getElementById('headerName').textContent = currentUser.name + ' 기사님 🚚';

  await loadTeams();
  await loadAllUsers();
  await loadAwardsConfig();
  await detectUserRole();      // 🆕 권한 자동 판별
  await loadMyVehicle();       // 🆕 본인 차량 정보
  await loadSalesTargets();
  await loadMyFieldVisits();
  await loadMyDailySales();
  await loadMyVehicleLogs();   // 🆕 본인 차량 이력
  await loadMyEvaluations();   // 🆕 이번주 평가 이력
  await loadTrackingClients(); // 🆕 신규업체 추적 (2026-05-05)
  calculateMyScore();

  // 🆕 평가 탭 권한 분리 (탭 자체를 숨김)
  applyTabPermissions();

  renderHeader();
  renderHome();
  renderSales();
  renderEvaluation();
  renderScore();
  renderMyInfo();
  renderVehicle();
}

// ========== 권한 자동 판별 ==========
async function detectUserRole() {
  // 1. 파트장 (전체 평가 권한) — settings/part_leader 확인
  try {
    const doc = await db.collection('settings').doc('part_leader').get();
    if (doc.exists) {
      const data = doc.data();
      const partLeaderUid = data.uid || '';
      const partLeaderName = data.name || '';
      if (
        partLeaderUid === (currentUser.uid || currentUser.docId) ||
        partLeaderName === currentUser.name
      ) {
        userRole = 'partLeader';
        return;
      }
    }
  } catch (e) {}

  // 2. 팀리더 — teams 컬렉션 leaderUid 확인
  if (myTeam && (myTeam.leaderUid === (currentUser.uid || currentUser.docId) || myTeam.leaderName === currentUser.name)) {
    userRole = 'leader';
    return;
  }

  // 3. 일반 기사
  userRole = 'driver';
}

function applyTabPermissions() {
  // 일반 기사는 평가 탭 숨김
  if (userRole === 'driver') {
    const evalTabBtn = document.querySelector('.nav-tab[data-tab="eval"]');
    if (evalTabBtn) evalTabBtn.style.display = 'none';
  }
}

// ========== 데이터 로드 ==========
async function loadTeams() {
  try {
    const snap = await db.collection('teams').get();
    allTeams = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (currentUser.teamId) {
      myTeam = allTeams.find(t => t.id === currentUser.teamId);
    }
  } catch (e) { console.warn('[teams] 로드 실패', e); }
}

async function loadAllUsers() {
  try {
    const snap = await db.collection('users').where('active', '!=', false).get();
    allUsers = snap.docs.map(d => ({ id: d.id, uid: d.id, ...d.data() }));
  } catch (e) {
    // active 필드 없는 경우 폴백
    try {
      const snap = await db.collection('users').get();
      allUsers = snap.docs.map(d => ({ id: d.id, uid: d.id, ...d.data() }))
        .filter(u => u.active !== false);
    } catch (e2) {
      console.warn('[users] 로드 실패', e2);
    }
  }
}

async function loadAwardsConfig() {
  try {
    const doc = await db.collection('settings').doc('awards_config').get();
    if (doc.exists) {
      const data = doc.data();
      awardsConfig.activityWeight = data.activityWeight || 1;
      awardsConfig.conversionWeight = data.conversionWeight || 5;
    }
  } catch (e) { console.warn('[awards_config] 로드 실패', e); }
}

async function loadMyVehicle() {
  try {
    const docId = currentUser.uid || currentUser.docId;
    const doc = await db.collection('driver_vehicles').doc(docId).get();
    if (doc.exists) {
      myVehicle = doc.data();
    }
  } catch (e) { console.warn('[driver_vehicles] 로드 실패', e); }
}

async function loadSalesTargets() {
  try {
    // 2026-05-12 영민님 직접 지시 — 확인대기도 기사 화면에 계속 표시
    //   '대기': 새 발령 / '확인대기': 기사가 확인불가 눌렀음, 재방문 필요
    const snap = await db.collection('sales_targets')
      .where('status', 'in', ['대기', '확인대기'])
      .get();

    // 코스번호 정규화: "코스6" → "6", 6 → "6"
    const normCourse = (v) => String(v || '').replace(/[^0-9]/g, '');
    const myCourse = normCourse(currentUser.courseId);

    // 1) 내 화면에 보일 후보 필터
    //    - 본인 이름 직접 배정: 무조건 표시
    //    - 코스번호 매칭: "코스6" === "6" 정규화 비교
    //    ※ 팀 매칭(teamId) 라인 제거 — 같은 팀 다른 코스 거래처가 풀려서 표시되던 버그 수정
    //      (2026-05-11 수정작업1: 박인수 화면에 코스5 일광해빛동물병원 등 잘못 표시 수정)
    const candidates = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => {
        if (t.assignedToName === currentUser.name) return true;
        if (!t.assignedToName && myCourse && normCourse(t.courseNum) === myCourse) return true;
        return false;
      });

    // 2) 거래처명 dedup — 같은 업체 여러 문서면 가장 최근 createdAt 1건만 표시
    //    (2026-05-11 수정작업1: 그릿수학831 등 5/6, 5/7, 5/8 누적 표시 버그 수정)
    const tsOf = (t) => {
      const c = t.createdAt;
      if (!c) return 0;
      if (typeof c.seconds === 'number') return c.seconds;
      if (c.toMillis) return c.toMillis() / 1000;
      return 0;
    };
    const dedupMap = new Map();
    for (const t of candidates) {
      const key = (t.clientName || t.businessName || t.name || t.id || '').trim();
      if (!key) continue;
      const prev = dedupMap.get(key);
      if (!prev || tsOf(t) > tsOf(prev)) {
        dedupMap.set(key, t);
      }
    }

    // 3) 우선순위(★) 정렬
    salesTargets = [...dedupMap.values()].sort((a, b) => {
      const pri = { '★★★★': 4, '★★★': 3, '★★': 2, '★': 1 };
      return (pri[b.priority] || 0) - (pri[a.priority] || 0);
    });
  } catch (e) {
    console.warn('[sales_targets] 로드 실패', e);
    salesTargets = [];
  }
}

async function loadMyFieldVisits() {
  try {
    const ym = getCurrentYearMonth();
    const snap = await db.collection('field_visits')
      .where('driverId', '==', currentUser.uid || currentUser.docId)
      .where('yearMonth', '==', ym)
      .get();
    myFieldVisits = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[field_visits] 로드 실패', e);
    myFieldVisits = [];
  }
}

async function loadMyDailySales() {
  try {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const docId = `${currentUser.uid || currentUser.docId}_${dateStr}`;
    const doc = await db.collection('daily_sales').doc(docId).get();
    if (doc.exists) {
      myDailySales = doc.data();
    }
  } catch (e) { console.warn('[daily_sales] 로드 실패', e); }
}

async function loadMyVehicleLogs() {
  try {
    const driverId = currentUser.uid || currentUser.docId;
    const snap = await db.collection('vehicle_logs')
      .where('driverId', '==', driverId)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    myVehicleLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    console.warn('[vehicle_logs] 로드 실패', e);
    myVehicleLogs = [];
  }
}

async function loadMyEvaluations() {
  // 이번주 = 월요일 기준 시작
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(monday.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  const weekStr = `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;

  try {
    // 팀 평가
    const teamSnap = await db.collection('team_evaluations')
      .where('weekStart', '==', weekStr)
      .where('fromUid', '==', currentUser.uid || currentUser.docId)
      .get();
    myEvaluations.teamThisWeek = {};
    teamSnap.docs.forEach(d => {
      const data = d.data();
      myEvaluations.teamThisWeek[data.toTeamId] = true;
    });

    // 팀원 평가
    const memberSnap = await db.collection('member_evaluations')
      .where('weekStart', '==', weekStr)
      .where('fromUid', '==', currentUser.uid || currentUser.docId)
      .get();
    myEvaluations.memberThisWeek = {};
    memberSnap.docs.forEach(d => {
      const data = d.data();
      myEvaluations.memberThisWeek[data.toUid] = true;
    });
  } catch (e) {
    console.warn('[evaluations] 로드 실패', e);
  }
}

function calculateMyScore() {
  const activityCount = myFieldVisits.length;
  monthlyScore.activity = activityCount * awardsConfig.activityWeight;
  monthlyScore.conversion = 0;
  monthlyScore.total = monthlyScore.activity + monthlyScore.conversion;

  if (monthlyScore.total >= 120) monthlyScore.expectedReward = 800000;
  else if (monthlyScore.total >= 80) monthlyScore.expectedReward = 500000;
  else if (monthlyScore.total >= 50) monthlyScore.expectedReward = 300000;
  else monthlyScore.expectedReward = 0;
}

// ========== 헤더 렌더 ==========
function renderHeader() {
  const teamLabel = myTeam ? myTeam.name : (currentUser.teamId || '미배정');
  const courseLabel = currentUser.courseId ? `· 코스${currentUser.courseId}` : '';
  let roleBadge = '';
  if (userRole === 'partLeader') {
    roleBadge = '<span class="badge-leader">👑 파트장</span>';
  } else if (userRole === 'leader') {
    roleBadge = '<span class="badge-leader">⭐ 팀리더</span>';
  }

  document.getElementById('headerTeam').innerHTML = `${teamLabel} ${courseLabel} ${roleBadge}`;
  document.getElementById('headerScore').textContent = monthlyScore.total + '점';
  document.getElementById('headerReward').textContent = monthlyScore.expectedReward >= 10000
    ? Math.round(monthlyScore.expectedReward / 10000) + '만원'
    : '-';
}

// ========== 🏠 홈 탭 ==========
// 영민님 직접 지시 2026-05-17 21:24: XSS 방지 (헤이푸드 패턴 동일)
function escapeHTML(s) {
  return String(s||'').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderHome() {
  const container = document.getElementById('tab-home');

  // 2026-05-06 영민님 직접 지시 — 헤이푸드 분리, 준도시락만 표시
  const urgentTargets = salesTargets.filter(t =>
    t.businessLine !== 'heyfood' &&
    (t.priority === '★★★' || t.priority === '★★★★' || t.groupLabel?.includes('즉시') || t.groupLabel?.includes('종결'))
  );
  const jundoTargets = salesTargets.filter(t =>
    t.businessLine !== 'heyfood' && !urgentTargets.includes(t)
  );

  let html = '';

  const todayCount = myFieldVisits.filter(v => {
    const dt = v.createdAt?.toDate?.() || new Date(v.createdAt);
    return dt.toDateString() === new Date().toDateString();
  }).length;
  const totalTargets = salesTargets.length;
  if (totalTargets > 0 || todayCount > 0) {
    html += `
      <div class="alert-banner">
        🔔 영업 대상 ${totalTargets}건 · 오늘 활동 완료 ${todayCount}건
      </div>
    `;
  }

  // 📅 연휴 영향일 등록 버튼 — 영민님 직접 지시 2026-05-12 22:54 (홈에서 숨김)
  // 모달 / openHolidayInfluence() 함수는 그대로 유지 (다른 곳에서 호출 가능)
  // html += `
  //   <div style="margin:12px 16px">
  //     <button class="add-button" onclick="openHolidayInfluence()" style="background:#FEF3C7;border-color:#F59E0B;color:#92400E">
  //       📅 오늘 연휴 영향일 등록 (출근자 적은 날)
  //     </button>
  //   </div>
  // `;

  if (urgentTargets.length > 0) {
    html += `
      <div class="section">
        <div class="section-title">🔴 긴급 영업 <span class="badge">${urgentTargets.length}</span></div>
        ${urgentTargets.map(t => renderVisitCard(t, 'urgent')).join('')}
      </div>
    `;
  }

  // 영민님 직접 지시 2026-05-17 21:24: 준도시락 새 거래처 영업 이력 (본인이 입력한 것)
  // 헤이푸드 기사앱 '내 개인 영업 이력' 패턴 동일하게 적용
  const myNewSalesVisits = (myFieldVisits || [])
    .filter(v => v.visitType === 'new_sales' || v.businessLine === 'jundosirak_new')
    .sort((a, b) => {
      const ta = a.createdAt?.toDate?.()?.getTime?.() || a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toDate?.()?.getTime?.() || b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    })
    .slice(0, 20);

  html += `
    <div class="section">
      <div class="section-title green">🟢 준도시락 영업 <span class="badge">${jundoTargets.length}</span></div>
      ${jundoTargets.length > 0 ? jundoTargets.map(t => renderVisitCard(t, 'jundosirak')).join('') : '<div class="empty-state">준도시락 영업 대상 없음</div>'}
      <button class="add-button" onclick="openVisitModal('new', 'jundosirak_new')">
        ➕ 새 거래처 영업 입력
      </button>

      <!-- 영민님 직접 지시 2026-05-17 21:24: 본인 신규 영업 이력 -->
      <div style="margin-top:18px;">
        <div style="font-size:14px;font-weight:700;color:#1E293B;margin-bottom:10px;">
          📋 내 신규 영업 이력 <span style="color:#94A3B8;font-weight:400;font-size:12px;">(최근 20건)</span>
        </div>
        ${myNewSalesVisits.length === 0 ? `
          <div style="text-align:center;padding:24px;color:#94A3B8;background:#F8FAFC;border-radius:10px;font-size:13px;">
            아직 등록된 신규 영업이 없습니다.<br>
            <span style="font-size:11px;">위의 [➕ 새 거래처 영업 입력] 버튼으로 등록하세요.</span>
          </div>
        ` : myNewSalesVisits.map(v => {
          const ts = v.createdAt?.toDate ? v.createdAt.toDate().toLocaleString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '-';
          const isConfirmed = v.isNewSalesConfirmed === true;
          const statusBadge = isConfirmed
            ? '<span style="background:#16A34A;color:white;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">✅ 확정</span>'
            : '<span style="background:#94A3B8;color:white;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">⏳ 대기</span>';
          const photo = (v.photoUrl || (Array.isArray(v.photoUrls) && v.photoUrls[0]) || '');
          // 영민님 직접 지시 2026-05-19 08:12 — 거래처 이름 안 뜨는 버그 수정
          // 진짜 원인: 저장 시 'name' 필드로 저장 (driver-app.js 720줄) → 표시 시 'clientName'만 봤음
          // 영민님 메모리 원칙 (보이는 것만 수정 금지 → 로직 추적):
          //   admin 화면(admin.js 1336줄)은 v.name 으로 표시하여 정상 작동 중
          //   driver-app만 폴백에 v.name 누락 → 폴백 추가로 통일
          const clientName = v.clientName || v.companyName || v.name || '-';
          const memo = v.memo || v.note || v.content || '';
          const region = v.region || v.address || '';
          return `
            <div style="background:white;border-radius:10px;padding:12px;margin-bottom:8px;box-shadow:0 1px 4px rgba(0,0,0,0.06);border-left:3px solid ${isConfirmed?'#16A34A':'#94A3B8'};">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <div style="font-weight:700;font-size:14px;">${escapeHTML(clientName)}</div>
                ${statusBadge}
              </div>
              ${region ? `<div style="font-size:11px;color:#64748B;margin-top:2px;">📍 ${escapeHTML(region)}</div>` : ''}
              ${memo ? `<div style="font-size:13px;color:#334155;margin:8px 0;white-space:pre-wrap;">${escapeHTML(memo)}</div>` : ''}
              ${photo ? `<img src="${photo}" style="max-width:100%;max-height:120px;border-radius:6px;border:1px solid #E2E8F0;">` : ''}
              <div style="font-size:11px;color:#94A3B8;margin-top:6px;">${ts}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  // 2026-05-06 영민님 직접 지시 — 헤이푸드 영업 섹션 제거 (별도 시스템으로 분리)

  // 🆕 신규업체 추적 섹션 (영민님 통합 흐름 2026-05-05)
  // 본인 코스/팀에 배정된 추적 대상만 표시
  const myTrackingClients = trackingClients.filter(t => {
    if (t.status !== 'tracking') return false;
    // 본인 이름 또는 코스/팀 매칭
    if (t.driverName === currentUser.name) return true;
    if (String(t.courseNum) === String(currentUser.courseId)) return true;
    if (t.teamId === currentUser.teamId) return true;
    return false;
  });

  if (myTrackingClients.length > 0) {
    html += `
      <div class="section">
        <div class="section-title" style="color:#7C3AED">
          🆕 신규업체 추적 <span class="badge" style="background:#7C3AED">${myTrackingClients.length}</span>
        </div>
        <div style="font-size:11px;color:#6B7280;margin:-8px 0 8px 0">
          영민님이 추적 시작한 신규업체. 매일 배송 시 보고해주세요.
        </div>
        ${myTrackingClients.map(t => renderTrackingCard(t)).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
}

// 🆕 신규추적 카드 렌더 (2026-05-05)
function renderTrackingCard(t) {
  const reportCount = t.myReportCount || 0;
  return `
    <div class="visit-card tracking" style="border-left-color:#7C3AED">
      <div class="visit-card-main" onclick="openTrackingReportModal('${(t.clientName || '').replace(/'/g, '&apos;')}', '${t.id}')">
        <div class="visit-info">
          <div class="name">🆕 ${t.clientName}</div>
          <div class="desc">📍 ${t.courseName || t.address || '-'} · 추적 중</div>
          <div class="urgent-tag" style="background:#EDE9FE;color:#6D28D9">📝 보고 ${reportCount}회</div>
        </div>
        <button class="visit-action" style="background:#7C3AED">📝 보고</button>
      </div>
    </div>
  `;
}

function renderVisitCard(t, type) {
  // 2026-05-06 영민님 직접 지시 — 준도시락 전용 (헤이푸드 분리)
  const cls = type === 'urgent' ? 'urgent' : '';
  const desc = t.consecutiveDays
    ? `📍 ${t.courseName || '-'} · ${t.consecutiveDays}일 미주문`
    : `📍 ${t.courseName || '-'} · ${t.groupLabel || ''}`;
  const urgentTag = type === 'urgent' ? '<div class="urgent-tag">🔴 즉시 영업 필요</div>' : '';
  const businessLine = 'jundosirak_care';

  // 준도시락 위기관리 — 영민님 8가지 사유 확정 (2026-05-12 23:43 영민님 직접 지시)
  // 기존 6개 + 추가 2개: 확인불가(unconfirmed) / 거래종결(closed)
  const followUpBadge = t.followUpCount > 0
    ? `<span style="display:inline-block;background:#FEF3C7;color:#92400E;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px">🚪 ${t.followUpCount}차 확인대기</span>`
    : '';
  const feedbackButtons = `
    <button class="feedback-btn ok" onclick="event.stopPropagation();openFeedbackModal('stillActive', '${t.id}', '${(t.clientName || '').replace(/'/g, '&apos;')}')">🟢 거래중</button>
    <button class="feedback-btn warn" onclick="event.stopPropagation();openFeedbackModal('wrongAssign', '${t.id}', '${(t.clientName || '').replace(/'/g, '&apos;')}')">🔴 오배정</button>
    <button class="feedback-btn" onclick="event.stopPropagation();openFeedbackModal('closedDay', '${t.id}', '${(t.clientName || '').replace(/'/g, '&apos;')}')">🏖 정기휴무</button>
    <button class="feedback-btn" onclick="event.stopPropagation();openFeedbackModal('meeting', '${t.id}', '${(t.clientName || '').replace(/'/g, '&apos;')}')">🍻 회식</button>
    <button class="feedback-btn warn" onclick="event.stopPropagation();openFeedbackModal('churnRisk', '${t.id}', '${(t.clientName || '').replace(/'/g, '&apos;')}')">⚠ 이탈조짐</button>
    <button class="feedback-btn warn" onclick="event.stopPropagation();openFeedbackModal('unconfirmed', '${t.id}', '${(t.clientName || '').replace(/'/g, '&apos;')}')">🚪 확인불가</button>
    <button class="feedback-btn danger" onclick="event.stopPropagation();openFeedbackModal('closed', '${t.id}', '${(t.clientName || '').replace(/'/g, '&apos;')}')">🛑 거래종결</button>
    <button class="feedback-btn" onclick="event.stopPropagation();openFeedbackModal('other', '${t.id}', '${(t.clientName || '').replace(/'/g, '&apos;')}')">📝 기타</button>
  `;

  // 확인대기 누적 정보 (영민님 통찰 2026-05-12 — 추적 시스템)
  let followUpInfo = '';
  if (t.followUpCount > 0 && t.lastFollowUpAt) {
    const lastDate = t.lastFollowUpAt?.toDate ? t.lastFollowUpAt.toDate() : new Date(t.lastFollowUpAt);
    const daysAgo = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
    const urgentRe = daysAgo >= 3;
    followUpInfo = `
      <div style="background:${urgentRe ? '#FEE2E2' : '#FEF3C7'};border-left:4px solid ${urgentRe ? '#DC2626' : '#F59E0B'};padding:8px 10px;margin:4px 0;border-radius:4px;font-size:12px">
        🚪 <strong>확인대기 ${t.followUpCount}차</strong> (${daysAgo === 0 ? '오늘' : daysAgo + '일 전'})${urgentRe ? ' ⚠️ 재방문 권고' : ''}
      </div>
    `;
  }

  return `
    <div class="visit-card ${cls}">
      <div class="visit-card-main" onclick="openVisitModal('target', '${businessLine}', '${t.id}')">
        <div class="visit-info">
          <div class="name">${t.clientName}${followUpBadge}</div>
          <div class="desc">${desc}</div>
          ${followUpInfo}
          ${urgentTag}
        </div>
        <button class="visit-action">📸 활동 입력</button>
      </div>
      <div class="feedback-row">
        ${feedbackButtons}
      </div>
    </div>
  `;
}

// ========== 영업 활동 입력 모달 ==========
let currentVisitTarget = null;
let selectedPhotos = [];

function openVisitModal(mode, businessLine, targetId = null) {
  currentVisitTarget = { mode, businessLine, targetId };
  selectedPhotos = [];
  const target = targetId ? salesTargets.find(t => t.id === targetId) : null;

  // 2026-05-06 영민님 직접 지시 — 준도시락 전용
  const modalTitle = mode === 'new'
    ? '🟢 새 거래처 영업 입력'
    : `📸 ${target?.clientName} 영업 입력`;

  const html = `
    <div class="modal-overlay" id="visitModal" onclick="if(event.target===this)closeVisitModal()">
      <div class="modal-content">
        <div class="modal-handle"></div>
        <button class="modal-close" onclick="closeVisitModal()">✕</button>
        <div class="modal-title">${modalTitle}</div>
        <div class="modal-subtitle">${mode === 'target' ? '활동 후 입력하면 푸시 목록에서 자동으로 사라집니다.' : '신규 영업한 거래처를 직접 입력하세요.'}</div>

        ${mode === 'new' ? `
          <div class="form-group">
            <label class="form-label">거래처명 *</label>
            <input type="text" class="form-input" id="visitClientName" placeholder="○○병원, △△학원 등">
          </div>
        ` : ''}

        <div class="form-group">
          <label class="form-label">활동 내용 *</label>
          <textarea class="form-textarea" id="visitContent" placeholder="방문 결과, 담당자 반응, 다음 액션 등"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">사진 (최대 3장)</label>
          <div class="photo-preview" id="photoPreview"></div>
          <input type="file" id="photoInput" accept="image/*" multiple style="display:none" onchange="handlePhotoUpload(event)">
          <button class="upload-btn" onclick="document.getElementById('photoInput').click()" style="margin-top:8px">
            📸 사진 추가
          </button>
        </div>

        <div id="visitMsg" style="font-size:13px;text-align:center;color:#6B7280;margin-bottom:12px;min-height:18px"></div>
        <button class="save-btn" id="visitSaveBtn" onclick="saveVisit()">💾 저장하기</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeVisitModal() {
  const modal = document.getElementById('visitModal');
  if (modal) modal.remove();
  currentVisitTarget = null;
  selectedPhotos = [];
}

// 🆕 2026-05-06 영민님 직접 지시 — 사진 자동 압축 (기사 폰 데이터 절약 + 업로드 성공률 ↑)
// 원본 4~7MB → 1MB 이하로 자동 압축 (긴 변 1600px / JPEG 0.8 품질)
async function compressImage(file, maxWidth = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(file); // 실패 시 원본 그대로
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => resolve(file);
      img.onload = () => {
        try {
          // 비율 유지하며 긴 변 maxWidth로 축소
          let w = img.width, h = img.height;
          if (w > maxWidth || h > maxWidth) {
            if (w >= h) { h = Math.round(h * maxWidth / w); w = maxWidth; }
            else { w = Math.round(w * maxWidth / h); h = maxWidth; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#FFFFFF'; // 투명 PNG → 흰 배경
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }
            // 압축 후가 원본보다 크면 원본 사용
            if (blob.size >= file.size) { resolve(file); return; }
            // Blob → File (이름/타입 보존)
            const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
              type: 'image/jpeg', lastModified: Date.now()
            });
            console.log(`[compressImage] ${file.name}: ${(file.size/1024).toFixed(0)}KB → ${(compressed.size/1024).toFixed(0)}KB`);
            resolve(compressed);
          }, 'image/jpeg', quality);
        } catch (err) {
          console.warn('[compressImage] 실패, 원본 사용:', err);
          resolve(file);
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handlePhotoUpload(event) {
  const files = Array.from(event.target.files).slice(0, 3 - selectedPhotos.length);
  for (const file of files) {
    try {
      // 압축 진행 표시 (대용량 사진 빠른 응답)
      const compressed = await compressImage(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        selectedPhotos.push({ file: compressed, dataUrl: e.target.result });
        renderPhotoPreview();
      };
      reader.readAsDataURL(compressed);
    } catch (e) {
      console.warn('[handlePhotoUpload]', e);
    }
  }
}

function renderPhotoPreview() {
  const container = document.getElementById('photoPreview');
  if (!container) return;
  container.innerHTML = selectedPhotos.map((p, i) => `
    <div class="photo-thumb">
      <img src="${p.dataUrl}">
      <button class="remove" onclick="removePhoto(${i})">✕</button>
    </div>
  `).join('');
}

function removePhoto(i) {
  selectedPhotos.splice(i, 1);
  renderPhotoPreview();
}

async function saveVisit() {
  const msg = document.getElementById('visitMsg');
  const btn = document.getElementById('visitSaveBtn');

  let clientName;
  if (currentVisitTarget.mode === 'new') {
    clientName = document.getElementById('visitClientName').value.trim();
    if (!clientName) {
      msg.style.color = '#DC2626';
      msg.textContent = '거래처명을 입력해주세요';
      return;
    }
  } else {
    const target = salesTargets.find(t => t.id === currentVisitTarget.targetId);
    clientName = target?.clientName || '';
  }

  const content = document.getElementById('visitContent').value.trim();
  if (!content) {
    msg.style.color = '#DC2626';
    msg.textContent = '활동 내용을 입력해주세요';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> 저장 중...';
  msg.style.color = '#6B7280';
  msg.textContent = '저장 중...';

  try {
    const photoUrls = [];
    if (selectedPhotos.length > 0 && storage) {
      msg.textContent = `사진 ${selectedPhotos.length}장 업로드 중...`;
      for (const p of selectedPhotos) {
        const ts = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const fn = `${currentUser.uid || currentUser.docId}_${ts}.jpg`;
        const ref = storage.ref().child(`field_visits/${fn}`);
        await ref.put(p.file);
        const url = await ref.getDownloadURL();
        photoUrls.push(url);
      }
    }

    // 2026-05-06 영민님 직접 지시 — 준도시락 전용 (헤이푸드 분리)
    const businessLine = currentVisitTarget.businessLine;
    const visitType = businessLine === 'jundosirak_new' ? 'new_sales' : 'customer_care';

    msg.textContent = '데이터 저장 중...';
    await db.collection('field_visits').add({
      driverId: currentUser.uid || currentUser.docId,
      driverName: currentUser.name,
      teamId: currentUser.teamId || '',
      teamName: myTeam?.name || '',
      name: clientName,
      content,
      photoUrls,
      visitType,
      businessLine,
      sourceTargetId: currentVisitTarget.targetId || null,
      yearMonth: getCurrentYearMonth(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    if (currentVisitTarget.targetId) {
      try {
        await db.collection('sales_targets').doc(currentVisitTarget.targetId).update({
          status: '완료',
          completedAt: firebase.firestore.FieldValue.serverTimestamp(),
          completedBy: currentUser.name,
        });
      } catch (e) { console.warn('sales_targets 업데이트 실패', e); }
    }

    msg.style.color = '#16A34A';
    msg.textContent = '✅ 저장 완료!';

    setTimeout(async () => {
      closeVisitModal();
      await loadSalesTargets();
      await loadMyFieldVisits();
      calculateMyScore();
      renderHeader();
      renderHome();
      renderScore();
    }, 800);
  } catch (e) {
    console.error(e);
    msg.style.color = '#DC2626';
    msg.textContent = '❌ ' + e.message;
    btn.disabled = false;
    btn.innerHTML = '💾 저장하기';
  }
}

// ========== 💰 판매 탭 ==========
function renderSales() {
  const container = document.getElementById('tab-sales');
  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일 (${['일','월','화','수','목','금','토'][today.getDay()]}요일)`;

  const menus = [
    { key: 'hot', icon: '🍱', name: '뜨근한식' },
    { key: 'premium', icon: '🥩', name: '프리미엄' },
    { key: 'ilpum', icon: '🍲', name: '일품' },
    { key: 'deopbap', icon: '🍚', name: '덮밥' },
    { key: 'salad', icon: '🥗', name: '샐러드' },
    { key: 'sandwich', icon: '🥪', name: '샌드위치' },
    { key: 'yubu', icon: '🍙', name: '유부' },
  ];

  const html = `
    <div class="sales-form">
      <div class="date">📅 ${dateStr}</div>
      <div style="font-size:18px;font-weight:700;margin-bottom:8px">오늘 배송 수량 입력</div>
      <div style="font-size:12px;color:#6B7280;margin-bottom:16px">메뉴별 본인이 배송하는 수량을 입력하세요</div>

      ${menus.map(m => `
        <div class="menu-row">
          <div class="menu-name"><span class="menu-icon">${m.icon}</span> ${m.name}</div>
          <input type="number" id="sales-${m.key}" placeholder="0" value="${myDailySales?.[m.key] || ''}" min="0">
        </div>
      `).join('')}

      <div id="salesMsg" style="font-size:13px;text-align:center;color:#6B7280;margin-top:12px;min-height:18px"></div>
      <button class="save-btn" id="salesSaveBtn" onclick="saveDailySales()">💾 저장하기</button>
    </div>
  `;

  container.innerHTML = html;
}

async function saveDailySales() {
  const msg = document.getElementById('salesMsg');
  const btn = document.getElementById('salesSaveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> 저장 중...';

  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const driverId = currentUser.uid || currentUser.docId;
  const docId = `${driverId}_${dateStr}`;

  const data = {
    driverId,
    driverName: currentUser.name,
    teamId: currentUser.teamId || '',
    courseId: currentUser.courseId || '',
    date: dateStr,
    yearMonth: getCurrentYearMonth(),
    hot: parseInt(document.getElementById('sales-hot').value || '0', 10),
    premium: parseInt(document.getElementById('sales-premium').value || '0', 10),
    ilpum: parseInt(document.getElementById('sales-ilpum').value || '0', 10),
    deopbap: parseInt(document.getElementById('sales-deopbap').value || '0', 10),
    salad: parseInt(document.getElementById('sales-salad').value || '0', 10),
    sandwich: parseInt(document.getElementById('sales-sandwich').value || '0', 10),
    yubu: parseInt(document.getElementById('sales-yubu').value || '0', 10),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  data.total = data.hot + data.premium + data.ilpum + data.deopbap + data.salad + data.sandwich + data.yubu;

  try {
    await db.collection('daily_sales').doc(docId).set(data, { merge: true });
    myDailySales = data;
    msg.style.color = '#16A34A';
    msg.textContent = `✅ 저장 완료! 오늘 총 ${data.total}개`;
    btn.disabled = false;
    btn.innerHTML = '💾 저장하기';
    setTimeout(() => { msg.textContent = ''; }, 3000);
  } catch (e) {
    msg.style.color = '#DC2626';
    msg.textContent = '❌ ' + e.message;
    btn.disabled = false;
    btn.innerHTML = '💾 저장하기';
  }
}

// ========== 📝 평가 탭 (팀 + 팀원 / 주 1회) ==========
let evalActiveTab = 'team'; // 'team' or 'member'

function renderEvaluation() {
  const container = document.getElementById('tab-eval');

  // 권한 체크
  if (userRole === 'driver') {
    container.innerHTML = `
      <div class="empty-state" style="margin:30px 16px">
        평가 권한이 없습니다.
      </div>
    `;
    return;
  }

  // 팀리더 / 파트장
  const isPartLeader = userRole === 'partLeader';
  const isLeader = userRole === 'leader';

  const html = `
    <div style="background:${isPartLeader ? '#FEF3C7' : '#F0F7F4'};margin:16px;padding:14px;border-radius:12px;border-left:4px solid ${isPartLeader ? '#F59E0B' : '#38A169'}">
      <div style="font-weight:700;color:${isPartLeader ? '#92400E' : '#1A4731'};margin-bottom:4px">
        ${isPartLeader ? '👑 파트장 전체 평가 권한' : '⭐ 팀리더 평가 권한'}
      </div>
      <div style="font-size:12px;color:${isPartLeader ? '#92400E' : '#1A4731'}">
        주 1회 평가 (월~일 동일 주에 1회만 가능)
      </div>
    </div>

    <div class="eval-tab-grid">
      <div class="eval-tab-btn ${evalActiveTab === 'team' ? 'active' : ''}" onclick="switchEvalTab('team')">
        🏢 팀 평가
      </div>
      <div class="eval-tab-btn ${evalActiveTab === 'member' ? 'active' : ''}" onclick="switchEvalTab('member')">
        👥 팀원 평가
      </div>
    </div>

    <div id="eval-content"></div>
  `;
  container.innerHTML = html;

  if (evalActiveTab === 'team') {
    renderTeamEvalList();
  } else {
    renderMemberEvalList();
  }
}

function switchEvalTab(tab) {
  evalActiveTab = tab;
  renderEvaluation();
}

function renderTeamEvalList() {
  const isPartLeader = userRole === 'partLeader';
  const targetTeams = isPartLeader
    ? allTeams  // 파트장 = 전체
    : allTeams.filter(t => t.id !== currentUser.teamId);  // 리더 = 본인 팀 외

  const html = `
    <div style="font-size:14px;font-weight:600;padding:0 16px;margin-bottom:8px">
      이번주 평가할 팀 ${targetTeams.length}개
    </div>
    <div class="member-grid">
      ${targetTeams.map(t => {
        const evaluated = myEvaluations.teamThisWeek[t.id];
        return `
          <div class="member-btn ${evaluated ? 'evaluated' : ''}" onclick="${evaluated ? '' : `openTeamEvalModal('${t.id}', '${t.name}')`}">
            <div class="info">
              <div class="name">${t.name}</div>
              <div class="desc">코스 ${(t.courseIds || []).join(', ') || '-'}</div>
            </div>
            <div>${evaluated ? '✅ 평가 완료' : '⭐ 평가하기'}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  document.getElementById('eval-content').innerHTML = html;
}

function renderMemberEvalList() {
  const isPartLeader = userRole === 'partLeader';
  const myUid = currentUser.uid || currentUser.docId;

  let targetMembers;
  if (isPartLeader) {
    // 파트장 = 전체 기사 (본인 제외)
    targetMembers = allUsers.filter(u =>
      u.role === 'driver' && u.id !== myUid
    );
  } else {
    // 팀리더 = 본인 팀원 (본인 제외)
    targetMembers = allUsers.filter(u =>
      u.role === 'driver' && u.teamId === currentUser.teamId && u.id !== myUid
    );
  }

  // 팀별 그룹화
  const byTeam = {};
  targetMembers.forEach(u => {
    const teamId = u.teamId || '_etc';
    if (!byTeam[teamId]) byTeam[teamId] = [];
    byTeam[teamId].push(u);
  });

  let html = `
    <div style="font-size:14px;font-weight:600;padding:0 16px;margin-bottom:8px">
      이번주 평가할 팀원 ${targetMembers.length}명
    </div>
  `;

  for (const teamId of Object.keys(byTeam).sort()) {
    const team = allTeams.find(t => t.id === teamId);
    const teamLabel = team?.name || teamId;
    html += `
      <div style="font-size:13px;font-weight:600;color:#6B7280;padding:8px 16px 4px">
        ${teamLabel} (${byTeam[teamId].length}명)
      </div>
      <div class="member-grid" style="padding-top:0">
        ${byTeam[teamId].map(u => {
          const evaluated = myEvaluations.memberThisWeek[u.id];
          return `
            <div class="member-btn ${evaluated ? 'evaluated' : ''}" onclick="${evaluated ? '' : `openMemberEvalModal('${u.id}', '${u.name}', '${teamLabel}')`}">
              <div class="info">
                <div class="name">${u.name}</div>
                <div class="desc">${u.role === 'driver' ? '기사' : u.role}${u.courseId ? ' · 코스' + u.courseId : ''}</div>
              </div>
              <div>${evaluated ? '✅' : '⭐ 평가'}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  document.getElementById('eval-content').innerHTML = html;
}

// 팀 평가 모달
function openTeamEvalModal(teamId, teamName) {
  const items = [
    { key: 'delivery_time', label: '⏰ 배송 시간 준수' },
    { key: 'cooperation', label: '🤝 팀 협력' },
    { key: 'customer_service', label: '📞 고객 응대' },
    { key: 'goal_achieve', label: '🎯 목표 달성' },
    { key: 'overall', label: '💪 종합 점수' },
  ];

  let html = `
    <div class="modal-overlay" id="evalModal" onclick="if(event.target===this)closeEvalModal()">
      <div class="modal-content">
        <div class="modal-handle"></div>
        <button class="modal-close" onclick="closeEvalModal()">✕</button>
        <div class="modal-title">🏢 ${teamName} 팀 평가</div>
        <div class="modal-subtitle">이번주 평가 (별 1~5)</div>
  `;

  items.forEach((item, idx) => {
    html += `
      <div class="rating-row">
        <div style="font-size:14px;font-weight:600">${item.label}</div>
        <div class="rating-stars" data-item="${idx}">
          ${[1,2,3,4,5].map(n => `<span class="star" data-val="${n}" onclick="selectStar(${idx}, ${n})">★</span>`).join('')}
        </div>
      </div>
    `;
  });

  html += `
        <div class="form-group" style="margin-top:16px">
          <label class="form-label">메모 (선택)</label>
          <textarea class="form-textarea" id="evalMemo" placeholder="추가 의견이 있으면 작성"></textarea>
        </div>
        <div id="evalMsg" style="font-size:13px;text-align:center;color:#6B7280;margin-bottom:12px;min-height:18px"></div>
        <button class="save-btn" id="evalSaveBtn" onclick='saveTeamEval(${JSON.stringify({teamId, teamName, items: items.map(i => i.key)})})'>💾 평가 제출</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  window._currentEvalScores = {};
}

// 팀원 평가 모달
function openMemberEvalModal(uid, name, teamName) {
  const items = [
    { key: 'responsibility', label: '🎯 책임감' },
    { key: 'cooperation', label: '🤝 협력성' },
    { key: 'attitude', label: '💪 업무 태도' },
    { key: 'capability', label: '📚 업무 능력' },
    { key: 'vehicle_care', label: '🚗 차량 관리' },
    { key: 'overall', label: '💎 종합 점수' },
  ];

  let html = `
    <div class="modal-overlay" id="evalModal" onclick="if(event.target===this)closeEvalModal()">
      <div class="modal-content">
        <div class="modal-handle"></div>
        <button class="modal-close" onclick="closeEvalModal()">✕</button>
        <div class="modal-title">👤 ${name} 평가</div>
        <div class="modal-subtitle">${teamName} · 이번주 평가</div>
  `;

  items.forEach((item, idx) => {
    html += `
      <div class="rating-row">
        <div style="font-size:14px;font-weight:600">${item.label}</div>
        <div class="rating-stars" data-item="${idx}">
          ${[1,2,3,4,5].map(n => `<span class="star" data-val="${n}" onclick="selectStar(${idx}, ${n})">★</span>`).join('')}
        </div>
      </div>
    `;
  });

  html += `
        <div class="form-group" style="margin-top:16px">
          <label class="form-label">메모 (선택)</label>
          <textarea class="form-textarea" id="evalMemo" placeholder="추가 의견이 있으면 작성"></textarea>
        </div>
        <div id="evalMsg" style="font-size:13px;text-align:center;color:#6B7280;margin-bottom:12px;min-height:18px"></div>
        <button class="save-btn" id="evalSaveBtn" onclick='saveMemberEval(${JSON.stringify({uid, name, teamName, items: items.map(i => i.key)})})'>💾 평가 제출</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
  window._currentEvalScores = {};
}

function closeEvalModal() {
  const modal = document.getElementById('evalModal');
  if (modal) modal.remove();
  window._currentEvalScores = null;
}

function selectStar(itemIdx, val) {
  window._currentEvalScores = window._currentEvalScores || {};
  window._currentEvalScores[itemIdx] = val;
  const stars = document.querySelectorAll(`[data-item="${itemIdx}"] .star`);
  stars.forEach((s, i) => {
    s.classList.toggle('active', i < val);
  });
}

function getThisWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(monday.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  return `${monday.getFullYear()}-${String(monday.getMonth()+1).padStart(2,'0')}-${String(monday.getDate()).padStart(2,'0')}`;
}

async function saveTeamEval(info) {
  const msg = document.getElementById('evalMsg');
  const btn = document.getElementById('evalSaveBtn');
  const scores = window._currentEvalScores || {};

  if (Object.keys(scores).length < info.items.length) {
    msg.style.color = '#DC2626';
    msg.textContent = `${info.items.length}개 항목 모두 평가해주세요`;
    return;
  }

  const memo = document.getElementById('evalMemo').value.trim();
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> 저장 중...';

  try {
    const weekStart = getThisWeekStart();
    const docId = `${weekStart}_${currentUser.uid || currentUser.docId}_to_${info.teamId}`;

    const scoreObj = {};
    info.items.forEach((key, idx) => {
      scoreObj[key] = scores[idx];
    });
    const avg = Object.values(scoreObj).reduce((a, b) => a + b, 0) / info.items.length;

    await db.collection('team_evaluations').doc(docId).set({
      weekStart,
      yearMonth: getCurrentYearMonth(),
      fromUid: currentUser.uid || currentUser.docId,
      fromName: currentUser.name,
      fromRole: userRole,
      fromTeamId: currentUser.teamId || '',
      fromTeamName: myTeam?.name || '',
      toTeamId: info.teamId,
      toTeamName: info.teamName,
      scores: scoreObj,
      averageScore: parseFloat(avg.toFixed(2)),
      memo,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    msg.style.color = '#16A34A';
    msg.textContent = '✅ 평가 제출 완료!';
    setTimeout(async () => {
      closeEvalModal();
      await loadMyEvaluations();
      renderEvaluation();
    }, 800);
  } catch (e) {
    msg.style.color = '#DC2626';
    msg.textContent = '❌ ' + e.message;
    btn.disabled = false;
    btn.innerHTML = '💾 평가 제출';
  }
}

async function saveMemberEval(info) {
  const msg = document.getElementById('evalMsg');
  const btn = document.getElementById('evalSaveBtn');
  const scores = window._currentEvalScores || {};

  if (Object.keys(scores).length < info.items.length) {
    msg.style.color = '#DC2626';
    msg.textContent = `${info.items.length}개 항목 모두 평가해주세요`;
    return;
  }

  const memo = document.getElementById('evalMemo').value.trim();
  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> 저장 중...';

  try {
    const weekStart = getThisWeekStart();
    const docId = `${weekStart}_${currentUser.uid || currentUser.docId}_to_${info.uid}`;

    const scoreObj = {};
    info.items.forEach((key, idx) => {
      scoreObj[key] = scores[idx];
    });
    const avg = Object.values(scoreObj).reduce((a, b) => a + b, 0) / info.items.length;

    await db.collection('member_evaluations').doc(docId).set({
      weekStart,
      yearMonth: getCurrentYearMonth(),
      fromUid: currentUser.uid || currentUser.docId,
      fromName: currentUser.name,
      fromRole: userRole,
      fromTeamId: currentUser.teamId || '',
      fromTeamName: myTeam?.name || '',
      toUid: info.uid,
      toName: info.name,
      toTeamName: info.teamName,
      scores: scoreObj,
      averageScore: parseFloat(avg.toFixed(2)),
      memo,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    msg.style.color = '#16A34A';
    msg.textContent = '✅ 평가 제출 완료!';
    setTimeout(async () => {
      closeEvalModal();
      await loadMyEvaluations();
      renderEvaluation();
    }, 800);
  } catch (e) {
    msg.style.color = '#DC2626';
    msg.textContent = '❌ ' + e.message;
    btn.disabled = false;
    btn.innerHTML = '💾 평가 제출';
  }
}

// ========== 📊 내 점수 탭 ==========
function renderScore() {
  const container = document.getElementById('tab-score');
  const ym = getCurrentYearMonth();

  // 2026-05-06 영민님 직접 지시 — 준도시락 전용 (헤이푸드 분리)
  const careCount = myFieldVisits.filter(v => v.businessLine === 'jundosirak_care' || v.visitType === 'customer_care').length;
  const newCount = myFieldVisits.filter(v => v.businessLine === 'jundosirak_new' || v.visitType === 'new_sales').length;
  const aw = awardsConfig.activityWeight;

  const html = `
    <div class="total-score">
      <div class="label">${ym} 내 점수</div>
      <div class="num">${monthlyScore.total}점</div>
      <div class="pay">💰 예상 수당: ${monthlyScore.expectedReward >= 10000 ? Math.round(monthlyScore.expectedReward / 10000) + '만원' : '기준 미달'}</div>
    </div>

    <div class="score-card">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px">📊 활동 누적</div>

      <div class="score-row">
        <div class="left">
          <div class="icon">🟢</div>
          <div>
            <div class="text">위기관리 영업</div>
            <div class="desc">${careCount}건 × ${aw}점</div>
          </div>
        </div>
        <div class="points">${careCount * aw}</div>
      </div>

      <div class="score-row">
        <div class="left">
          <div class="icon">🆕</div>
          <div>
            <div class="text">신규 영업</div>
            <div class="desc">${newCount}건 × ${aw}점</div>
          </div>
        </div>
        <div class="points">${newCount * aw}</div>
      </div>

      <!-- 2026-05-06 영민님 직접 지시 — 헤이푸드 영업 / 헤이푸드 전환 보너스 제거 (별도 시스템으로 분리) -->
    </div>

    <div class="score-card">
      <div style="font-size:15px;font-weight:700;margin-bottom:12px">🏆 점수 안내</div>
      <div style="font-size:13px;color:#6B7280;line-height:1.7">
        • 활동 1건 = ${aw}점<br>
        • 매월 1일 자동 정산 → 시상금 결정<br>
        • 시상 등급: 50점/80점/120점 기준
      </div>
    </div>
  `;
  container.innerHTML = html;
}

// ========== 👤 내 정보 탭 ==========
function renderMyInfo() {
  const container = document.getElementById('tab-mypage');
  const teamLabel = myTeam ? myTeam.name : '미배정';
  const courseLabel = currentUser.courseId ? `코스${currentUser.courseId}` : '미배정';
  const vehicleLabel = myVehicle?.vehicleNumber || '미배정';

  let roleLabel;
  if (userRole === 'partLeader') roleLabel = '👑 파트장';
  else if (userRole === 'leader') roleLabel = '⭐ 팀리더';
  else roleLabel = '🚚 기사';

  const html = `
    <div class="info-card">
      <div style="text-align:center;padding:20px 0">
        <div style="width:80px;height:80px;background:linear-gradient(135deg,#38A169,#1A4731);border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;font-size:40px">
          🚚
        </div>
        <div style="font-size:18px;font-weight:700;margin-top:12px">${currentUser.name}</div>
        <div style="font-size:13px;color:#6B7280">${teamLabel} / ${courseLabel}</div>
      </div>

      <div class="info-row">
        <div class="label">팀</div>
        <div class="value">${teamLabel}</div>
      </div>
      <div class="info-row">
        <div class="label">담당 코스</div>
        <div class="value">${courseLabel}</div>
      </div>
      <div class="info-row">
        <div class="label">차량번호</div>
        <div class="value">${vehicleLabel}</div>
      </div>
      <div class="info-row">
        <div class="label">역할</div>
        <div class="value">${roleLabel}</div>
      </div>
    </div>

    <div style="padding:0 16px">
      <button class="menu-btn" onclick="changePassword()">
        🔑 비밀번호 변경
        <span class="arrow">›</span>
      </button>
      <button class="menu-btn logout" onclick="if(confirm('로그아웃 하시겠습니까?')) logout()">
        🚪 로그아웃
        <span class="arrow">›</span>
      </button>
    </div>
  `;
  container.innerHTML = html;
}

async function changePassword() {
  const newPw = prompt('새 비밀번호를 입력하세요 (4자 이상)');
  if (!newPw || newPw.length < 4) {
    if (newPw !== null) alert('4자 이상 입력해주세요');
    return;
  }
  try {
    await db.collection('users').doc(currentUser.uid || currentUser.docId).update({ password: newPw });
    alert('✅ 비밀번호 변경 완료');
  } catch (e) {
    alert('❌ ' + e.message);
  }
}

// ========== 🚗 차량관리 탭 (NEW! 2026-05-05) ==========
function renderVehicle() {
  const container = document.getElementById('tab-vehicle');
  const vehicleNumber = myVehicle?.vehicleNumber || '미배정';
  const isTemp = myVehicle?.isTempDriver || false;
  const realDriver = myVehicle?.originalDriverName || '';

  // 이번달 세차 여부
  const ym = getCurrentYearMonth();
  const thisMonthWash = myVehicleLogs.find(l =>
    l.type === 'wash' && l.yearMonth === ym
  );

  // 최근 수리/사고
  const recentLogs = myVehicleLogs.slice(0, 10);

  const html = `
    <div class="vehicle-info">
      <div class="label">${isTemp ? '⚠️ 임시 운전 차량 (원래 ' + realDriver + ' 기사님)' : '내 차량'}</div>
      <div class="number">${vehicleNumber}</div>
    </div>

    <div style="padding:0 16px">
      <button class="action-big-btn wash" onclick="openVehicleModal('wash')">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="icon">🚗</span>
          <div style="text-align:left">
            <div>세차 인증</div>
            <div style="font-size:11px;color:#6B7280;font-weight:500">월 1회 / ${thisMonthWash ? '✅ 이번달 완료' : '⚠️ 이번달 미완료'}</div>
          </div>
        </div>
        <span class="arrow">›</span>
      </button>

      <button class="action-big-btn repair" onclick="openVehicleModal('repair')">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="icon">🔧</span>
          <div style="text-align:left">
            <div>차량 수리</div>
            <div style="font-size:11px;color:#6B7280;font-weight:500">타이어 교체 / 펑크</div>
          </div>
        </div>
        <span class="arrow">›</span>
      </button>

      <button class="action-big-btn accident" onclick="openVehicleModal('accident')">
        <div style="display:flex;align-items:center;gap:12px">
          <span class="icon">🚨</span>
          <div style="text-align:left">
            <div>접촉사고 신고</div>
            <div style="font-size:11px;color:#6B7280;font-weight:500">사진 + 메모 + 비율</div>
          </div>
        </div>
        <span class="arrow">›</span>
      </button>
    </div>

    <div class="history-card">
      <div class="title">📋 내 차량 기록 (최근 10건)</div>
      ${recentLogs.length === 0 ? '<div style="text-align:center;color:#9CA3AF;padding:20px;font-size:13px">기록 없음</div>' : recentLogs.map(l => {
        const dt = l.createdAt?.toDate ? l.createdAt.toDate() : new Date(l.createdAt);
        const dateStr = dt.toLocaleDateString('ko-KR');
        const typeIcon = { wash: '🚗', repair: '🔧', accident: '🚨' }[l.type] || '📌';
        const typeLabel = {
          wash: '세차 인증',
          repair: l.repairCategory === 'tire_replace' ? '타이어 교체' : l.repairCategory === 'tire_puncture' ? '타이어 펑크' : '차량 수리',
          accident: `접촉사고 (본인 ${l.myRatio || 0}% / 상대 ${l.otherRatio || 0}%)`,
        }[l.type] || l.type;
        return `
          <div class="history-row">
            <div class="left">
              <span class="icon">${typeIcon}</span>
              <div>
                <div class="text">${typeLabel}</div>
                <div class="desc">${(l.memo || '').slice(0, 30)}${(l.memo || '').length > 30 ? '...' : ''}</div>
              </div>
            </div>
            <div class="date">${dateStr}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
  container.innerHTML = html;
}

// 차량 입력 모달 (3가지 종류)
let vehicleModalSelectedCategory = null;
let vehicleSelectedPhotos = [];

function openVehicleModal(type) {
  vehicleSelectedPhotos = [];
  vehicleModalSelectedCategory = null;

  if (type === 'wash') {
    openWashModal();
  } else if (type === 'repair') {
    openRepairModal();
  } else if (type === 'accident') {
    openAccidentModal();
  }
}

function openWashModal() {
  const html = `
    <div class="modal-overlay" id="vehicleModal" onclick="if(event.target===this)closeVehicleModal()">
      <div class="modal-content">
        <div class="modal-handle"></div>
        <button class="modal-close" onclick="closeVehicleModal()">✕</button>
        <div class="modal-title">🚗 세차 인증</div>
        <div class="modal-subtitle">월 1회 본인 차량 세차 인증</div>

        <div class="form-group">
          <label class="form-label">차량 사진 *</label>
          <div class="photo-preview" id="vehiclePhotoPreview"></div>
          <input type="file" id="vehiclePhotoInput" accept="image/*" multiple style="display:none" onchange="handleVehiclePhoto(event)">
          <button class="upload-btn" onclick="document.getElementById('vehiclePhotoInput').click()" style="margin-top:8px">
            📸 사진 추가 (필수)
          </button>
        </div>

        <div class="form-group">
          <label class="form-label">메모 (선택)</label>
          <textarea class="form-textarea" id="vehicleMemo" placeholder="세차 장소, 비용 등 (선택)"></textarea>
        </div>

        <div id="vehicleMsg" style="font-size:13px;text-align:center;color:#6B7280;margin-bottom:12px;min-height:18px"></div>
        <button class="save-btn" id="vehicleSaveBtn" onclick="saveVehicleLog('wash')">💾 세차 인증</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

function openRepairModal() {
  const html = `
    <div class="modal-overlay" id="vehicleModal" onclick="if(event.target===this)closeVehicleModal()">
      <div class="modal-content">
        <div class="modal-handle"></div>
        <button class="modal-close" onclick="closeVehicleModal()">✕</button>
        <div class="modal-title">🔧 차량 수리</div>
        <div class="modal-subtitle">수리 종류 선택 후 입력</div>

        <div class="form-group">
          <label class="form-label">수리 종류 *</label>
          <div class="category-grid">
            <div class="category-btn" data-cat="tire_replace" onclick="selectCategory('tire_replace')">
              <span class="cat-icon">🔄</span>
              타이어 교체
            </div>
            <div class="category-btn" data-cat="tire_puncture" onclick="selectCategory('tire_puncture')">
              <span class="cat-icon">⚠️</span>
              타이어 펑크
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">사진</label>
          <div class="photo-preview" id="vehiclePhotoPreview"></div>
          <input type="file" id="vehiclePhotoInput" accept="image/*" multiple style="display:none" onchange="handleVehiclePhoto(event)">
          <button class="upload-btn" onclick="document.getElementById('vehiclePhotoInput').click()" style="margin-top:8px">
            📸 사진 추가
          </button>
        </div>

        <div class="form-group">
          <label class="form-label">메모 *</label>
          <textarea class="form-textarea" id="vehicleMemo" placeholder="수리 내용, 비용, 장소 등"></textarea>
        </div>

        <div id="vehicleMsg" style="font-size:13px;text-align:center;color:#6B7280;margin-bottom:12px;min-height:18px"></div>
        <button class="save-btn" id="vehicleSaveBtn" onclick="saveVehicleLog('repair')">💾 수리 기록 저장</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

function openAccidentModal() {
  const html = `
    <div class="modal-overlay" id="vehicleModal" onclick="if(event.target===this)closeVehicleModal()">
      <div class="modal-content">
        <div class="modal-handle"></div>
        <button class="modal-close" onclick="closeVehicleModal()">✕</button>
        <div class="modal-title">🚨 접촉사고 신고</div>
        <div class="modal-subtitle">사진 + 비율 + 메모</div>

        <div class="form-group">
          <label class="form-label">사고 비율 * (합계 100%)</label>
          <div class="ratio-input">
            <div class="ratio-box mine">
              <div class="label">본인 책임</div>
              <input type="number" id="myRatio" min="0" max="100" placeholder="0" oninput="updateOtherRatio(this.value)">
              <span class="pct">%</span>
            </div>
            <div class="ratio-box other">
              <div class="label">상대 책임</div>
              <input type="number" id="otherRatio" min="0" max="100" placeholder="100" readonly>
              <span class="pct">%</span>
            </div>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">사고 사진 (필수)</label>
          <div class="photo-preview" id="vehiclePhotoPreview"></div>
          <input type="file" id="vehiclePhotoInput" accept="image/*" multiple style="display:none" onchange="handleVehiclePhoto(event)">
          <button class="upload-btn" onclick="document.getElementById('vehiclePhotoInput').click()" style="margin-top:8px">
            📸 사진 추가 (필수)
          </button>
        </div>

        <div class="form-group">
          <label class="form-label">사고 내용 *</label>
          <textarea class="form-textarea" id="vehicleMemo" placeholder="장소, 상대 정보, 사고 경위 등 자세히 적어주세요"></textarea>
        </div>

        <div id="vehicleMsg" style="font-size:13px;text-align:center;color:#6B7280;margin-bottom:12px;min-height:18px"></div>
        <button class="save-btn" id="vehicleSaveBtn" onclick="saveVehicleLog('accident')" style="background:linear-gradient(135deg,#DC2626,#7F1D1D);box-shadow:0 4px 12px rgba(220,38,38,0.3)">🚨 사고 신고</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

function selectCategory(cat) {
  vehicleModalSelectedCategory = cat;
  document.querySelectorAll('.category-btn').forEach(b => {
    b.classList.toggle('selected', b.getAttribute('data-cat') === cat);
  });
}

function updateOtherRatio(myVal) {
  const my = parseInt(myVal || '0', 10);
  const other = Math.max(0, 100 - my);
  document.getElementById('otherRatio').value = other;
}

function closeVehicleModal() {
  const modal = document.getElementById('vehicleModal');
  if (modal) modal.remove();
  vehicleSelectedPhotos = [];
  vehicleModalSelectedCategory = null;
}

async function handleVehiclePhoto(event) {
  // 🆕 2026-05-06 영민님 직접 지시 — 사진 자동 압축
  const files = Array.from(event.target.files).slice(0, 3 - vehicleSelectedPhotos.length);
  for (const file of files) {
    try {
      const compressed = await compressImage(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        vehicleSelectedPhotos.push({ file: compressed, dataUrl: e.target.result });
        renderVehiclePhotoPreview();
      };
      reader.readAsDataURL(compressed);
    } catch (e) {
      console.warn('[handleVehiclePhoto]', e);
    }
  }
}

function renderVehiclePhotoPreview() {
  const container = document.getElementById('vehiclePhotoPreview');
  if (!container) return;
  container.innerHTML = vehicleSelectedPhotos.map((p, i) => `
    <div class="photo-thumb">
      <img src="${p.dataUrl}">
      <button class="remove" onclick="removeVehiclePhoto(${i})">✕</button>
    </div>
  `).join('');
}

function removeVehiclePhoto(i) {
  vehicleSelectedPhotos.splice(i, 1);
  renderVehiclePhotoPreview();
}

async function saveVehicleLog(type) {
  const msg = document.getElementById('vehicleMsg');
  const btn = document.getElementById('vehicleSaveBtn');

  // 검증
  const memo = document.getElementById('vehicleMemo').value.trim();

  if (type === 'wash' && vehicleSelectedPhotos.length === 0) {
    msg.style.color = '#DC2626';
    msg.textContent = '세차 사진은 필수입니다';
    return;
  }
  if (type === 'repair') {
    if (!vehicleModalSelectedCategory) {
      msg.style.color = '#DC2626';
      msg.textContent = '수리 종류를 선택해주세요';
      return;
    }
    if (!memo) {
      msg.style.color = '#DC2626';
      msg.textContent = '메모를 입력해주세요';
      return;
    }
  }
  if (type === 'accident') {
    if (vehicleSelectedPhotos.length === 0) {
      msg.style.color = '#DC2626';
      msg.textContent = '사고 사진은 필수입니다';
      return;
    }
    if (!memo) {
      msg.style.color = '#DC2626';
      msg.textContent = '사고 내용을 입력해주세요';
      return;
    }
    const myR = parseInt(document.getElementById('myRatio').value || '-1', 10);
    if (myR < 0 || myR > 100) {
      msg.style.color = '#DC2626';
      msg.textContent = '본인 책임 비율을 입력해주세요 (0~100)';
      return;
    }
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> 저장 중...';

  try {
    // 사진 업로드
    const photoUrls = [];
    if (vehicleSelectedPhotos.length > 0 && storage) {
      msg.textContent = `사진 ${vehicleSelectedPhotos.length}장 업로드 중...`;
      for (const p of vehicleSelectedPhotos) {
        const ts = Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const fn = `${currentUser.uid || currentUser.docId}_${ts}.jpg`;
        const ref = storage.ref().child(`vehicle_logs/${fn}`);
        await ref.put(p.file);
        const url = await ref.getDownloadURL();
        photoUrls.push(url);
      }
    }

    // 데이터
    const data = {
      driverId: currentUser.uid || currentUser.docId,
      driverName: currentUser.name,
      teamId: currentUser.teamId || '',
      teamName: myTeam?.name || '',
      vehicleNumber: myVehicle?.vehicleNumber || '미배정',
      isTempDriver: myVehicle?.isTempDriver || false,
      originalDriverId: myVehicle?.originalDriverId || null,
      originalDriverName: myVehicle?.originalDriverName || null,
      type, // wash / repair / accident
      photoUrls,
      memo,
      yearMonth: getCurrentYearMonth(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    if (type === 'repair') {
      data.repairCategory = vehicleModalSelectedCategory;
    }
    if (type === 'accident') {
      data.myRatio = parseInt(document.getElementById('myRatio').value, 10);
      data.otherRatio = parseInt(document.getElementById('otherRatio').value, 10);
    }

    msg.textContent = '저장 중...';
    await db.collection('vehicle_logs').add(data);

    msg.style.color = '#16A34A';
    msg.textContent = '✅ 저장 완료!';

    setTimeout(async () => {
      closeVehicleModal();
      await loadMyVehicleLogs();
      renderVehicle();
    }, 800);
  } catch (e) {
    console.error(e);
    msg.style.color = '#DC2626';
    msg.textContent = '❌ ' + e.message;
    btn.disabled = false;
    btn.innerHTML = '💾 저장하기';
  }
}

// ========== 탭 전환 ==========
function showTab(tab, el) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
  window.scrollTo(0, 0);
}

// ========== 시작 ==========
document.addEventListener('DOMContentLoaded', initApp);


// ════════════════════════════════════════════════════════
// 🆕 기사 피드백 모달 (정기휴무 / 종결 / 이관 / 불량 / 기타)
// 영민님 통합 흐름 (2026-05-05)
// ════════════════════════════════════════════════════════

function openFeedbackModal(type, targetId, clientName) {
  // 2026-05-12 영민님 직접 지시 — 준도시락 위기관리 사유 8가지
  // 기존 6개 + 추가 2개: 확인불가(unconfirmed) / 거래종결(closed)
  const titles = {
    stillActive: '🟢 거래중 (위기 잘못 발령)',
    wrongAssign: '🔴 오배정 (내 코스 아님)',
    closedDay: '🏖 정기휴무 등록',
    meeting: '🍻 회식 (오늘 단발성)',
    churnRisk: '⚠ 이탈조짐 보고',
    unconfirmed: '🚪 확인불가 / 추후확인',
    closed: '🛑 거래종결 (폐업/이전/이탈)',
    other: '📝 기타',
    holiday_influence: '📅 연휴 영향일 등록',
    // 호환용 (옛날 코드)
    holiday: '🏖 정기휴무 등록',
    closure: '🚫 종결 처리 요청',
    transfer: '🔄 이관 요청',
    bad_client: '⚠️ 불량업체 신고',
    etc: '❌ 기타 반려',
  };

  const subtitles = {
    stillActive: '거래 잘하고 있는데 위기 경보가 잘못 떴음 → 영민님이 확인 후 분석 시스템 수정',
    wrongAssign: '내 코스 거래처가 아닌데 잘못 배정됨 → 영민님이 확인 후 코스 매핑 수정',
    closedDay: '매주 같은 요일 휴무 (예: 매주 수요일 병원 휴진) → 거래처 마스터에 자동 등록 → 그 요일 자동 차단',
    meeting: '오늘만 단발성 — 다음 미주문 시 다시 위기 발령됨',
    churnRisk: '이탈 조짐 발견 — 영민님 결정 대기 (점수 0점, 정보 수집 목적)',
    unconfirmed: '방문했는데 사장님 부재/문 닫혀있음/연락 안 됨 → 화면에 계속 떠있음, 재방문 후 다른 버튼 누르세요',
    closed: '폐업/이전/이탈 확정 → 영민님 검토 후 헤이푸드 영업DB 이관 후보',
    other: '기타 사유 — 그날 위기만 해제',
    holiday_influence: '연휴 시작/종료/샌드위치 데이 등 출근자 적은 날',
    holiday: '오늘 이 업체는 휴무였습니까?',
    closure: '거래 종결 요청 (영민님 승인 후 처리)',
    transfer: '다른 코스로 이관 요청',
    bad_client: '수금 불량 등 거래 부적합 업체 신고',
    etc: '기타 반려 사유 입력',
  };

  const reasonPlaceholders = {
    stillActive: '예: 어제 주문 받음 / 내일 주문 예약됨 / 일시 휴진 후 곧 재개',
    wrongAssign: '예: 진짜 담당 코스/기사 (예: 코스7 안준수가 가는 곳임)',
    closedDay: '예: 매주 수요일 병원 휴진 / 매주 일요일 약국 휴무',
    meeting: '예: 회식 / 단체 외근 / 일시적 사정',
    churnRisk: '예: 다른 업체 시식 중 / 폐업 검토 / 클레임 발생',
    unconfirmed: '예: 사장님 부재 / 문 닫혀있음 / 전화 안 받음 (재방문 예정)',
    closed: '예: 폐업 확정 / 다른 지역 이전 / 다른 업체로 거래처 이동',
    other: '기타 사유',
    holiday_influence: '예: 연휴 전날 / 샌드위치 데이',
    holiday: '예: 매주 화요일 단체 외근',
    closure: '종결 사유',
    transfer: '이관 사유',
    bad_client: '불량 사유',
    etc: '반려 사유',
  };

  let html = `
    <div class="modal-overlay" id="feedbackModal" onclick="if(event.target===this)closeFeedbackModal()">
      <div class="modal-content">
        <div class="modal-handle"></div>
        <button class="modal-close" onclick="closeFeedbackModal()">✕</button>
        <div class="modal-title">${titles[type] || type}</div>
        <div class="modal-subtitle">${clientName ? clientName + ' · ' : ''}${subtitles[type] || ''}</div>
  `;

  // 연휴 영향일 — 날짜 + 유형 선택
  if (type === 'holiday_influence') {
    const today = new Date().toISOString().slice(0, 10);
    html += `
      <div class="form-group">
        <label class="form-label">날짜 *</label>
        <input type="date" class="form-input" id="feedbackDate" value="${today}">
      </div>
      <div class="form-group">
        <label class="form-label">유형 *</label>
        <select class="form-input" id="feedbackSubType">
          <option value="long_weekend">🏖️ 연휴 전후</option>
          <option value="sandwich_day">🥪 샌드위치 데이</option>
          <option value="public_holiday">🎌 공휴일</option>
          <option value="vacation_season">☀️ 휴가 시즌</option>
        </select>
      </div>
    `;
  }

  html += `
        <div class="form-group">
          <label class="form-label">사유</label>
          <textarea class="form-textarea" id="feedbackReason" placeholder="${reasonPlaceholders[type] || ''}"></textarea>
        </div>
        <div id="feedbackMsg" style="font-size:13px;text-align:center;color:#6B7280;margin-bottom:12px;min-height:18px"></div>
        <button class="save-btn" id="feedbackSaveBtn" onclick='saveFeedback("${type}", "${targetId || ''}", "${(clientName || '').replace(/"/g, '\\"')}")'>💾 제출</button>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
}

function closeFeedbackModal() {
  const modal = document.getElementById('feedbackModal');
  if (modal) modal.remove();
}

async function saveFeedback(type, targetId, clientName) {
  const msg = document.getElementById('feedbackMsg');
  const btn = document.getElementById('feedbackSaveBtn');
  const reason = document.getElementById('feedbackReason').value.trim();

  let targetDate = new Date().toISOString().slice(0, 10);
  let subType = '';
  if (type === 'holiday_influence') {
    targetDate = document.getElementById('feedbackDate').value;
    subType = document.getElementById('feedbackSubType').value;
    if (!targetDate) {
      msg.style.color = '#DC2626';
      msg.textContent = '날짜를 선택해주세요';
      return;
    }
  }

  // 2026-05-06 영민님 직접 지시 — 사유별 필수 체크
  // churnRisk/wrongAssign 사유 필수 / closedDay/meeting/other/stillActive는 선택
  // 2026-05-12 영민님 직접 지시 — unconfirmed/closed 사유 필수
  if ((type === 'churnRisk' || type === 'wrongAssign' || type === 'unconfirmed' || type === 'closed' || type === 'closure' || type === 'transfer' || type === 'bad_client') && !reason) {
    msg.style.color = '#DC2626';
    msg.textContent = '사유를 입력해주세요';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> 저장 중...';

  try {
    // 거래처명 정규화
    const normalized = (clientName || '').replace(/[\s\(\)\[\]_\-\.,#]/g, '').toLowerCase();

    // 2026-05-06 영민님 직접 지시 — 점수 자동 계산 (위기관리시스템 기준)
    const SCORE_MAP = { closedDay: 1, meeting: 2, churnRisk: 0, other: 1 };
    const awardScore = SCORE_MAP[type] !== undefined ? SCORE_MAP[type] : null;

    // 정기휴무 사유 — 오늘 요일을 거래처 마스터에 자동 등록 (closedDay)
    let closedDayCode = null;
    if (type === 'closedDay') {
      const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      closedDayCode = DAY_CODES[new Date(targetDate).getDay()];
    }

    // ae87f client_status_changes에 저장
    await db.collection('client_status_changes').add({
      type,
      subType: subType || null,
      clientName: clientName || '',
      clientNameNormalized: normalized,
      targetDate,
      targetId: targetId || null,
      reason,
      reportedBy: currentUser.uid || currentUser.docId,
      reportedByName: currentUser.name,
      teamId: currentUser.teamId || '',
      teamName: myTeam?.name || '',
      fromCourse: currentUser.courseId || null,
      awardScore,
      closedDayCode,
      synced: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    // 2026-05-06 영민님 직접 지시 — 새 사유에 따른 sales_targets 상태 변경
    // 2026-05-11 영민님 직접 지시 — sales_targets 상태 변경
    // 2026-05-12 영민님 직접 지시 — unconfirmed(확인대기/추적) / closed(거래종결) 추가
    //   unconfirmed: status='확인대기', followUpCount+1 — 화면에 계속 표시
    //   closed: status='종결확정' — 영민님 검토 후 헤이푸드 이관 후보
    if (targetId) {
      try {
        let statusMap = {
          stillActive: '거래중확인',     // 영민님이 분석 후 마스터 정정
          wrongAssign: '오배정확인',     // 영민님이 분석 후 코스 매핑 정정
          unconfirmed: '확인대기',       // 화면에 계속 표시, 재방문 카운터 +1
          closed: '종결확정',            // 영민님 검토 후 헤이푸드 영업DB 이관 후보
          closedDay: '완료', meeting: '완료', churnRisk: '완료', other: '완료',
          closure: '종결요청', transfer: '이관요청', bad_client: '불량반려',
        };

        const updateData = {
          status: statusMap[type] || '완료',
          feedbackType: type,
          feedbackBy: currentUser.name,
          feedbackAt: firebase.firestore.FieldValue.serverTimestamp(),
          feedbackReason: reason || '',
        };

        // 확인불가는 추적 카운터 누적 (화면에 계속 표시)
        if (type === 'unconfirmed') {
          updateData.followUpCount = firebase.firestore.FieldValue.increment(1);
          updateData.lastFollowUpAt = firebase.firestore.FieldValue.serverTimestamp();
          updateData.followUpHistory = firebase.firestore.FieldValue.arrayUnion({
            date: new Date().toISOString().slice(0, 10),
            reason: reason || '',
            driverName: currentUser.name,
            at: new Date().toISOString(),
          });
        }

        // 거래종결은 영민님 검토 후보로 분류
        if (type === 'closed') {
          updateData.closedReason = reason || '';
          updateData.closedAt = firebase.firestore.FieldValue.serverTimestamp();
          updateData.closedBy = currentUser.name;
          updateData.adminReviewPending = true; // 영민님 검토 대기
        }

        await db.collection('sales_targets').doc(targetId).update(updateData);
      } catch (e) { console.warn(e); }
    }

    // 거래처 마스터에 자동 등록 (정기휴무 / 이탈조짐)
    if ((type === 'closedDay' && closedDayCode) || type === 'churnRisk') {
      try {
        // clientName 으로 매칭하여 업데이트
        const clientsSnap = await db.collection('clients').where('name', '==', clientName).get();
        for (const doc of clientsSnap.docs) {
          const updates = {
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: currentUser.name,
          };
          if (type === 'closedDay' && closedDayCode) {
            updates.closedDay = closedDayCode;
          }
          if (type === 'churnRisk') {
            updates.riskFlag = true;
            updates.riskFlagDate = targetDate;
            updates.riskFlagBy = currentUser.name;
            updates.riskFlagMemo = reason;
          }
          await doc.ref.update(updates);
        }
      } catch (e) { console.warn('clients 마스터 업데이트 실패:', e); }
    }

    msg.style.color = '#16A34A';
    msg.textContent = '✅ 저장 완료! 영민님 분석시스템에서 확인합니다.';

    setTimeout(async () => {
      closeFeedbackModal();
      await loadSalesTargets();
      renderHome();
    }, 1000);
  } catch (e) {
    msg.style.color = '#DC2626';
    msg.textContent = '❌ ' + e.message;
    btn.disabled = false;
    btn.innerHTML = '💾 제출';
  }
}

// 홈 화면 상단에 [📅 연휴 영향일 등록] 버튼 추가용
function openHolidayInfluence() {
  openFeedbackModal('holiday_influence');
}

window.openFeedbackModal = openFeedbackModal;
window.closeFeedbackModal = closeFeedbackModal;
window.saveFeedback = saveFeedback;
window.openHolidayInfluence = openHolidayInfluence;


// ════════════════════════════════════════════════════════
// 🆕 신규업체 추적 보고 시스템 (2026-05-05 영민님 통합 흐름)
// ════════════════════════════════════════════════════════

async function loadTrackingClients() {
  try {
    const snap = await db.collection('tracking_clients')
      .where('status', '==', 'tracking')
      .get();
    trackingClients = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 본인 보고 횟수 추가
    const myReportsSnap = await db.collection('tracking_reports')
      .where('reportedBy', '==', currentUser.uid || currentUser.docId)
      .get();
    const reportCountByClient = {};
    myReportsSnap.docs.forEach(d => {
      const r = d.data();
      reportCountByClient[r.clientName] = (reportCountByClient[r.clientName] || 0) + 1;
    });

    trackingClients.forEach(t => {
      t.myReportCount = reportCountByClient[t.clientName] || 0;
    });
  } catch (e) {
    console.warn('[tracking_clients] 로드 실패', e);
    trackingClients = [];
  }
}

let trackingSelectedTags = [];
let currentTrackingClient = null;

function openTrackingReportModal(clientName, clientId) {
  trackingSelectedTags = [];
  currentTrackingClient = { clientName, clientId };

  const html = `
    <div class="modal-overlay" id="trackingModal" onclick="if(event.target===this)closeTrackingModal()">
      <div class="modal-content">
        <div class="modal-handle"></div>
        <button class="modal-close" onclick="closeTrackingModal()">✕</button>
        <div class="modal-title">🆕 ${clientName}</div>
        <div class="modal-subtitle">신규업체 추적 보고 (여러 개 선택 가능)</div>

        <div class="form-group">
          <label class="form-label">📊 거래처 상황 (해당하는 거 모두 선택)</label>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
            <button class="tracking-tag-btn" data-tag="satisfied" onclick="toggleTrackingTag('satisfied')">
              😊 만족 (계속 시킬 듯)
            </button>
            <button class="tracking-tag-btn" data-tag="normal" onclick="toggleTrackingTag('normal')">
              😐 보통 (반응 무난)
            </button>
            <button class="tracking-tag-btn" data-tag="dissatisfied" onclick="toggleTrackingTag('dissatisfied')">
              😟 불만 (불평/의문 있음)
            </button>
            <button class="tracking-tag-btn" data-tag="expandable" onclick="toggleTrackingTag('expandable')">
              🏢 확장 가능성 (직원 많아질 듯)
            </button>
            <button class="tracking-tag-btn" data-tag="delivery_hard" onclick="toggleTrackingTag('delivery_hard')">
              📍 배송 어려움 (위치/시간 문제)
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">📝 기타 (자유 입력)</label>
          <textarea class="form-textarea" id="trackingNote" placeholder="특이사항, 사장님 반응, 추가 정보 등 (선택)"></textarea>
        </div>

        <div id="trackingMsg" style="font-size:13px;text-align:center;color:#6B7280;margin-bottom:12px;min-height:18px"></div>
        <button class="save-btn" id="trackingSaveBtn" onclick="saveTrackingReport()" style="background:linear-gradient(135deg,#7C3AED,#4C1D95)">📝 보고 제출</button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
}

function closeTrackingModal() {
  const modal = document.getElementById('trackingModal');
  if (modal) modal.remove();
  trackingSelectedTags = [];
  currentTrackingClient = null;
}

function toggleTrackingTag(tag) {
  const idx = trackingSelectedTags.indexOf(tag);
  if (idx >= 0) {
    trackingSelectedTags.splice(idx, 1);
  } else {
    trackingSelectedTags.push(tag);
  }
  // 시각 업데이트
  document.querySelectorAll('.tracking-tag-btn').forEach(btn => {
    const t = btn.getAttribute('data-tag');
    btn.classList.toggle('selected', trackingSelectedTags.includes(t));
  });
}

async function saveTrackingReport() {
  const msg = document.getElementById('trackingMsg');
  const btn = document.getElementById('trackingSaveBtn');
  const note = document.getElementById('trackingNote').value.trim();

  if (trackingSelectedTags.length === 0 && !note) {
    msg.style.color = '#DC2626';
    msg.textContent = '버튼 선택 또는 기타 메모를 입력해주세요';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="loader"></span> 저장 중...';

  try {
    await db.collection('tracking_reports').add({
      clientName: currentTrackingClient.clientName,
      clientId: currentTrackingClient.clientId,
      tags: trackingSelectedTags,
      note,
      reportedBy: currentUser.uid || currentUser.docId,
      reportedByName: currentUser.name,
      teamId: currentUser.teamId || '',
      teamName: myTeam?.name || '',
      courseId: currentUser.courseId || null,
      yearMonth: getCurrentYearMonth(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    msg.style.color = '#16A34A';
    msg.textContent = '✅ 보고 저장 완료!';

    setTimeout(async () => {
      closeTrackingModal();
      await loadTrackingClients();
      renderHome();
    }, 800);
  } catch (e) {
    msg.style.color = '#DC2626';
    msg.textContent = '❌ ' + e.message;
    btn.disabled = false;
    btn.innerHTML = '📝 보고 제출';
  }
}

window.openTrackingReportModal = openTrackingReportModal;
window.closeTrackingModal = closeTrackingModal;
window.toggleTrackingTag = toggleTrackingTag;
window.saveTrackingReport = saveTrackingReport;
