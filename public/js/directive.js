// directive.js - 지시사항 화면

let directiveUser = null;
let allTeamsList = [];

async function initDirective() {
  directiveUser = requireAuth([]);
  if (!directiveUser) return;

  document.getElementById('dUserName').textContent = directiveUser.name;

  // 팀 목록 로드
  const teamsSnap = await db.collection('teams').get();
  allTeamsList = [];
  teamsSnap.forEach(doc => allTeamsList.push({ id: doc.id, ...doc.data() }));

  const isAdmin = directiveUser.role === 'admin' || directiveUser.role === 'manager';

  if (isAdmin) {
    // 관리자 화면
    document.getElementById('adminSection').style.display = 'block';
    document.getElementById('driverSection').style.display = 'none';
    renderTeamCheckboxes();
    await loadAdminDirectiveList();
  } else {
    // 기사 화면
    document.getElementById('adminSection').style.display = 'none';
    document.getElementById('driverSection').style.display = 'block';
    await loadDriverDirectives();
  }
}

// 관리자: 대상팀 체크박스 렌더링
function renderTeamCheckboxes() {
  const container = document.getElementById('targetTeamsArea');
  const html = allTeamsList.map(t => `
    <label class="team-check-label">
      <input type="checkbox" class="team-cb" value="${t.id}" name="targetTeam">
      <span>${t.name}</span>
    </label>
  `).join('');

  container.innerHTML = `
    <label class="team-check-label all-check">
      <input type="checkbox" id="allTeamsCheck" onchange="toggleAllTeams(this)">
      <span style="font-weight:700">전체 팀</span>
    </label>
    ${html}
  `;
}

function toggleAllTeams(allCb) {
  document.querySelectorAll('.team-cb').forEach(cb => {
    cb.checked = allCb.checked;
    cb.disabled = allCb.checked;
  });
}

