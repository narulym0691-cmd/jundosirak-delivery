// admin.js - 관리자 대시보드

let adminUser = null;
let allTeamsData = [];
let allStatsData = {};

async function initAdmin() {
  adminUser = requireAuth(['admin', 'manager']);
  if (!adminUser) return;

  document.getElementById('adminName').textContent = adminUser.name;
  updateMonthInfo();

  await Promise.all([
    loadAdminData(),
    loadAdminAlerts(),
    loadAdminDirectives()
  ]);
}

// 이번달 / 영업일 경과 표시 (실제 데이터 있는 날 기준)
async function updateMonthInfo() {
  const ym = getCurrentYearMonth();

  // 이번달 전체 영업일 (월~금 기준)
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  let totalBizDays = 0;
  for (let d = 1; d <= lastDay; d++) {
    const day = new Date(y, m, d).getDay();
    if (day >= 1 && day <= 5) totalBizDays++;
  }

  // 실제 데이터 있는 날짜 수 (daily_sales 컬렉션)
  try {
    const snap = await db.collection('daily_sales')
      .where('date', '>=', ym+'-01')
      .where('date', '<=', ym+'-31')
      .get();
    const bizDaysPassed = snap.size;
    document.getElementById('monthLabel').textContent = `${ym}`;
    document.getElementById('bizDaysLabel').textContent = `영업일 ${bizDaysPassed}/${totalBizDays}일 경과 (실적기준)`;
  } catch(e) {
    document.getElementById('monthLabel').textContent = `${ym}`;
    document.getElementById('bizDaysLabel').textContent = `-`;
  }
}

// 팀 및 통계 데이터 로드
async function loadAdminData() {
  const ym = getCurrentYearMonth();

  try {
    const [teamsSnap, statsDoc] = await Promise.all([
      db.collection('teams').get(),
      db.collection('monthly_stats').doc(ym).get()
    ]);

    allTeamsData = [];
    teamsSnap.forEach(doc => allTeamsData.push({ id: doc.id, ...doc.data() }));
    allStatsData = statsDoc.exists ? statsDoc.data() : {};

    renderSummaryCards();
    renderAdminTeamRanking();
  } catch (e) {
    console.error('관리자 데이터 로드 실패:', e);
  }
}

// 요약 카드 3개 렌더링
function renderSummaryCards() {
  // 전체 누적수량 합산
  let totalCumul = 0;
  let totalBaseline = 0;
  allTeamsData.forEach(t => {
    const s = allStatsData[t.id] || {};
    totalCumul += s.cumulativeTotal || 0;
    totalBaseline += s.baselineCumulative || 0;
  });
  const totalDiff = totalCumul - totalBaseline;
  const totalDiffStr = totalDiff >= 0 ? `+${numFormat(totalDiff)}` : numFormat(totalDiff);

  document.getElementById('summaryTotal').innerHTML = `
    <div class="summary-val">${numFormat(totalCumul)}</div>
    <div class="summary-sub ${totalDiff >= 0 ? 'positive' : 'negative'}">기준대비 ${totalDiffStr}</div>
  `;

  // 예상 판매수당 합계 (임시: 초과분 × 50원 가정)
  const estimatedBonus = Math.max(0, totalDiff) * 50;
  document.getElementById('summaryBonus').innerHTML = `
    <div class="summary-val">${numFormat(estimatedBonus)}원</div>
    <div class="summary-sub">초과 수당 합계(추정)</div>
  `;
}

