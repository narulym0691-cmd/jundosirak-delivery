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
    loadAlerts(),
    loadAlertReport()
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
    if (!statsDoc.exists) {
      document.getElementById('gaugeCard').innerHTML = '<div class="empty-msg">📊 판매 데이터가 없습니다.</div>';
      document.getElementById('rankingCard').innerHTML = '<div class="empty-msg">📊 판매 데이터가 없습니다.</div>';
      return;
    }
    allStats = statsDoc.data();

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
  if (!myTeam) {
    container.innerHTML = '<div class="empty-msg">팀 데이터가 없습니다.</div>';
    return;
  }

  // monthly_stats 데이터가 없으면 빈 상태 표시
  if (!myTeamStats || Object.keys(myTeamStats).length === 0) {
    container.innerHTML = '<div class="empty-msg">📊 판매 데이터가 없습니다.</div>';
    return;
  }

  const s = myTeamStats;
  // 모든 수치는 monthly_stats에서만 읽음
  const cumul    = s.cumulativeTotal  || 0;
  const baseline = s.baselineCumulative || 0;
  const diff     = s.dailyAvgDiff !== undefined ? Math.round(s.dailyAvgDiff) * (s.bizDays || 0) : (cumul - baseline);
  const diffStr  = diff >= 0 ? `+${numFormat(diff)}` : numFormat(diff);
  const grade    = s.grade || '기준미달';
  const gColor   = gradeColor(grade);
  const gaugePct = baseline > 0 ? Math.min(100, Math.max(0, (cumul / baseline) * 100)) : 0;

  const toNextGrade = (() => {
    if (grade === 'A') return '🏆 A등급 달성!';
    const toB  = Math.max(0, (s.baselineCumulative || 0) * 1.1 - cumul);
    return `B등급까지 <strong>${numFormat(Math.ceil(toB))}개</strong> 남음`;
  })();

  container.innerHTML = `
    <div class="gauge-header">
      <span class="gauge-team">${myTeam.name}</span>
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
    <div class="gauge-remain">${toNextGrade}</div>
  `;
}