// 관리자: 지시사항 등록
async function submitDirective() {
  const content = document.getElementById('directiveContent').value.trim();
  const deadlineVal = document.getElementById('directiveDeadline').value;

  if (!content) {
    alert('지시사항 내용을 입력해주세요.');
    return;
  }

  const allChecked = document.getElementById('allTeamsCheck').checked;
  const selectedTeams = allChecked
    ? []
    : Array.from(document.querySelectorAll('.team-cb:checked')).map(cb => cb.value);

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = '등록 중...';

  try {
    const data = {
      targetTeams: selectedTeams,
      content: content,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      completions: {}
    };

    if (deadlineVal) {
      data.deadline = firebase.firestore.Timestamp.fromDate(new Date(deadlineVal));
    }

    await db.collection('directives').add(data);

    // 폼 초기화
    document.getElementById('directiveContent').value = '';
    document.getElementById('directiveDeadline').value = '';
    document.querySelectorAll('.team-cb').forEach(cb => { cb.checked = false; cb.disabled = false; });
    document.getElementById('allTeamsCheck').checked = false;

    alert('지시사항이 등록되었습니다.');
    await loadAdminDirectiveList();

  } catch (e) {
    console.error('등록 실패:', e);
    alert('등록에 실패했습니다: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '등록';
  }
}

// 관리자: 지시사항 목록
async function loadAdminDirectiveList() {
  const container = document.getElementById('adminDirectiveList');
  container.innerHTML = '<div class="empty-msg">로딩 중...</div>';

  try {
    const snap = await db.collection('directives').get();

    if (snap.empty) {
      container.innerHTML = '<div class="empty-msg">등록된 지시사항이 없습니다.</div>';
      return;
    }

    // 팀 ID → 이름 맵
    const teamNameMap = {};
    allTeamsList.forEach(t => { teamNameMap[t.id] = t.name; });

    // 사용자 수 (팀별) - 전체 컬렉션 가져온 후 클라이언트에서 필터
    const usersSnap = await db.collection('users').get();
    const teamUserCount = {};
    usersSnap.forEach(doc => {
      const d = doc.data();
      if (d.active !== false && d.teamId) {
        teamUserCount[d.teamId] = (teamUserCount[d.teamId] || 0) + 1;
      }
    });

    const html = [];
    const allDocs = [];
    snap.forEach(doc => allDocs.push({ _id: doc.id, ...doc.data() }));
    allDocs.sort((a, b) => {
      const ta = a.createdAt ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });
    allDocs.slice(0, 30).forEach(d => {
      const docId = d._id;
      const targetNames = d.targetTeams && d.targetTeams.length > 0
        ? d.targetTeams.map(id => teamNameMap[id] || id).join(', ')
        : '전체 팀';

      const createdAt = d.createdAt ? d.createdAt.toDate().toLocaleDateString('ko-KR') : '-';
      const deadline = d.deadline ? d.deadline.toDate().toLocaleDateString('ko-KR') : '없음';

      // 완료율 계산
      const completions = d.completions || {};
      const doneCount = Object.values(completions).filter(c => c.done).length;
      const targetTeamIds = d.targetTeams && d.targetTeams.length > 0
        ? d.targetTeams
        : allTeamsList.map(t => t.id);
      const totalUsers = targetTeamIds.reduce((sum, tid) => sum + (teamUserCount[tid] || 0), 0);
      const pct = totalUsers > 0 ? Math.round((doneCount / totalUsers) * 100) : 0;
      const barColor = pct >= 80 ? '#38a169' : pct >= 50 ? '#ecc94b' : '#fc8181';

      html.push(`
        <div class="directive-admin-item">
          <div class="dir-admin-header">
            <span class="dir-target-badge">${targetNames}</span>
            <div class="dir-admin-meta">
              <span class="dir-date">${createdAt}</span>
              <button class="btn-delete-dir" onclick="deleteDirective('${docId}')">삭제</button>
            </div>
          </div>
          <div class="dir-content-text">${d.content}</div>
          <div class="dir-admin-footer">
            <span class="dir-deadline-label">마감: ${deadline}</span>
            <div class="dir-progress-wrap">
              <div class="dir-progress-bg">
                <div class="dir-progress-fill" style="width:${pct}%;background:${barColor}"></div>
              </div>
              <span class="dir-progress-pct" style="color:${barColor}">${pct}% (${doneCount}/${totalUsers})</span>
            </div>
          </div>
        </div>
      `);
    });

    container.innerHTML = html.join('');

  } catch (e) {
    console.error('목록 로드 실패:', e);
    container.innerHTML = '<div class="card-error">목록을 불러오지 못했습니다.</div>';
  }
}

// 지시사항 삭제
async function deleteDirective(directiveId) {
  if (!confirm('이 지시사항을 삭제하시겠습니까?')) return;
  try {
    await db.collection('directives').doc(directiveId).delete();
    await loadAdminDirectiveList();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
}

// 기사: 지시사항 목록
async function loadDriverDirectives() {
  const container = document.getElementById('driverDirectiveList');
  container.innerHTML = '<div class="empty-msg">로딩 중...</div>';

  try {
    const snap = await db.collection('directives').get();

    const items = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.targetTeams && d.targetTeams.length > 0) {
        if (!directiveUser.teamId || !d.targetTeams.includes(directiveUser.teamId)) return;
      }
      items.push({ id: doc.id, ...d });
    });

    if (!items.length) {
      container.innerHTML = '<div class="empty-msg">지시사항이 없습니다.</div>';
      return;
    }

    const now = new Date();

    // 미완료 / 완료 분리 (완료는 최근 3건만)
    const undone = items.filter(d => {
      const myComp = d.completions && d.completions[directiveUser.uid];
      return !(myComp && myComp.done);
    });
    const done3 = items
      .filter(d => {
        const myComp = d.completions && d.completions[directiveUser.uid];
        return myComp && myComp.done;
      })
      .sort((a, b) => {
        const tA = a.completions[directiveUser.uid].doneAt?.toMillis?.() || 0;
        const tB = b.completions[directiveUser.uid].doneAt?.toMillis?.() || 0;
        return tB - tA;
      })
      .slice(0, 3);

    const renderItem = d => {
      const myComp = d.completions && d.completions[directiveUser.uid];
      const done = myComp && myComp.done;
      const deadline = d.deadline ? d.deadline.toDate().toLocaleDateString('ko-KR') : '없음';
      const isOverdue = d.deadline && d.deadline.toDate() < now && !done;
      const doneAt = done && myComp.doneAt ? myComp.doneAt.toDate().toLocaleDateString('ko-KR') : '';
      const comment = done && myComp.comment ? myComp.comment : '';

      return `
        <div class="driver-directive-item ${done ? 'done' : ''}" id="drdir-${d.id}">
          <label class="directive-check-wrap" ${done ? `onclick="toggleDoneDetail('${d.id}'); return false;"` : ''}>
            <input type="checkbox" class="directive-cb" ${done ? 'checked disabled' : ''}
              onchange="driverComplete('${d.id}', this)">
            <span class="directive-content-text ${done ? 'strikethrough' : ''}">${d.content}</span>
            ${done ? `<span style="margin-left:6px;font-size:12px;color:#718096;">▼</span>` : ''}
          </label>
          <div class="driver-dir-meta">
            <span class="deadline-label ${isOverdue ? 'overdue' : ''}">마감: ${deadline}</span>
            ${done ? `<span class="done-label">✓ 완료</span>` : ''}
          </div>
          ${done ? `
          <div class="done-detail" id="done-detail-${d.id}" style="display:none;margin-top:8px;padding:10px 12px;background:#f0fff4;border-radius:8px;border-left:3px solid #38a169;">
            <div style="font-size:12px;color:#276749;font-weight:600;margin-bottom:4px;">✅ 완료 내역</div>
            <div style="font-size:13px;color:#2d3748;margin-bottom:4px;"><b>지시사항:</b> ${d.content}</div>
            ${comment ? `<div style="font-size:13px;color:#2d3748;margin-bottom:4px;"><b>완료 코멘트:</b> ${comment}</div>` : '<div style="font-size:12px;color:#a0aec0;">코멘트 없음</div>'}
            ${doneAt ? `<div style="font-size:12px;color:#718096;margin-top:4px;">완료일: ${doneAt}</div>` : ''}
          </div>
          ` : `
          <div class="comment-area" id="comment-area-${d.id}" style="display:none">
            <input type="text" class="comment-input" id="comment-${d.id}" placeholder="완료 코멘트 (선택)">
            <button class="btn-confirm-done" onclick="confirmDone('${d.id}')">완료 확인</button>
          </div>
          `}
        </div>
      `;
    };

    let html = undone.map(renderItem).join('');

    if (done3.length > 0) {
      html += `
        <div style="margin-top:16px;padding-top:12px;border-top:1px dashed #e2e8f0;">
          <div style="font-size:12px;font-weight:600;color:#718096;margin-bottom:8px;">📋 완료한 지시사항 (최근 ${done3.length}건) — 클릭하면 내용 확인</div>
          ${done3.map(renderItem).join('')}
        </div>
      `;
    }

    container.innerHTML = html;

  } catch (e) {
    console.error('기사 지시사항 로드 실패:', e);
    container.innerHTML = '<div class="card-error">데이터를 불러오지 못했습니다.</div>';
  }
}