// 팀 순위 테이블
function renderAdminTeamRanking() {
  const container = document.getElementById('adminRankingTable');
  if (!allTeamsData.length) {
    container.innerHTML = '<div class="empty-msg">데이터가 없습니다.</div>';
    return;
  }

  const ranked = allTeamsData.map(t => {
    const s = allStatsData[t.id] || {};
    const cumul = s.cumulativeTotal || 0;
    const baseline = s.baselineCumulative || 0;
    const diff = cumul - baseline;
    const grade = s.grade || calcGrade(cumul, t);
    return { ...t, cumul, baseline, diff, grade };
  }).sort((a, b) => b.diff - a.diff);

  const rows = ranked.map((t, i) => {
    const diffStr = t.diff >= 0 ? `+${numFormat(t.diff)}` : numFormat(t.diff);
    const gColor = gradeColor(t.grade);
    return `
      <tr>
        <td>${i + 1}</td>
        <td style="text-align:left;font-weight:600">${t.name}</td>
        <td>${numFormat(t.cumul)}</td>
        <td class="${t.diff >= 0 ? 'positive' : 'negative'}">${diffStr}</td>
        <td><span class="grade-badge-sm" style="background:${gColor}">${t.grade}</span></td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>순위</th><th>팀명</th><th>누적수량</th><th>기준대비</th><th>등급</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// 거래처 경보 로드
async function loadAdminAlerts() {
  const container = document.getElementById('adminAlertsCard');
  const summaryEl = document.getElementById('summaryAlerts');

  try {
    const snap = await db.collection('alerts').get();
    let urgent = 0, watch = 0, check = 0;
    const items = [];

    snap.forEach(doc => {
      const a = { id: doc.id, ...doc.data() };
      items.push(a);
      if (a.level === 'urgent') urgent++;
      else if (a.level === 'watch') watch++;
      else check++;
    });

    // 요약 카드 업데이트
    summaryEl.innerHTML = `
      <div class="alert-summary-row">
        <span class="alert-count urgent">${urgent}</span>
        <span class="alert-label">즉시경보</span>
      </div>
      <div class="alert-summary-row">
        <span class="alert-count watch">${watch}</span>
        <span class="alert-label">주시</span>
      </div>
      <div class="alert-summary-row">
        <span class="alert-count check">${check}</span>
        <span class="alert-label">확인보고</span>
      </div>
    `;

    if (!items.length) {
      container.innerHTML = '<div class="empty-msg">경보가 없습니다.</div>';
      return;
    }

    items.sort((a, b) => {
      const order = { urgent: 0, check: 1, watch: 2 };
      return (order[a.level] || 9) - (order[b.level] || 9);
    });

    container.innerHTML = items.slice(0, 10).map(a => {
      const levelLabel = a.level === 'urgent' ? '즉시경보' : a.level === 'watch' ? '주시' : '확인보고';
      const levelClass = a.level === 'watch' ? 'alert-watch' : 'alert-urgent';
      return `
        <div class="alert-row ${levelClass}">
          <span class="alert-badge ${levelClass}">${levelLabel}</span>
          <span class="alert-client">${a.clientName}</span>
          <span class="alert-days-sm">${a.consecutiveDays}일</span>
        </div>
      `;
    }).join('');

  } catch (e) {
    console.error('경보 로드 실패:', e);
    container.innerHTML = '<div class="card-error">경보 데이터 로드 실패</div>';
    summaryEl.innerHTML = '<div class="empty-msg">-</div>';
  }
}

// 지시사항 이행률
async function loadAdminDirectives() {
  const container = document.getElementById('directiveProgressCard');
  const feedbackContainer = document.getElementById('feedbackPendingCard');

  try {
    const snap = await db.collection('directives').get();

    const directives = [];
    snap.forEach(doc => directives.push({ id: doc.id, ...doc.data() }));
    directives.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    directives.splice(20);

    if (!directives.length) {
      container.innerHTML = '<div class="empty-msg">등록된 지시사항이 없습니다.</div>';
      feedbackContainer.innerHTML = '<div class="empty-msg">없음</div>';
      return;
    }

    // 팀별 완료율 계산
    const teamProgress = {};
    allTeamsData.forEach(t => {
      teamProgress[t.id] = { name: t.name, total: 0, done: 0 };
    });

    // 사용자 목록 가져오기
    const usersSnap = await db.collection('users').get();
    const userTeamMap = {};
    usersSnap.forEach(doc => {
      const d = doc.data();
      if (d.active !== false) userTeamMap[doc.id] = d.teamId;
    });

    directives.forEach(d => {
      const targetTeams = d.targetTeams && d.targetTeams.length > 0
        ? d.targetTeams
        : allTeamsData.map(t => t.id);

      targetTeams.forEach(tid => {
        if (!teamProgress[tid]) return;
        teamProgress[tid].total++;
        // completions 확인
        if (d.completions) {
          const teamUsers = Object.keys(userTeamMap).filter(uid => userTeamMap[uid] === tid);
          const anyDone = teamUsers.some(uid => d.completions[uid] && d.completions[uid].done);
          if (anyDone) teamProgress[tid].done++;
        }
      });
    });

    const progressHtml = Object.values(teamProgress).map(tp => {
      const pct = tp.total > 0 ? Math.round((tp.done / tp.total) * 100) : 0;
      const barColor = pct >= 80 ? '#38a169' : pct >= 50 ? '#ecc94b' : '#fc8181';
      return `
        <div class="progress-item">
          <div class="progress-header">
            <span class="progress-team">${tp.name}</span>
            <span class="progress-pct" style="color:${barColor}">${pct}%</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <div class="progress-sub">${tp.done}/${tp.total} 완료</div>
        </div>
      `;
    }).join('');

    container.innerHTML = progressHtml || '<div class="empty-msg">데이터가 없습니다.</div>';
    feedbackContainer.innerHTML = '<div class="empty-msg">피드백 기능 준비 중입니다.</div>';

  } catch (e) {
    console.error('지시사항 이행률 로드 실패:', e);
    container.innerHTML = '<div class="card-error">데이터 로드 실패</div>';
  }
}