// 카드 2: 팀 순위
function renderTeamRanking() {
  const container = document.getElementById('rankingCard');
  if (!allTeams.length) {
    container.innerHTML = '<div class="empty-msg">팀 데이터가 없습니다.</div>';
    return;
  }

  // monthly_stats 없으면 빈 상태 표시 (teams 컬렉션으로 절대 계산하지 않음)
  if (!allStats || Object.keys(allStats).length === 0) {
    container.innerHTML = '<div class="empty-msg">📊 판매 데이터가 없습니다.<br><small>일일장부를 업로드하면 표시됩니다.</small></div>';
    return;
  }

  const ranked = allTeams.map(t => {
    const s = allStats[t.id] || {};
    const hasStats = Object.keys(s).length > 0;
    // 모든 수치는 monthly_stats에서만 읽음. 없으면 0
    const cumTotal    = hasStats ? (s.cumulativeTotal || 0) : 0;
    const bizDays     = hasStats ? (s.bizDays || 0) : 0;
    const dailyAvg    = hasStats ? (s.dailyAvg || 0) : 0;
    const dailyAvgDiff = hasStats ? (s.dailyAvgDiff || 0) : 0;
    const grade       = hasStats ? (s.grade || '기준미달') : '-';
    const baseline    = hasStats ? (s.baselineCumulative || 0) : 0;
    return { ...t, dailyAvg, dailyAvgDiff, grade, cumTotal, bizDays, baseline };
  }).sort((a, b) => b.dailyAvgDiff - a.dailyAvgDiff);

  const rows = ranked.map((t, i) => {
    const isMe = t.id === currentUser.teamId;
    const diffStr = t.dailyAvgDiff >= 0 ? `+${t.dailyAvgDiff}` : `${t.dailyAvgDiff}`;
    const gColor = gradeColor(t.grade);
    const diffColor = t.dailyAvgDiff >= 0 ? '#276749' : '#e53e3e';
    return `
      <tr class="${isMe ? 'my-team-row' : ''}">
        <td class="rank-cell">${i + 1}</td>
        <td class="name-cell">${t.name}${isMe ? ' <span class="me-tag">나</span>' : ''}</td>
        <td class="num-cell" onclick="showCumExplain('${t.name}', ${t.cumTotal}, ${t.dailyAvg}, ${t.bizDays}, ${t.dailyAvgDiff}, ${t.baseline||0})" style="cursor:pointer;text-decoration:underline dotted;color:var(--primary);">${t.dailyAvg}</td>
        <td class="num-cell" style="font-weight:700;color:${diffColor}">${diffStr}</td>
        <td class="grade-cell"><span class="grade-badge-sm" style="background:${gColor}">${t.grade}</span></td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="rank-table">
      <thead>
        <tr>
          <th>순위</th><th>팀명</th><th>일평균</th><th>기준대비</th><th>등급</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// 카드 3: 거래처 경보 로드
async function loadAlerts() {
  const container = document.getElementById('alertsCard');
  if (!currentUser.teamId) {
    container.innerHTML = '<div class="empty-msg">담당 팀이 없습니다.</div>';
    return;
  }

  try {
    const snap = await db.collection('alerts')
      .where('teamId','==',currentUser.teamId)
      .where('resolved','==',false)
      .get();

    const items = [];
    snap.forEach(doc => {
      const d = doc.data();
      items.push({ id: doc.id, ...d });
    });

    if (!items.length) {
      container.innerHTML = '<div class="empty-msg">✅ 현재 경보가 없습니다.</div>';
      return;
    }

    // grade 정렬: urgent > watch > check
    const levelOrder = { urgent: 0, watch: 1, check: 2 };
    items.sort((a, b) => (levelOrder[a.grade] ?? 99) - (levelOrder[b.grade] ?? 99));

    const html = items.map(a => {
      let levelLabel, levelClass;
      if (a.grade === 'urgent') { levelLabel = '🔴 즉시경보'; levelClass = 'alert-urgent'; }
      else if (a.grade === 'watch') { levelLabel = '🟡 주시'; levelClass = 'alert-watch'; }
      else { levelLabel = '🔴 확인보고'; levelClass = 'alert-check'; }

      const isCheck = a.grade === 'check';
      const hasFeedback = a.feedback && a.feedback.text;

      const feedbackSection = isCheck ? (hasFeedback ? `
        <div style="margin-top:8px;background:#f0fff4;border-radius:6px;padding:8px 10px;font-size:12px;color:#276749;">
          ✅ 피드백 완료: ${a.feedback.text}
          <span style="color:#a0aec0;margin-left:6px;">${a.feedback.submittedAt ? new Date(a.feedback.submittedAt.toDate()).toLocaleDateString('ko-KR') : ''}</span>
        </div>` : `
        <div style="margin-top:8px;">
          <button onclick="openFeedbackModal('${a.id}','${(a.clientName||'').replace(/'/g,"\\'")}')"
            style="width:100%;padding:9px;background:#e53e3e;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
            📝 사유 입력 필요
          </button>
        </div>`) : '';

      return `
        <div class="alert-item ${levelClass}">
          <div class="alert-left">
            <span class="alert-badge ${levelClass}">${levelLabel}</span>
            <span class="alert-name">${a.clientName}</span>
            <span style="font-size:11px;color:#718096;">${a.dailyAvgOrder}개</span>
          </div>
          <div class="alert-right">
            <span class="alert-days">${a.consecutiveDays||1}일째</span>
            <span class="alert-date">${a.lastOrderDate || ''}</span>
          </div>
          ${feedbackSection}
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
    const snap = await db.collection('directives').get();

    const allDirectives = [];
    snap.forEach(doc => allDirectives.push({ id: doc.id, ...doc.data() }));
    allDirectives.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    const items = [];
    allDirectives.slice(0, 20).forEach(d => {
      // 내 팀 해당 지시사항 필터
      if (d.targetTeams && d.targetTeams.length > 0) {
        if (!currentUser.teamId || !d.targetTeams.includes(currentUser.teamId)) return;
      }
      // 미완료 항목만
      const myCompletion = d.completions && d.completions[currentUser.uid];
      if (myCompletion && myCompletion.done) return;

      items.push(d);
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

window.showCumExplain = function(teamName, cumTotal, dailyAvg, bizDays, dailyAvgDiff, baseline) {
  const diffStr = dailyAvgDiff >= 0 ? `+${dailyAvgDiff}` : `${dailyAvgDiff}`;
  const diffColor = dailyAvgDiff >= 0 ? '#276749' : '#e53e3e';
  const msg = `
    <div style="font-size:15px;font-weight:800;margin-bottom:12px;">📊 ${teamName} 누적 현황</div>
    <div style="display:flex;flex-direction:column;gap:8px;font-size:14px;">
      <div>📅 이번달 영업일: <strong>${bizDays}일</strong></div>
      <div>📦 누적 판매수량: <strong>${cumTotal.toLocaleString()}개</strong></div>
      <div>📈 일평균 판매수량: <strong>${dailyAvg.toLocaleString()}개</strong></div>
      <div>🎯 기준 일평균: <strong>${baseline.toLocaleString()}개</strong></div>
      <div>📉 기준 대비: <strong style="color:${diffColor}">${diffStr}개/일</strong></div>
    </div>
    <div style="margin-top:12px;font-size:12px;color:#718096;border-top:1px solid #e2e8f0;padding-top:8px;">
      일평균 = 누적수량 ÷ 영업일수<br>
      ${cumTotal.toLocaleString()} ÷ ${bizDays}일 = ${dailyAvg.toLocaleString()}개/일
    </div>
  `;
  let modal = document.getElementById('cum-explain-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'cum-explain-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
    modal.onclick = (e) => { if(e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:24px;width:90%;max-width:340px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      ${msg}
      <button onclick="document.getElementById('cum-explain-modal').remove()" style="margin-top:16px;width:100%;padding:10px;background:var(--primary,#4A90D9);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">확인</button>
    </div>
  `;
};

// ───────────────────────────────────────────
// 영업 현장 기록 (field_visits)
// ───────────────────────────────────────────

let fvFiles = [];
let fvSelectedType = '';

function selectFvType(type) {
  fvSelectedType = type;
  document.getElementById('fv-type-new').style.background = type === 'new_sales' ? '#1a4731' : '#f7fafc';
  document.getElementById('fv-type-new').style.color = type === 'new_sales' ? '#fff' : '#718096';
  document.getElementById('fv-type-care').style.background = type === 'customer_care' ? '#1a4731' : '#f7fafc';
  document.getElementById('fv-type-care').style.color = type === 'customer_care' ? '#fff' : '#718096';
}

function openFieldVisitModal() {
  fvFiles = [];
  fvSelectedType = '';
  document.getElementById('fv-client').value = '';
  document.getElementById('fv-content').value = '';
  document.getElementById('fv-preview').innerHTML = '';
  document.getElementById('fv-msg').textContent = '';
  document.getElementById('fv-save-btn').disabled = false;
  document.getElementById('fv-save-btn').textContent = '저장하기';
  document.getElementById('fv-type-new').style.background = '#f7fafc';
  document.getElementById('fv-type-new').style.color = '#718096';
  document.getElementById('fv-type-care').style.background = '#f7fafc';
  document.getElementById('fv-type-care').style.color = '#718096';
  const modal = document.getElementById('fieldVisitModal');
  modal.style.display = 'flex';
}

function closeFieldVisitModal() {
  document.getElementById('fieldVisitModal').style.display = 'none';
}

function onFvFileChange(input) {
  Array.from(input.files).forEach(file => {
    if (fvFiles.length >= 5) return;
    fvFiles.push(file);
    const reader = new FileReader();
    reader.onload = e => {
      const img = document.createElement('img');
      img.src = e.target.result;
      img.style.cssText = 'width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;';
      document.getElementById('fv-preview').appendChild(img);
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

async function checkNewSalesMatch(clientName) {
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/1-cw2uOlbPyA8vjSrs5O6SyRBl9bgiMSfb5lQPQ6F9DM/export?format=csv&gid=1000247276';
  try {
    const res = await fetch(CSV_URL);
    const text = await res.text();
    const rows = text.split('\n').map(r => r.split(','));
    const normalized = clientName.replace(/\s/g, '');
    return rows.some(row => row[1] && row[1].replace(/\s/g, '').replace(/"/g, '') === normalized);
  } catch (e) {
    console.warn('신규영업 시트 조회 실패:', e);
    return false;
  }
}

function fvTypeBadge(v) {
  if (v.visitType === 'new_sales') {
    return v.isNewSalesConfirmed
      ? `<span style="font-size:10px;background:#3182ce;color:#fff;padding:1px 6px;border-radius:10px;font-weight:700;">신규✓</span>`
      : `<span style="font-size:10px;background:#63b3ed;color:#fff;padding:1px 6px;border-radius:10px;font-weight:700;">신규</span>`;
  }
  if (v.visitType === 'customer_care') {
    return `<span style="font-size:10px;background:#38a169;color:#fff;padding:1px 6px;border-radius:10px;font-weight:700;">관리</span>`;
  }
  return '';
}

async function saveFieldVisit() {
  const clientName = document.getElementById('fv-client').value.trim();
  const content = document.getElementById('fv-content').value.trim();
  const msg = document.getElementById('fv-msg');
  const btn = document.getElementById('fv-save-btn');

  if (!fvSelectedType) { msg.style.color = '#e53e3e'; msg.textContent = '방문 유형을 선택해주세요.'; return; }
  if (!clientName) { msg.style.color = '#e53e3e'; msg.textContent = '거래처명을 입력하세요.'; return; }
  if (!content) { msg.style.color = '#e53e3e'; msg.textContent = '방문 내용을 입력하세요.'; return; }

  btn.disabled = true;
  btn.textContent = '저장 중...';
  msg.style.color = '#718096';
  msg.textContent = '';

  try {
    const ym = getCurrentYearMonth();
    const photoUrls = [];

    if (fvFiles.length > 0) {
      // storage가 null이면 재초기화 시도
      if (!storage) {
        try {
          storage = firebase.storage();
          console.log('Storage 재초기화 성공');
        } catch (initErr) {
          console.error('Storage 재초기화 실패:', initErr);
        }
      }
      if (!storage) {
        msg.style.color = '#e53e3e';
        msg.textContent = '⚠️ 사진 업로드 실패 - Storage를 초기화할 수 없습니다. 사진 없이 저장합니다.';
        await new Promise(r => setTimeout(r, 1500));
        msg.textContent = '';
      } else {
        for (const file of fvFiles) {
          try {
            const ts = Date.now();
            const ref = storage.ref(`field_visits/${ym}/${currentUser.uid}/${ts}_${file.name}`);
            await ref.put(file);
            const url = await ref.getDownloadURL();
            photoUrls.push(url);
          } catch (uploadErr) {
            console.error('사진 업로드 실패:', uploadErr);
            let errMsg = uploadErr.message || '';
            let reason = '';
            if (uploadErr.code === 'storage/unauthorized' || errMsg.includes('403')) {
              reason = '권한 오류 (Storage 규칙 확인 필요)';
            } else if (errMsg.includes('CORS') || errMsg.includes('cors') || errMsg.includes('NetworkError') || errMsg.includes('Failed to fetch')) {
              reason = 'CORS 오류 (네트워크/방화벽 문제)';
            } else if (uploadErr.code === 'storage/canceled') {
              reason = '업로드 취소됨';
            } else if (uploadErr.code === 'storage/quota-exceeded') {
              reason = 'Storage 용량 초과';
            } else {
              reason = errMsg;
            }
            msg.style.color = '#e53e3e';
            msg.textContent = `⚠️ 사진 업로드 실패 (${file.name}): ${reason}. 사진 없이 저장합니다.`;
            await new Promise(r => setTimeout(r, 2000));
            msg.textContent = '';
          }
        }
      }
    }

    let isNewSalesConfirmed = false;
    if (fvSelectedType === 'new_sales') {
      msg.textContent = '신규업체 목록 확인 중...';
      isNewSalesConfirmed = await checkNewSalesMatch(clientName);
    }

    await db.collection('field_visits').add({
      driverId: currentUser.uid,
      driverName: currentUser.name,
      teamId: currentUser.teamId || '',
      teamName: myTeam ? myTeam.name : '',
      clientName,
      content,
      photoUrls,
      visitType: fvSelectedType,
      isNewSalesConfirmed,
      yearMonth: ym,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    if (fvSelectedType === 'new_sales') {
      msg.style.color = isNewSalesConfirmed ? '#276749' : '#e53e3e';
      msg.textContent = isNewSalesConfirmed ? '✅ 저장 완료! 신규영업 인정' : '✅ 저장 완료! ⚠️ 신규업체 목록 미등록';
    } else {
      msg.style.color = '#276749';
      msg.textContent = '✅ 저장 완료!';
    }
    setTimeout(() => {
      closeFieldVisitModal();
      loadFieldVisits();
    }, 1400);
  } catch (e) {
    console.error('현장기록 저장 실패:', e);
    msg.style.color = '#e53e3e';
    msg.textContent = '❌ 저장 실패: ' + e.message;
    btn.disabled = false;
    btn.textContent = '저장하기';
  }
}

async function loadFieldVisits() {
  const container = document.getElementById('fieldVisitList');
  if (!container) return;
  container.innerHTML = '<div class="empty-msg">로딩 중...</div>';

  try {
    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'manager';
    const teamId = currentUser.teamId || '';
    let snap;

    if (isAdmin) {
      // 관리자/매니저: teamId 필터만 사용 (orderBy 없음 → 복합 인덱스 불필요)
      if (teamId) {
        snap = await db.collection('field_visits')
          .where('teamId', '==', teamId)
          .limit(50)
          .get();
      } else {
        // teamId 없는 최고관리자: 최근 50건
        snap = await db.collection('field_visits')
          .limit(50)
          .get();
      }
    } else {
      // 기사: driverId 필터만 사용 (orderBy 없음 → 복합 인덱스 불필요)
      snap = await db.collection('field_visits')
        .where('driverId', '==', currentUser.uid)
        .limit(20)
        .get();
    }

    if (snap.empty) {
      container.innerHTML = '<div class="empty-msg">아직 기록이 없습니다.</div>';
      return;
    }

    const items = [];
    snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
    // 클라이언트에서 createdAt 내림차순 정렬
    items.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    container.innerHTML = items.map(v => {
      const dt = v.createdAt ? v.createdAt.toDate().toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '-';
      const isMe = v.driverId === currentUser.uid;
      const preview = v.content.length > 40 ? v.content.slice(0, 40) + '…' : v.content;
      const badge = fvTypeBadge(v);
      const thumb = v.photoUrls && v.photoUrls.length > 0
        ? `<img src="${v.photoUrls[0]}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;flex-shrink:0;" onclick="showFieldVisitDetail(${JSON.stringify(v).replace(/"/g, '&quot;')})">`
        : '';
      const commentBadge = v.adminComment ? `<span style="font-size:11px;">💬</span>` : '';
      return `
        <div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid #f0f0f0;cursor:pointer;" onclick="showFieldVisitDetail(${JSON.stringify(v).replace(/"/g, '&quot;')})">
          ${thumb}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;flex-wrap:wrap;">
              <span style="font-size:12px;color:#718096;">${dt}</span>
              <span style="font-size:12px;font-weight:700;color:${isMe ? '#1a4731' : '#4a5568'}">${v.driverName}${isMe ? ' (나)' : ''}</span>
              <span style="font-size:11px;background:#f0fff4;color:#276749;padding:1px 6px;border-radius:10px;">${v.clientName}</span>
              ${badge}
              ${commentBadge}
            </div>
            <div style="font-size:13px;color:#4a5568;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${preview}</div>
            ${v.photoUrls && v.photoUrls.length > 0 ? `<div style="font-size:11px;color:#a0aec0;margin-top:2px;">📷 ${v.photoUrls.length}장</div>` : ''}
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    console.error('현장기록 로드 실패:', e);
    container.innerHTML = '<div class="card-error">로드 실패: ' + e.message + '</div>';
  }
}

window.showFieldVisitDetail = function(v) {
  if (typeof v === 'string') v = JSON.parse(v);
  const dt = v.createdAt && v.createdAt.toDate
    ? v.createdAt.toDate().toLocaleString('ko-KR')
    : '-';
  const photos = (v.photoUrls || []).map(url =>
    `<img src="${url}" style="width:100%;border-radius:10px;margin-bottom:8px;">`
  ).join('');
  const badge = fvTypeBadge(v);

  let modal = document.getElementById('fv-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'fv-detail-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:20px;width:100%;max-width:380px;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-size:15px;font-weight:800;">&#128247; 현장 기록</div>
        <button onclick="document.getElementById('fv-detail-modal').remove()" style="background:none;border:none;font-size:20px;color:#718096;cursor:pointer;">✕</button>
      </div>
      <div style="font-size:12px;color:#718096;margin-bottom:4px;">${dt}</div>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
        <span style="font-size:13px;font-weight:700;color:#1a4731;">${v.driverName} · ${v.teamName || ''}</span>
        ${badge}
      </div>
      <div style="font-size:13px;background:#f0fff4;color:#276749;display:inline-block;padding:2px 10px;border-radius:10px;margin-bottom:12px;">${v.clientName}</div>
      <div style="font-size:14px;color:#2d3748;white-space:pre-wrap;margin-bottom:14px;">${v.content}</div>
      ${photos}
      ${v.adminComment ? `<div style="background:#f0fff4;border:1px solid #c6f6d5;border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:13px;color:#276749;"><strong>📌 관리자 메모:</strong> ${v.adminComment}</div>` : ''}
      <button onclick="document.getElementById('fv-detail-modal').remove()" style="width:100%;padding:10px;background:#1a4731;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">닫기</button>
    </div>`;
};

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

// ══════════════════════════════════════════════════════
// 판매수량 입력 기능
// ══════════════════════════════════════════════════════
const SALES_MENUS = ['뜨끈','프리미엄','샐러드','일품','덮밥','샌드(단)','샌드(세)','유부'];
const MENU_KEYS   = ['dduk','premium','salad','ilpoom','deopbap','sand_dan','sand_se','ubu'];

// 현재 시간대 상태 판별 (KST 기준)
function getSalesTimeStatus() {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const h = kst.getHours(), m = kst.getMinutes();
  const mins = h * 60 + m;
  // 0~780(13:00): 입력 가능
  if (mins < 13 * 60) return { status: 'open', label: '⏰ 13:00까지 입력해주세요', canEdit: true };
  // 13:00 이후: 마감
  return { status: 'closed', label: '🔒 오늘 입력이 마감되었습니다', canEdit: false };
}

function getTodayKST() {
  return new Date().toLocaleDateString('ko-KR', { timeZone:'Asia/Seoul', year:'numeric', month:'2-digit', day:'2-digit' })
    .replace(/\. /g,'-').replace('.',''). trim();
}

function getTodayKey() {
  const d = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Seoul'}));
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

window._driverSalesData = null; // 현재 내 저장 데이터

window.loadSalesTab = async function() {
  const today = getTodayKey();
  const ts = getSalesTimeStatus();
  const user = currentUser;
  if (!user) return;

  // 상태 배지
  const badge = document.getElementById('salesStatusBadge');
  const dateLabel = document.getElementById('salesDateLabel');
  if (badge) {
    badge.textContent = ts.label;
    badge.style.background = ts.canEdit ? '#e6fffa' : '#fff5f5';
    badge.style.color = ts.canEdit ? '#276749' : '#c53030';
  }
  if (dateLabel) dateLabel.textContent = today;

  // 내 데이터 로드
  const docId = `${today}_${user.uid}`;
  const doc = await db.collection('driver_sales').doc(docId).get();
  window._driverSalesData = doc.exists ? doc.data() : null;
  const qty = window._driverSalesData ? window._driverSalesData.quantities : {};

  // 입력 폼 렌더
  const area = document.getElementById('salesInputArea');
  const isAdmin = user.role === 'admin' || user.role === 'manager';
  // admin/manager: 시간 무관 항상 수정 가능 / driver: 13:00 이전이면 수정 가능
  const canEdit = isAdmin ? true : ts.canEdit;
  const lockedByTime = !isAdmin && !ts.canEdit;

  const rows = SALES_MENUS.map((menu, i) => {
    const key = MENU_KEYS[i];
    const val = qty[key] !== undefined ? qty[key] : '';
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f0f0f0;">
        <span style="font-size:14px;font-weight:600;color:#2d3748;width:80px;">${menu}</span>
        <input type="number" id="sq_${key}" value="${val}" min="0"
          ${canEdit ? '' : 'disabled'}
          style="width:100px;padding:8px 12px;border:1px solid ${canEdit?'#cbd5e0':'#e2e8f0'};border-radius:8px;font-size:15px;text-align:center;font-family:inherit;background:${canEdit?'#fff':'#f7fafc'};">
        <span style="font-size:12px;color:#a0aec0;width:20px;">개</span>
      </div>`;
  }).join('');

  const total = Object.values(qty).reduce((s,v)=>s+(v||0),0);

  area.innerHTML = `
    <div style="margin-bottom:4px;">${rows}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;font-size:15px;font-weight:700;color:#1a4731;">
      <span>합계</span>
      <span id="salesTotalDisplay">${total}개</span>
    </div>
    ${lockedByTime ? `<div style="text-align:center;padding:10px;background:#fff5f5;border-radius:8px;color:#c53030;font-size:13px;font-weight:600;">🔒 수정 마감시간(13:00)이 지났습니다</div>` : ''}
    ${canEdit ? `<button onclick="saveSalesInput()" style="width:100%;padding:13px;background:#1a4731;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;">저장하기</button>` : ''}
    <div id="salesSaveMsg" style="text-align:center;margin-top:8px;font-size:13px;"></div>
  `;

  // 합계 실시간 계산
  MENU_KEYS.forEach(key => {
    const el = document.getElementById(`sq_${key}`);
    if (el) el.addEventListener('input', updateSalesTotal);
  });

  // 팀별 현황 로드
  await loadSalesTeamSummary(today);
};

function updateSalesTotal() {
  let total = 0;
  MENU_KEYS.forEach(key => {
    const el = document.getElementById(`sq_${key}`);
    if (el) total += Number(el.value) || 0;
  });
  const el = document.getElementById('salesTotalDisplay');
  if (el) el.textContent = total + '개';
}

window.saveSalesInput = async function() {
  const user = currentUser;
  if (!user) return;
  const today = getTodayKey();
  const btn = document.querySelector('#salesInputArea button');
  const msgEl = document.getElementById('salesSaveMsg');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

  try {
    const quantities = {};
    let total = 0;
    MENU_KEYS.forEach(key => {
      const v = Number(document.getElementById(`sq_${key}`)?.value) || 0;
      quantities[key] = v;
      total += v;
    });

    const docId = `${today}_${user.uid}`;
    await db.collection('driver_sales').doc(docId).set({
      date: today, driverId: user.uid, driverName: user.name,
      teamId: user.teamId || '', quantities, total,
      savedAt: window._driverSalesData ? window._driverSalesData.savedAt : firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    window._driverSalesData = { quantities, total };
    if (msgEl) { msgEl.style.color='#276749'; msgEl.textContent='✅ 저장 완료!'; setTimeout(()=>msgEl.textContent='',3000); }
    updateSalesTotal();
    await loadSalesTeamSummary(today);
  } catch(e) {
    if (msgEl) { msgEl.style.color='#c53030'; msgEl.textContent='❌ 저장 실패: '+e.message; }
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='저장하기'; }
  }
};

// 팀별 현황
async function loadSalesTeamSummary(today) {
  const container = document.getElementById('salesTeamSummary');
  if (!container) return;

  try {
    const [salesSnap, usersSnap] = await Promise.all([
      db.collection('driver_sales').where('date','==',today).get(),
      db.collection('users').where('active','!=',false).get()
    ]);

    const salesMap = {}; // uid → data
    salesSnap.forEach(d => { salesMap[d.data().driverId] = d.data(); });

    // 팀 구성
    const TEAM_NAMES = {
      team1:'1팀 준고', team2:'2팀 해운대', team3:'3팀 공오일(051)',
      team4:'4팀 연수남', team5:'5팀 아가리', team6:'6팀 도세마', team7:'7팀 강서영'
    };
    const teams = {};
    Object.keys(TEAM_NAMES).forEach(tid => { teams[tid] = { name: TEAM_NAMES[tid], drivers: [] }; });

    usersSnap.forEach(doc => {
      const u = doc.data();
      if (u.role !== 'driver' && u.role !== 'leader') return;
      if (!teams[u.teamId]) return;
      const s = salesMap[doc.id];
      teams[u.teamId].drivers.push({ name: u.name, total: s ? s.total : null });
    });

    const html = Object.entries(teams).map(([tid, team]) => {
      const teamTotal = team.drivers.reduce((s,d)=>s+(d.total||0),0);
      const allDone = team.drivers.length > 0 && team.drivers.every(d=>d.total !== null);
      const statusIcon = allDone ? '✅' : '⏳';
      const driverHtml = team.drivers.map(d =>
        `<span style="font-size:12px;color:${d.total!==null?'#2d3748':'#a0aec0'};">
          ${d.name} <b>${d.total!==null?d.total+'개':'-'}</b>
        </span>`
      ).join('<span style="color:#e2e8f0;margin:0 4px;">|</span>');

      return `
        <div style="padding:12px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:13px;font-weight:700;color:#2d3748;">${team.name}</span>
            <span style="font-size:13px;font-weight:700;color:#1a4731;">${statusIcon} ${allDone?teamTotal+'개':'미입력 있음'}</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">${driverHtml}</div>
        </div>`;
    }).join('');

    const grandTotal = Object.values(teams).reduce((s,t)=>s+t.drivers.reduce((ss,d)=>ss+(d.total||0),0),0);
    container.innerHTML = html + `<div style="text-align:right;font-size:14px;font-weight:700;color:#1a4731;margin-top:8px;">전체 합계: ${grandTotal}개</div>`;
  } catch(e) {
    container.innerHTML = '<div class="empty-msg">로드 실패</div>';
  }
}

// 날짜별 내 수량 조회
window.querySalesByDate = async function() {
  const dateVal = document.getElementById('salesQueryDate').value;
  const resultEl = document.getElementById('salesQueryResult');
  if (!dateVal) { resultEl.innerHTML = '<div style="color:#c53030;font-size:13px;">날짜를 선택해주세요.</div>'; return; }
  const user = currentUser;
  if (!user) return;
  resultEl.innerHTML = '<div style="color:#718096;font-size:13px;">조회 중...</div>';
  try {
    const docId = `${dateVal}_${user.uid}`;
    const doc = await db.collection('driver_sales').doc(docId).get();
    if (!doc.exists) {
      resultEl.innerHTML = `<div style="color:#a0aec0;font-size:13px;">${dateVal} 입력 데이터 없음</div>`;
      return;
    }
    const d = doc.data();
    const qty = d.quantities || {};
    const rows = SALES_MENUS.map((menu, i) => {
      const key = MENU_KEYS[i];
      const v = qty[key] || 0;
      return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px;">
        <span style="color:#2d3748;">${menu}</span>
        <span style="font-weight:700;color:#1a4731;">${v}개</span>
      </div>`;
    }).join('');
    resultEl.innerHTML = `
      <div style="font-size:12px;color:#718096;margin-bottom:8px;">${dateVal} 수량</div>
      ${rows}
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;font-weight:700;color:#1a4731;border-top:2px solid #e2e8f0;margin-top:4px;">
        <span>합계</span><span>${d.total || 0}개</span>
      </div>`;
  } catch(e) {
    resultEl.innerHTML = `<div style="color:#c53030;font-size:13px;">조회 실패: ${e.message}</div>`;
  }
};

// 기간별 내 수량 조회
window.querySalesByRange = async function() {
  const startVal = document.getElementById('salesRangeStart').value;
  const endVal   = document.getElementById('salesRangeEnd').value;
  const resultEl = document.getElementById('salesRangeResult');
  if (!startVal || !endVal) { resultEl.innerHTML = '<div style="color:#c53030;font-size:13px;">시작일과 종료일을 선택해주세요.</div>'; return; }
  if (startVal > endVal) { resultEl.innerHTML = '<div style="color:#c53030;font-size:13px;">시작일이 종료일보다 늦습니다.</div>'; return; }
  const user = currentUser;
  if (!user) return;
  resultEl.innerHTML = '<div style="color:#718096;font-size:13px;">조회 중...</div>';
  try {
    const snap = await db.collection('driver_sales')
      .where('driverId', '==', user.uid)
      .where('date', '>=', startVal)
      .where('date', '<=', endVal)
      .orderBy('date', 'asc')
      .get();
    if (snap.empty) {
      resultEl.innerHTML = `<div style="color:#a0aec0;font-size:13px;">${startVal} ~ ${endVal} 데이터 없음</div>`;
      return;
    }
    let grandTotal = 0;
    const rows = [];
    snap.forEach(doc => {
      const d = doc.data();
      grandTotal += d.total || 0;
      rows.push(`<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:13px;">
        <span style="color:#2d3748;">${d.date}</span>
        <span style="font-weight:700;color:#1a4731;">${d.total || 0}개</span>
      </div>`);
    });
    resultEl.innerHTML = `
      <div style="font-size:12px;color:#718096;margin-bottom:8px;">${startVal} ~ ${endVal} (${rows.length}일)</div>
      ${rows.join('')}
      <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;font-weight:700;color:#1a4731;border-top:2px solid #e2e8f0;margin-top:4px;">
        <span>기간 합계</span><span>${grandTotal}개</span>
      </div>`;
  } catch(e) {
    resultEl.innerHTML = `<div style="color:#c53030;font-size:13px;">조회 실패: ${e.message}</div>`;
  }
};

// 판매수량 탭 전환 시 자동 로드
const _origShowTab = window.showTab || function(){};
window.showTab = function(tabName) {
  _origShowTab(tabName);
  if (tabName === 'sales') loadSalesTab();
};

// ── 확인보고 카드 (기사 대시보드 홈) ──
const COURSE_DRIVER_ALERT = {
  '코스1':'표창훈','코스2':'이근일','코스3':'김민기','코스4':'오철석',
  '코스5':'이진우','코스6':'박인수','코스7':'안준수','코스8':'최용혁',
  '코스9':'유상하','코스10':'금정','코스11':'이호주','코스12':'김창연',
  '코스13':'이창목','코스14':'김동완','코스15':'전태영','코스16':'김종호',
  '코스17':'류대현','코스18':'최준은','코스19':'조홍철'
};

async function loadAlertReport() {
  const card = document.getElementById('alertReportCard');
  if (!card) return;
  if (!currentUser || currentUser.role === 'admin') return;

  try {
    // 이 기사 담당 코스 찾기
    const myName = currentUser.name;
    const myCourses = Object.entries(COURSE_DRIVER_ALERT)
      .filter(([c,d]) => d === myName).map(([c]) => c);

    let snap;
    if (myCourses.length > 0) {
      // 담당 코스 기준으로 미답변 즉시경보 조회
      snap = await db.collection('alerts')
        .where('resolved','==',false)
        .where('grade','==','urgent')
        .get();
    } else {
      // 코스 없으면 팀 기준
      snap = await db.collection('alerts')
        .where('teamId','==',currentUser.teamId)
        .where('resolved','==',false)
        .where('grade','==','urgent')
        .get();
    }

    const myAlerts = [];
    snap.forEach(d => {
      const a = { id: d.id, ...d.data() };
      if (a.actionStatus === 'done') return;
      // 내 코스 경보만 필터
      if (myCourses.length > 0 && !myCourses.includes(a.courseId)) return;
      myAlerts.push(a);
    });

    if (!myAlerts.length) { card.style.display = 'none'; return; }

    card.style.display = 'block';
    document.getElementById('alertReportBadge').textContent = myAlerts.length + '건';

    const list = document.getElementById('alertReportList');
    list.innerHTML = myAlerts.map(a => `
      <div style="background:#fff;border-radius:8px;padding:12px;margin-bottom:10px;border:1px solid #fed7d7;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:14px;font-weight:700;color:#2d3748;">${a.clientName}</div>
          <span style="font-size:11px;color:#c53030;font-weight:600;">${a.consecutiveDays}일째 미주문 · 일평균 ${a.dailyAvgOrder}개</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button onclick="submitAlertAction('${a.id}','contacted')" style="padding:6px 10px;background:#ebf8ff;color:#2b6cb0;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">📞 연락완료</button>
          <button onclick="submitAlertAction('${a.id}','closed')" style="padding:6px 10px;background:#fff5f5;color:#c53030;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">🚫 폐업</button>
          <button onclick="submitAlertAction('${a.id}','holiday')" style="padding:6px 10px;background:#fffff0;color:#975a16;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">🏖️ 일시휴무</button>
          <button onclick="submitAlertAction('${a.id}','scheduled')" style="padding:6px 10px;background:#f0fff4;color:#276749;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">📅 주문예정</button>
          <button onclick="submitAlertActionEtc('${a.id}')" style="padding:6px 10px;background:#f7fafc;color:#4a5568;border:none;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;">📝 기타</button>
        </div>
        <div id="action-result-${a.id}" style="font-size:12px;margin-top:6px;color:#38a169;display:none;"></div>
      </div>
    `).join('');
  } catch(e) {
    console.warn('확인보고 로드 실패:', e.message);
  }
}

async function submitAlertAction(alertId, result) {
  const resultLabels = { contacted:'연락완료', closed:'폐업', holiday:'일시휴무', scheduled:'주문예정' };
  try {
    await db.collection('alerts').doc(alertId).update({
      actionStatus: 'done',
      actionResult: result,
      actionAt: firebase.firestore.FieldValue.serverTimestamp(),
      actionBy: currentUser.uid || currentUser.name
    });
    const el = document.getElementById('action-result-'+alertId);
    if (el) { el.textContent = `✅ ${resultLabels[result]} 처리됨`; el.style.display='block'; }
    // 카드 버튼 비활성화
    const btns = el?.closest('[style*="border:1px solid"]')?.querySelectorAll('button');
    btns?.forEach(b => { b.disabled=true; b.style.opacity='0.5'; });
    setTimeout(() => loadAlertReport(), 1500);
  } catch(e) {
    alert('저장 실패: ' + e.message);
  }
}

async function submitAlertActionEtc(alertId) {
  const memo = prompt('처리 내용을 입력해주세요:');
  if (!memo) return;
  try {
    await db.collection('alerts').doc(alertId).update({
      actionStatus: 'done',
      actionResult: 'etc',
      actionMemo: memo,
      actionAt: firebase.firestore.FieldValue.serverTimestamp(),
      actionBy: currentUser.uid || currentUser.name
    });
    const el = document.getElementById('action-result-'+alertId);
    if (el) { el.textContent = `✅ 기타: ${memo}`; el.style.display='block'; }
    setTimeout(() => loadAlertReport(), 1500);
  } catch(e) {
    alert('저장 실패: ' + e.message);
  }
}
