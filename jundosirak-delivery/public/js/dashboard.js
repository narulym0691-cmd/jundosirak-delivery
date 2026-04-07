// dashboard.js - 기사 대시보드

let currentUser = null;
let myTeam = null;
let myTeamStats = null;
let allTeams = [];
let allStats = {};

async function initDashboard() {
  currentUser = requireAuth(['admin', 'manager', 'leader', 'driver']);
  if (!currentUser) return;

  document.getElementById('userName').textContent = currentUser.name;

  // 현재 탭 표시
  showTab('home');

  // 데이터 로드
  await Promise.all([
    loadTeamData(),
    loadDirectives(),
    loadAlerts()
  ]);
}

// 팀 및 월간 통계 로드
async function loadTeamData() {
  const ym = getCurrentYearMonth();

  try {
    // 모든 팀 불러오기
    const teamsSnap = await db.collection('teams').get();
    allTeams = [];
    teamsSnap.forEach(doc => {
      allTeams.push({ id: doc.id, ...doc.data() });
    });

    // 팀 이름 헤더에 표시
    if (currentUser.teamId) {
      const t = allTeams.find(t => t.id === currentUser.teamId);
      if (t) {
        myTeam = t;
        document.getElementById('teamName').textContent = t.name;
      }
    }

    // 월간 통계 불러오기
    const statsDoc = await db.collection('monthly_stats').doc(ym).get();
    allStats = statsDoc.exists ? statsDoc.data() : {};

    if (currentUser.teamId) {
      myTeamStats = allStats[currentUser.teamId] || null;
    }

    renderIncentiveGauge();
    renderTeamRanking();

  } catch (e) {
    console.error('팀 데이터 로드 실패:', e);
    document.getElementById('gaugeCard').innerHTML = '<div class="card-error">데이터를 불러오지 못했습니다.</div>';
  }
}

// 카드 1: 인센티브 게이지
function renderIncentiveGauge() {
  const container = document.getElementById('gaugeCard');
  if (!myTeam || !myTeamStats) {
    container.innerHTML = '<div class="empty-msg">팀 데이터가 없습니다.</div>';
    return;
  }

  const s = myTeamStats;
  const t = myTeam;
  const cumul = s.cumulativeTotal || 0;
  const baseline = s.baselineCumulative || t.baselineDailyAvg;
  const diff = cumul - baseline;
  const diffStr = diff >= 0 ? `+${numFormat(diff)}` : numFormat(diff);
  const grade = s.grade || calcGrade(cumul, t);
  const gColor = gradeColor(grade);

  // 게이지 계산 (기준선 0%, A등급 100%)
  const rangeMin = baseline;
  const rangeMax = t.gradeA * (baseline / t.baselineDailyAvg || 1);
  // 누적 기반 진행도 (기준미달=0, A초과=100)
  const gaugePct = Math.min(100, Math.max(0,
    ((cumul - rangeMin) / (rangeMax - rangeMin + 1)) * 100
  ));

  // B까지 남은 개수
  const toB = t.gradeB ? Math.max(0, t.gradeB - cumul) : null;
  const toA = t.gradeA ? Math.max(0, t.gradeA - cumul) : null;
  let remainMsg = '';
  if (grade === 'A') {
    remainMsg = '🏆 A등급 달성!';
  } else if (grade === 'B') {
    remainMsg = toA > 0 ? `A등급까지 <strong>${numFormat(toA)}개</strong> 남음` : '';
  } else {
    remainMsg = toB > 0 ? `B등급까지 <strong>${numFormat(toB)}개</strong> 남음` : '';
  }

  container.innerHTML = `
    <div class="gauge-header">
      <span class="gauge-team">${t.name}</span>
      <span class="grade-badge" style="background:${gColor}">${grade}등급</span>
    </div>
    <div class="gauge-numbers">
      <div class="gauge-num-item">
        <div class="gauge-num-label">누적수량</div>
        <div class="gauge-num-val">${numFormat(cumul)}</div>
      </div>
      <div class="gauge-num-item">
        <div class="gauge-num-label">기준누적</div>
        <div class="gauge-num-val">${numFormat(baseline)}</div>
      </div>
      <div class="gauge-num-item">
        <div class="gauge-num-label">기준대비</div>
        <div class="gauge-num-val ${diff >= 0 ? 'positive' : 'negative'}">${diffStr}</div>
      </div>
    </div>
    <div class="gauge-bar-wrap">
      <div class="gauge-bar-bg">
        <div class="gauge-bar-fill" style="width:${gaugePct.toFixed(1)}%;background:${gColor}"></div>
      </div>
      <div class="gauge-bar-labels">
        <span>기준</span><span>C</span><span>B</span><span>A</span>
      </div>
    </div>
    <div class="gauge-remain">${remainMsg}</div>
  `;
}