// 기사: 체크박스 클릭 시 코멘트 영역 표시
function driverComplete(directiveId, checkbox) {
  if (checkbox.checked) {
    const area = document.getElementById(`comment-area-${directiveId}`);
    if (area) area.style.display = 'flex';
  }
}

// 기사: 완료 확인
async function confirmDone(directiveId) {
  const commentEl = document.getElementById(`comment-${directiveId}`);
  const comment = commentEl ? commentEl.value.trim() : '';

  try {
    await db.collection('directives').doc(directiveId).update({
      [`completions.${directiveUser.uid}`]: {
        done: true,
        comment: comment,
        doneAt: firebase.firestore.FieldValue.serverTimestamp()
      }
    });

    const item = document.getElementById(`drdir-${directiveId}`);
    if (item) {
      item.classList.add('done');
      const contentEl = item.querySelector('.directive-content-text');
      if (contentEl) contentEl.classList.add('strikethrough');
      const area = item.querySelector('.comment-area');
      if (area) area.style.display = 'none';
      const metaEl = item.querySelector('.driver-dir-meta');
      if (metaEl) {
        const doneSpan = document.createElement('span');
        doneSpan.className = 'done-label';
        doneSpan.textContent = '✓ 완료';
        metaEl.appendChild(doneSpan);
      }
      const cb = item.querySelector('.directive-cb');
      if (cb) cb.disabled = true;
    }
  } catch (e) {
    console.error('완료 처리 실패:', e);
    alert('완료 처리에 실패했습니다.');
    const cb = document.querySelector(`#drdir-${directiveId} .directive-cb`);
    if (cb) { cb.checked = false; cb.disabled = false; }
  }
}

// 완료 지시사항 상세 펼치기/접기
function toggleDoneDetail(directiveId) {
  const detail = document.getElementById(`done-detail-${directiveId}`);
  if (!detail) return;
  const arrow = document.querySelector(`#drdir-${directiveId} .directive-check-wrap span[style*="718096"]`);
  if (detail.style.display === 'none') {
    detail.style.display = 'block';
    if (arrow) arrow.textContent = '▲';
  } else {
    detail.style.display = 'none';
    if (arrow) arrow.textContent = '▼';
  }
}