// 카드 2: 팀 순위
function renderTeamRanking() {
  const container = document.getElementById('rankingCard');
  if (!allTeams.length) {
    container.innerHTML = '<div class="empty-msg">팀 데이터가 없습니다.</div>';
    return;
  }

  // 팀별 누적 기준 정렬
  const ranked = allTeams.map(t => {
    const s = allStats[t.id] || {};
    const cumul = s.cumulativeTotal || 0;
    const baseline = s.baselineCumulative || 0;
    const diff = cumul - baseline;
    const grade = s.grade || calcGrade(cumul, t);
    return { ...t, cumul, baseline, diff, grade };
  }).sort((a, b) => b.diff - a.diff);

  const rows = ranked.map((t, i) => {
    const isMe = t.id === currentUser.teamId;
    const diffStr = t.diff >= 0 ? `+${numFormat(t.diff)}` : numFormat(t.diff);
    const gColor = gradeColor(t.grade);
    return `
      <tr class="${isMe ? 'my-team-row' : ''}">
        <td class="rank-cell">${i + 1}</td>
        <td class="name-cell">${t.name}${isMe ? ' <span class="me-tag">나</span>' : ''}</td>
        <td class="num-cell">${numFormat(t.cumul)}</td>
        <td class="num-cell ${t.diff >= 0 ? 'positive' : 'negative'}">${diffStr}</td>
        <td class="grade-cell"><span class="grade-badge-sm" style="background:${gColor}">${t.grade}</span></td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="rank-table">
      <thead>
        <tr>
          <th>순위</th><th>팀명</th><th>누적</th><th>기준대비</th><th>등급</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// 카드 3: 거래처 경보 로드
async function loadAlerts() {
  const container = document.getElementById('alertsCard');
  if (!currentUser.courseId) {
    container.innerHTML = '<div class="empty-msg">담당 코스가 없습니다.</div>';
    return;
  }

  try {
    const snap = await db.collection('alerts')
      .where('courseId', '==', currentUser.courseId)
      .get();

    if (snap.empty) {
      container.innerHTML = '<div class="empty-msg">현재 경보가 없습니다.</div>';
      return;
    }

    const items = [];
    snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    const levelOrder = { urgent: 0, watch: 1, check: 2 };
    items.sort((a, b) => (levelOrder[a.level] ?? 99) - (levelOrder[b.level] ?? 99));

    const html = items.map(a => {
      let levelLabel, levelClass;
      if (a.level === 'urgent') { levelLabel = '즉시경보'; levelClass = 'alert-urgent'; }
      else if (a.level === 'watch') { levelLabel = '주시'; levelClass = 'alert-watch'; }
      else { levelLabel = '확인보고'; levelClass = 'alert-check'; }

      const lastDate = a.lastOrderDate ? a.lastOrderDate.toDate().toLocaleDateString('ko-KR') : '-';
      return `
        <div class="alert-item ${levelClass}">
          <div class="alert-left">
            <span class="alert-badge ${levelClass}">${levelLabel}</span>
            <span class="alert-name">${a.clientName}</span>
            ${a.isPriority ? '<span class="priority-tag">우선</span>' : ''}
          </div>
          <div class="alert-right">
            <span class="alert-days">${a.consecutiveDays}일 연속</span>
            <span class="alert-date">${lastDate}</span>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

  } catch (e) {
    console.error('경보 데이터 로드 실패:', e);
    container.innerHTML = '<div class="card-error">경보 데이터를 불러오지 못했습니다.</div>';
  }
}

// 카드 4: 지시사항 로드
async function loadDirectives() {
  const container = document.getElementById('directivesCard');

  try {
    const now = new Date();
    const snap = await db.collection('directives')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const items = [];
    snap.forEach(doc => {
      const d = doc.data();
      // 내 팀 해당 지시사항 필터
      if (d.targetTeams && d.targetTeams.length > 0) {
        if (!currentUser.teamId || !d.targetTeams.includes(currentUser.teamId)) return;
      }
      // 미완료 항목만
      const myCompletion = d.completions && d.completions[currentUser.uid];
      if (myCompletion && myCompletion.done) return;

      items.push({ id: doc.id, ...d });
    });

    if (!items.length) {
      container.innerHTML = '<div class="empty-msg">✅ 미완료 지시사항이 없습니다.</div>';
      return;
    }

    const html = items.map(d => {
      const dl = d.deadline ? d.deadline.toDate().toLocaleDateString('ko-KR') : '없음';
      const isOverdue = d.deadline && d.deadline.toDate() < now;
      return `
        <div class="directive-item" id="dir-${d.id}">
          <label class="directive-check-wrap">
            <input type="checkbox" class="directive-cb" onchange="completeDirective('${d.id}', this)">
            <span class="directive-content">${d.content}</span>
          </label>
          <div class="directive-meta">
            <span class="directive-deadline ${isOverdue ? 'overdue' : ''}">마감: ${dl}</span>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = html;

  } catch (e) {
    console.error('지시사항 로드 실패:', e);
    container.innerHTML = '<div class="card-error">지시사항을 불러오지 못했습니다.</div>';
  }
}

// 지시사항 완료 처리
async function completeDirective(directiveId, checkbox) {
  checkbox.disabled = true;
  try {
    await db.collection('directives').doc(directiveId).update({
      [`completions.${currentUser.uid}`]: {
        done: true,
        comment: '',
        doneAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    });
    // 완료 처리 후 항목 시각적 업데이트
    const item = document.getElementById(`dir-${directiveId}`);
    if (item) {
      item.style.opacity = '0.4';
      item.style.textDecoration = 'line-through';
      setTimeout(() => item.remove(), 800);
    }
  } catch (e) {
    console.error('완료 처리 실패:', e);
    checkbox.checked = false;
    checkbox.disabled = false;
    alert('완료 처리에 실패했습니다.');
  }
}

// 탭 전환
function showTab(tabName) {
  // 탭 버튼 활성화
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // 섹션 표시/숨김
  document.querySelectorAll('.tab-section').forEach(sec => {
    sec.style.display = sec.dataset.tab === tabName ? 'block' : 'none';
  });
}
