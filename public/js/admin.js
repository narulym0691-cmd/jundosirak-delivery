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
    loadAdminDirectives(),
    loadWorkdays(),
    loadBaselineCard(),
    loadDeliveryLogs(),
    loadVehicleStatus()
  ]);
}

async function updateMonthInfo() {
  const ym = getCurrentYearMonth();
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const lastDay = new Date(y, m + 1, 0).getDate();
  let totalBizDays = 0;
  for (let d = 1; d <= lastDay; d++) {
    const day = new Date(y, m, d).getDay();
    if (day >= 1 && day <= 5) totalBizDays++;
  }
  try {
    const snap = await db.collection('daily_sales')
      .where('date', '>=', ym+'-01')
      .where('date', '<=', ym+'-31')
      .get();
    const bizDaysPassed = snap.size;
    document.getElementById('monthLabel').textContent = `${ym}`;
    document.getElementById('bizDaysLabel').textContent = `영업일 ${bizDaysPassed}일 진행 / 총 ${totalBizDays}일`;
  } catch(e) {
    document.getElementById('monthLabel').textContent = `${ym}`;
    document.getElementById('bizDaysLabel').textContent = `-`;
  }
}

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

function renderSummaryCards() {
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

  let bReached = 0;
  let bTotal = allTeamsData.length;
  let bRemainList = [];

  allTeamsData.forEach(t => {
    const s = allStatsData[t.id] || {};
    const grade = s.grade || '기준미달';
    const dailyAvgDiff = s.dailyAvgDiff || 0;
    if (grade === 'B' || grade === 'A') {
      bReached++;
    } else {
      const toB = 80 - dailyAvgDiff;
      bRemainList.push({ name: t.name, toB: Math.ceil(toB) });
    }
  });

  let bSubText = '';
  if (bReached === bTotal) {
    bSubText = '전 팀 B등급 달성! 🎉';
  } else if (bRemainList.length > 0) {
    const nearList = allTeamsData
      .filter(t => {
        const s = allStatsData[t.id] || {};
        const g = s.grade || '기준미달';
        return g !== 'B' && g !== 'A';
      })
      .map(t => {
        const s = allStatsData[t.id] || {};
        return { name: t.name, diff: Math.round(s.dailyAvgDiff || 0) };
      })
      .sort((a,b) => b.diff - a.diff)
      .slice(0,3)
      .map(r => `${r.name} ${r.diff}개/일`).join(' · ');
    bSubText = 'B등급 근접 · ' + nearList;
  }

  document.getElementById('summaryBonus').innerHTML = `
    <div class="summary-val">${bReached}<span style="font-size:14px;color:#718096;font-weight:400"> / ${bTotal}팀</span></div>
    <div class="summary-sub">${bSubText}</div>
  `;
}

function renderAdminTeamRanking() {
  const container = document.getElementById('adminRankingTable');
  if (!allTeamsData.length) {
    container.innerHTML = '<div class="empty-msg">데이터가 없습니다.</div>';
    return;
  }

  const ranked = allTeamsData.map(t => {
    const s = allStatsData[t.id] || {};
    const cumul = s.cumulativeTotal || 0;
    const bizDays = s.bizDays || 1;
    const dailyAvg = s.dailyAvg || (bizDays > 0 ? Math.round(cumul / bizDays) : 0);
    const dailyAvgDiff = Math.round(s.dailyAvgDiff || 0);
    const grade = s.grade || calcGrade(cumul, t);
    const baseline = t.baselineDailyAvg || 0;
    return { ...t, cumul, dailyAvg, dailyAvgDiff, grade, bizDays, baseline };
  }).sort((a, b) => b.dailyAvgDiff - a.dailyAvgDiff);

  const rows = ranked.map((t, i) => {
    const gColor = gradeColor(t.grade);
    const isAdmin = adminUser && (adminUser.role === 'admin' || adminUser.role === 'manager');
    const gradeBadge = isAdmin
      ? `<span class="grade-badge-sm" style="background:${gColor};cursor:pointer;"
           onclick="alert('[ ${t.name} 등급 상세 ]\\n등급: ${t.grade}\\n일평균: ${t.dailyAvg}개\\n기준: ${t.baselineDailyAvg}개\\n기준대비: ${t.dailyAvgDiff >= 0 ? '+' : ''}${t.dailyAvgDiff}개')"
         >${t.grade}</span>`
      : `<span class="grade-badge-sm" style="background:${gColor}">${t.grade}</span>`;
    const diffStr = t.dailyAvgDiff >= 0 ? `+${t.dailyAvgDiff}` : `${t.dailyAvgDiff}`;
    const diffColor = t.dailyAvgDiff >= 0 ? '#276749' : '#e53e3e';
    return `
      <tr>
        <td>${i + 1}</td>
        <td style="text-align:left;font-weight:600">${t.name}</td>
        <td style="cursor:pointer;text-decoration:underline dotted;color:var(--primary);" onclick="showCumExplain('${t.name}',${t.cumul},${t.dailyAvg},${t.bizDays},${t.dailyAvgDiff},${t.baseline})">${numFormat(t.cumul)}</td>
        <td>${t.dailyAvg}</td>
        <td style="font-weight:700;color:${diffColor}">${diffStr}</td>
        <td>${gradeBadge}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>순위</th><th>팀명</th><th>누적수량</th><th>일평균</th><th>기준대비</th><th>등급</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function loadAdminAlerts() {
  const container = document.getElementById('adminAlertsCard');
  const summaryEl = document.getElementById('summaryAlerts');
  try {
    const snap = await db.collection('alerts').get();
    let urgent = 0, watch = 0, check = 0;
    const items = [];
    snap.forEach(doc => {
      const a = { id: doc.id, ...doc.data() };
      // grade 또는 level 필드 통일 (grade 우선)
      a.level = a.grade || a.level || 'check';
      // grade:'none' (1일째 추적용) 제외
      if (a.level === 'none') return;
      items.push(a);
      // 미해제 건만 집계
      if (a.resolved) return;
      if (a.level === 'urgent') urgent++;
      else if (a.level === 'watch') watch++;
      else check++;
    });
    summaryEl.innerHTML = `
      <div class="alert-summary-row"><span class="alert-count urgent">${urgent}</span><span class="alert-label">즉시경보</span></div>
      <div class="alert-summary-row"><span class="alert-count watch">${watch}</span><span class="alert-label">주시</span></div>
      <div class="alert-summary-row"><span class="alert-count check">${check}</span><span class="alert-label">확인보고</span></div>
    `;
    if (!items.length) { container.innerHTML = '<div class="empty-msg">경보가 없습니다.</div>'; return; }
    // 미해제만 필터링
    const unresolvedItems = items.filter(a => !a.resolved);
    // 동일 거래처 중복 제거: clientName 기준 최신 날짜 경보 1건만 유지
    const latestByClient = new Map();
    unresolvedItems.forEach(a => {
      const existing = latestByClient.get(a.clientName);
      if (!existing || (a.date || '') > (existing.date || '')) {
        latestByClient.set(a.clientName, a);
      }
    });
    const activeItems = Array.from(latestByClient.values());
    activeItems.sort((a, b) => { const order = { urgent: 0, watch: 1, check: 2 }; return (order[a.level]||9)-(order[b.level]||9); });

    // 팀명 매핑
    const teamNames = { team1:'1팀 준고', team2:'2팀 해운대', team3:'3팀 공오일', team4:'4팀 연수남', team5:'5팀 아가리', team6:'6팀 도세마', team7:'7팀 강서영' };

    container.innerHTML = activeItems.map(a => {
      const levelLabel = a.level==='urgent'?'즉시경보':a.level==='watch'?'주시':'확인보고';
      const levelClass = a.level==='urgent'?'alert-urgent':a.level==='watch'?'alert-watch':'alert-check';
      const smsSent = a.smsSentAt ? `<span style="font-size:10px;color:#276749;margin-left:4px;">📱발송완료</span>` : '';
      const smsBtn = `<button onclick="event.stopPropagation();sendAlertSms('${a.id}','${a.clientName}','${a.level}',${a.consecutiveDays||0},'${a.teamId||''}')" style="font-size:10px;padding:2px 7px;background:#1a4731;color:#fff;border:none;border-radius:5px;cursor:pointer;margin-left:6px;">📱문자</button>`;
      const teamLabel = teamNames[a.teamId] || a.teamId || '';
      const isPriority = a.isPriority || (a.dailyAvgOrder||0) >= 8;
      return `<div class="alert-row ${levelClass}" style="display:flex;align-items:center;gap:4px;cursor:pointer;" onclick="showAlertDetail('${a.id}','${(a.clientName||'').replace(/'/g,"\\'")}','${a.level}',${a.consecutiveDays||0},'${a.teamId||''}','${a.courseId||''}',${a.dailyAvgOrder||0},'${a.date||''}',${isPriority})"><span class="alert-badge ${levelClass}">${levelLabel}</span><span class="alert-client">${a.clientName}</span>${isPriority?'<span style="font-size:10px;background:#744210;color:#fff;padding:1px 5px;border-radius:8px;margin-left:3px;">⭐</span>':''}<span style="font-size:11px;color:#718096;margin-left:2px;">${teamLabel}</span><span class="alert-days-sm" style="margin-left:4px;">${a.consecutiveDays||0}일</span>${smsSent}${smsBtn}</div>`;
    }).join('');
  } catch(e) {
    console.error('경보 로드 실패:', e);
    container.innerHTML = '<div class="card-error">경보 데이터 로드 실패</div>';
    summaryEl.innerHTML = '<div class="empty-msg">-</div>';
  }
}

async function loadAdminDirectives() {
  const container = document.getElementById('directiveProgressCard');
  const feedbackContainer = document.getElementById('feedbackPendingCard');
  try {
    const snap = await db.collection('directives').get();
    const directives = [];
    snap.forEach(doc => directives.push({ id: doc.id, ...doc.data() }));
    directives.sort((a,b) => { const ta=a.createdAt?a.createdAt.toMillis():0,tb=b.createdAt?b.createdAt.toMillis():0; return tb-ta; });
    directives.splice(20);
    if (!directives.length) { container.innerHTML='<div class="empty-msg">등록된 지시사항이 없습니다.</div>'; feedbackContainer.innerHTML='<div class="empty-msg">없음</div>'; return; }
    const teamProgress = {};
    allTeamsData.forEach(t => { teamProgress[t.id] = { name: t.name, total: 0, done: 0 }; });
    const usersSnap = await db.collection('users').get();
    const userTeamMap = {};
    usersSnap.forEach(doc => { const d=doc.data(); if(d.active!==false) userTeamMap[doc.id]=d.teamId; });
    directives.forEach(d => {
      const targetTeams = d.targetTeams&&d.targetTeams.length>0 ? d.targetTeams : allTeamsData.map(t=>t.id);
      targetTeams.forEach(tid => {
        if (!teamProgress[tid]) return;
        teamProgress[tid].total++;
        if (d.completions) {
          const teamUsers = Object.keys(userTeamMap).filter(uid=>userTeamMap[uid]===tid);
          const anyDone = teamUsers.some(uid=>d.completions[uid]&&d.completions[uid].done);
          if (anyDone) teamProgress[tid].done++;
        }
      });
    });
    const progressHtml = Object.values(teamProgress).map(tp => {
      const pct = tp.total>0?Math.round((tp.done/tp.total)*100):0;
      const barColor = pct>=80?'#38a169':pct>=50?'#ecc94b':'#fc8181';
      return `<div class="progress-item"><div class="progress-header"><span class="progress-team">${tp.name}</span><span class="progress-pct" style="color:${barColor}">${pct}%</span></div><div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%;background:${barColor}"></div></div><div class="progress-sub">${tp.done}/${tp.total} 완료</div></div>`;
    }).join('');
    container.innerHTML = progressHtml||'<div class="empty-msg">데이터가 없습니다.</div>';
    feedbackContainer.innerHTML = '<div class="empty-msg">피드백 기능 준비 중입니다.</div>';
  } catch(e) {
    console.error('지시사항 이행률 로드 실패:', e);
    container.innerHTML = '<div class="card-error">데이터 로드 실패</div>';
  }
}

async function loadWorkdays() {
  const container = document.getElementById('workdaysCard');
  try {
    const doc = await db.collection('settings').doc('workdays').get();
    const data = doc.exists ? doc.data() : {};
    const now = new Date();
    const months = [];
    for (let i=-1; i<=4; i++) {
      const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      months.push({ ym, label: `${d.getFullYear()}년 ${d.getMonth()+1}월` });
    }
    const rows = months.map(({ym,label}) => {
      const val = data[ym]||'';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f0f0f0;"><span style="font-size:13px;font-weight:600;color:#2d3748;width:100px;">${label}</span><input type="number" id="wd-${ym}" value="${val}" min="1" max="31" style="width:70px;padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;font-size:13px;text-align:center;" placeholder="일수"><span style="font-size:12px;color:#718096;">영업일</span>${val?'<span style="font-size:11px;color:#38a169;">✓ 저장됨</span>':'<span style="font-size:11px;color:#e53e3e;">미설정</span>'}</div>`;
    }).join('');
    container.innerHTML = `<div>${rows}</div><button onclick="saveWorkdays()" style="margin-top:14px;width:100%;padding:10px;background:#1a4731;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">💾 저장</button><div id="wd-msg" style="font-size:12px;text-align:center;margin-top:8px;"></div>`;
  } catch(e) { container.innerHTML='<div class="card-error">로드 실패</div>'; }
}

async function saveWorkdays() {
  const msg = document.getElementById('wd-msg');
  msg.textContent='저장 중...'; msg.style.color='#718096';
  try {
    const inputs = document.querySelectorAll('[id^="wd-"]');
    const data = {};
    inputs.forEach(input => { const ym=input.id.replace('wd-',''); const val=parseInt(input.value); if(val>0) data[ym]=val; });
    await db.collection('settings').doc('workdays').set(data, { merge: true });
    msg.textContent='✅ 저장 완료!'; msg.style.color='#38a169';
    setTimeout(()=>loadWorkdays(), 800);
  } catch(e) { msg.textContent='❌ 저장 실패: '+e.message; msg.style.color='#e53e3e'; }
}

let clientUploadData = [];
const COURSE_TEAM_MAP = {
  '코스1':'team2','코스2':'team2','코스3':'team4','코스4':'team3',
  '코스5':'team1','코스6':'team1','코스7':'team2','코스8':'team4',
  '코스9':'team1','코스10':'team5','코스11':'team7','코스12':'team6',
  '코스13':'team4','코스14':'team7','코스15':'team3','코스16':'team5',
  '코스17':'team7','코스18':'team5','코스19':'team6'
};
const DAY_MAP = { '월':0,'화':1,'수':2,'목':3,'금':4 };

function showClientUpload() { document.getElementById('clientUploadModal').style.display='block'; }
function closeClientUpload() {
  document.getElementById('clientUploadModal').style.display='none';
  document.getElementById('cu-filename').textContent='선택 안 됨';
  document.getElementById('cu-preview').style.display='none';
  document.getElementById('cu-save-btn').style.display='none';
  document.getElementById('cu-msg').textContent='';
  document.getElementById('cu-file').value='';
  clientUploadData=[];
}

function onClientFileChange(input) {
  const file=input.files[0]; if(!file) return;
  document.getElementById('cu-filename').textContent=file.name;
  document.getElementById('cu-msg').textContent='파일 분석 중...';
  const reader=new FileReader();
  reader.onload=function(e) {
    try {
      const data=new Uint8Array(e.target.result);
      const wb=XLSX.read(data,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      let dataStart=-1;
      for(let i=0;i<rows.length;i++){
        if(rows[i][0]&&String(rows[i][0]).includes('거래처명')){dataStart=i+1;break;}
        if(rows[i][0]&&!String(rows[i][0]).includes('예시')&&!String(rows[i][0]).includes('준도시락')&&String(rows[i][0]).trim()!==''){dataStart=i;break;}
      }
      if(dataStart<0) dataStart=3;
      clientUploadData=[];
      for(let i=dataStart;i<rows.length;i++){
        const row=rows[i]; const name=String(row[0]||'').trim();
        if(!name||name.includes('예시')) continue;
        const course=String(row[1]||'').trim();
        const isPriority=String(row[2]||'').trim().toUpperCase()==='O';
        const orderDays=[],dayLabels=[];
        ['월','화','수','목','금'].forEach((d,idx)=>{ if(String(row[3+idx]||'').trim().toUpperCase()==='O'){orderDays.push(idx);dayLabels.push(d);} });
        const dailyAvg=parseInt(row[8])||0;
        const memo=String(row[9]||'').trim();
        clientUploadData.push({clientName:name,courseId:course,teamId:COURSE_TEAM_MAP[course]||'',isPriority,orderDays,dayLabels,dailyAvgOrder:dailyAvg,memo,active:true});
      }
      if(!clientUploadData.length){document.getElementById('cu-msg').textContent='⚠️ 유효한 데이터가 없습니다.';return;}
      const tbody=document.getElementById('cu-preview-body');
      tbody.innerHTML=clientUploadData.map(c=>`<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:5px 8px;">${c.clientName}</td><td style="padding:5px 8px;text-align:center;">${c.courseId}</td><td style="padding:5px 8px;text-align:center;color:${c.isPriority?'#e53e3e':'#718096'}">${c.isPriority?'★1순위':'일반'}</td><td style="padding:5px 8px;text-align:center;">${c.dayLabels.join(',')}</td><td style="padding:5px 8px;text-align:center;">${c.dailyAvgOrder||'-'}</td><td style="padding:5px 8px;color:#718096;font-size:10px;">${c.memo||''}</td></tr>`).join('');
      document.getElementById('cu-preview-summary').textContent=`총 ${clientUploadData.length}개 거래처`;
      document.getElementById('cu-preview').style.display='block';
      document.getElementById('cu-save-btn').style.display='block';
      document.getElementById('cu-msg').textContent='';
    } catch(e){document.getElementById('cu-msg').textContent='❌ 파일 파싱 실패: '+e.message;}
  };
  reader.readAsArrayBuffer(file);
}

async function saveClientData() {
  const btn=document.getElementById('cu-save-btn'),msg=document.getElementById('cu-msg');
  btn.disabled=true; btn.textContent='저장 중...'; msg.textContent='';
  try {
    const batch=db.batch(); let newCount=0,updateCount=0;
    for(const c of clientUploadData){
      const snap=await db.collection('clients').where('clientName','==',c.clientName).limit(1).get();
      if(snap.empty){const ref=db.collection('clients').doc();batch.set(ref,{...c,createdAt:firebase.firestore.FieldValue.serverTimestamp()});newCount++;}
      else{const ref=snap.docs[0].ref;batch.update(ref,{courseId:c.courseId,teamId:c.teamId,isPriority:c.isPriority,orderDays:c.orderDays,dailyAvgOrder:c.dailyAvgOrder,memo:c.memo,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});updateCount++;}
    }
    await batch.commit();
    msg.style.color='#38a169'; msg.textContent=`✅ 저장 완료! 신규 ${newCount}건 / 업데이트 ${updateCount}건`;
    btn.style.display='none'; setTimeout(()=>closeClientUpload(),2000);
  } catch(e){msg.style.color='#e53e3e';msg.textContent='❌ 저장 실패: '+e.message;btn.disabled=false;btn.textContent='✅ Firestore에 저장';}
}

let baselineDetailVisible=false, allMonthlyStats={};
function toggleBaselineDetail(){
  baselineDetailVisible=!baselineDetailVisible;
  document.getElementById('baselineDetail').style.display=baselineDetailVisible?'block':'none';
  document.getElementById('btnBaselineDetail').textContent=baselineDetailVisible?'📊 실적 상세 닫기':'📊 실적 상세 보기';
  if(baselineDetailVisible) loadAllMonthlyStats();
}
async function loadAllMonthlyStats(){
  try{const snap=await db.collection('monthly_stats').get();allMonthlyStats={};snap.forEach(doc=>{allMonthlyStats[doc.id]=doc.data();});}
  catch(e){console.error('월별 통계 로드 실패:',e);}
}

async function loadBaselineCard() {
  const container = document.getElementById('baselineCard');
  try {
    const snap = await db.collection('teams').get();
    const teams = [];
    snap.forEach(doc => teams.push({ id: doc.id, ...doc.data() }));
    teams.sort((a,b) => a.id.localeCompare(b.id));
    const ym = getCurrentYearMonth();
    const statsDoc = await db.collection('monthly_stats').doc(ym).get();
    const stats = statsDoc.exists ? statsDoc.data() : {};
    container.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="background:#f7fafc;"><th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">팀명</th><th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">기준 일평균</th><th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">C등급</th><th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">B등급</th><th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">A등급</th><th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">수정</th></tr></thead>
        <tbody>${teams.map(t=>`<tr id="baseline-row-${t.id}" style="border-bottom:1px solid #f0f0f0;"><td style="padding:8px;font-weight:700;">${t.name}<br><span style="font-size:10px;color:#718096;font-weight:400;">${t.region}</span></td><td style="padding:8px;text-align:center;font-weight:700;color:#2F5496;" id="bl-avg-${t.id}">${t.baselineDailyAvg}</td><td style="padding:8px;text-align:center;color:#718096;" id="bl-c-${t.id}">${t.gradeC}</td><td style="padding:8px;text-align:center;color:#375623;" id="bl-b-${t.id}">${t.gradeB}</td><td style="padding:8px;text-align:center;color:#C55A11;" id="bl-a-${t.id}">${t.gradeA}</td><td style="padding:8px;text-align:center;"><button onclick="editBaseline('${t.id}','${t.name}',${t.baselineDailyAvg},${t.gradeC},${t.gradeB},${t.gradeA})" style="padding:4px 10px;background:#edf2f7;border:none;border-radius:5px;font-size:11px;cursor:pointer;font-weight:600;">수정</button></td></tr>`).join('')}</tbody>
      </table>`;
  } catch(e) { container.innerHTML='<div class="card-error">로드 실패</div>'; }
}

function editBaseline(teamId, teamName, avg, gradeC, gradeB, gradeA) {
  const newAvg = prompt(`[${teamName}] 기준 일평균 수정\n현재: ${avg}개\n\n새 기준 일평균을 입력하세요:`, avg);
  if(newAvg===null||newAvg==='') return;
  const val = parseInt(newAvg);
  if(isNaN(val)||val<1){alert('올바른 숫자를 입력하세요.');return;}
  const reason = prompt(`변경 사유를 입력하세요:`, '');
  if(reason===null) return;
  const newC=val+50,newB=val+80,newA=val+120;
  if(!confirm(`[${teamName}] 기준수량 변경\n\n일평균: ${avg} → ${val}\nC등급: ${gradeC} → ${newC}\nB등급: ${gradeB} → ${newB}\nA등급: ${gradeA} → ${newA}\n사유: ${reason||'없음'}\n\n저장하시겠습니까?`)) return;
  const batch=db.batch();
  batch.update(db.collection('teams').doc(teamId),{baselineDailyAvg:val,gradeC:newC,gradeB:newB,gradeA:newA});
  batch.set(db.collection('baseline_history').doc(),{teamId,teamName,before:avg,after:val,gradeC_before:gradeC,gradeC_after:newC,gradeB_before:gradeB,gradeB_after:newB,gradeA_before:gradeA,gradeA_after:newA,reason:reason||'없음',changedBy:adminUser?adminUser.name:'관리자',changedAt:firebase.firestore.FieldValue.serverTimestamp()});
  batch.commit().then(()=>{document.getElementById(`bl-avg-${teamId}`).textContent=val;document.getElementById(`bl-c-${teamId}`).textContent=newC;document.getElementById(`bl-b-${teamId}`).textContent=newB;document.getElementById(`bl-a-${teamId}`).textContent=newA;alert(`✅ ${teamName} 기준수량 저장 완료!`);}).catch(e=>alert('❌ 저장 실패: '+e.message));
}

async function calcBaseline(period) {
  const container=document.getElementById('baselineDetailTable');
  container.innerHTML='<div class="empty-msg">계산 중...</div>';
  try {
    await loadAllMonthlyStats();
    const teamsSnap=await db.collection('teams').get();
    const teams=[];
    teamsSnap.forEach(doc=>teams.push({id:doc.id,...doc.data()}));
    teams.sort((a,b)=>a.id.localeCompare(b.id));
    const allMonths=Object.keys(allMonthlyStats).sort();
    const now=new Date();
    const currentYm=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    let targetMonths=[];
    if(period==='all') targetMonths=allMonths;
    else if(period==='3m') targetMonths=allMonths.slice(-3);
    else if(period==='2m') targetMonths=allMonths.slice(-2);
    else if(period==='1m') targetMonths=[currentYm];
    const periodLabel=period==='all'?`전체(${targetMonths[0]}~${targetMonths[targetMonths.length-1]})`:period==='3m'?`최근 3개월`:period==='2m'?`최근 2개월`:'당월만';
    const rows=teams.map(t=>{
      let totalCumul=0,totalBiz=0;
      targetMonths.forEach(ym=>{const s=(allMonthlyStats[ym]||{})[t.id]||{};totalCumul+=s.cumulativeTotal||0;totalBiz+=s.bizDays||0;});
      const calcAvg=totalBiz>0?Math.round(totalCumul/totalBiz):0;
      const diff=calcAvg-t.baselineDailyAvg;
      const diffStr=diff>=0?`+${diff}`:`${diff}`;
      const diffColor=diff>0?'#c53030':diff<0?'#2b6cb0':'#718096';
      return {t,totalCumul,totalBiz,calcAvg,diff,diffStr,diffColor};
    });
    container.innerHTML=`<div style="font-size:11px;color:#718096;margin-bottom:8px;">📅 기간: ${periodLabel}</div><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#f7fafc;"><th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">팀명</th><th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">기간누적</th><th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">영업일</th><th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">계산값</th><th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">현재기준</th><th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">차이</th><th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">적용</th></tr></thead><tbody>${rows.map(({t,totalCumul,totalBiz,calcAvg,diffStr,diffColor})=>`<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;font-weight:600;">${t.name}</td><td style="padding:6px 8px;text-align:center;">${numFormat(totalCumul)}</td><td style="padding:6px 8px;text-align:center;">${totalBiz}일</td><td style="padding:6px 8px;text-align:center;font-weight:700;color:#2F5496;">${calcAvg}</td><td style="padding:6px 8px;text-align:center;">${t.baselineDailyAvg}</td><td style="padding:6px 8px;text-align:center;font-weight:700;color:${diffColor}">${diffStr}</td><td style="padding:6px 8px;text-align:center;"><button onclick="applyBaseline('${t.id}','${t.name}',${calcAvg},${t.baselineDailyAvg})" style="padding:3px 8px;background:#1a4731;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;">적용</button></td></tr>`).join('')}</tbody></table><button onclick="applyAllBaseline(${JSON.stringify(rows.map(r=>({id:r.t.id,name:r.t.name,calcAvg:r.calcAvg})))})" style="margin-top:10px;width:100%;padding:9px;background:#2F5496;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;">✅ 전체 팀 일괄 적용</button>`;
  } catch(e){container.innerHTML='<div class="card-error">계산 실패: '+e.message+'</div>';}
}

async function applyBaseline(teamId,teamName,calcAvg,currentAvg){
  const reason=prompt(`[${teamName}] 기준수량 변경\n현재: ${currentAvg} → 계산값: ${calcAvg}\n\n변경 사유를 입력하세요:`,'실적 기반 자동 계산 적용');
  if(reason===null) return;
  try{
    const batch=db.batch();
    batch.update(db.collection('teams').doc(teamId),{baselineDailyAvg:calcAvg,gradeC:calcAvg+50,gradeB:calcAvg+80,gradeA:calcAvg+120});
    batch.set(db.collection('baseline_history').doc(),{teamId,teamName,before:currentAvg,after:calcAvg,gradeC_before:currentAvg+50,gradeC_after:calcAvg+50,gradeB_before:currentAvg+80,gradeB_after:calcAvg+80,gradeA_before:currentAvg+120,gradeA_after:calcAvg+120,reason:reason||'없음',changedBy:adminUser?adminUser.name:'관리자',changedAt:firebase.firestore.FieldValue.serverTimestamp()});
    await batch.commit();
    alert(`✅ ${teamName} 기준수량 적용 완료!`);
    loadBaselineCard();
  }catch(e){alert('❌ 적용 실패: '+e.message);}
}

async function applyAllBaseline(teamList){
  const reason=prompt(`전체 ${teamList.length}개 팀 기준수량을 계산값으로 일괄 적용합니다.\n\n변경 사유를 입력하세요:`,'실적 기반 자동 계산 일괄 적용');
  if(reason===null) return;
  try{
    const batch=db.batch();
    const teamsSnap=await db.collection('teams').get();
    const currentTeams={};
    teamsSnap.forEach(doc=>{currentTeams[doc.id]=doc.data();});
    teamList.forEach(({id,name,calcAvg})=>{
      const current=currentTeams[id]||{};
      batch.update(db.collection('teams').doc(id),{baselineDailyAvg:calcAvg,gradeC:calcAvg+50,gradeB:calcAvg+80,gradeA:calcAvg+120});
      batch.set(db.collection('baseline_history').doc(),{teamId:id,teamName:name,before:current.baselineDailyAvg||0,after:calcAvg,gradeC_before:current.gradeC||0,gradeC_after:calcAvg+50,gradeB_before:current.gradeB||0,gradeB_after:calcAvg+80,gradeA_before:current.gradeA||0,gradeA_after:calcAvg+120,reason:reason||'없음',changedBy:adminUser?adminUser.name:'관리자',changedAt:firebase.firestore.FieldValue.serverTimestamp()});
    });
    await batch.commit();
    alert('✅ 전체 팀 기준수량 일괄 적용 완료!');
    loadBaselineCard();
  }catch(e){alert('❌ 적용 실패: '+e.message);}
}

let baselineHistoryVisible=false;
async function toggleBaselineHistory(){
  baselineHistoryVisible=!baselineHistoryVisible;
  document.getElementById('baselineHistory').style.display=baselineHistoryVisible?'block':'none';
  document.getElementById('btnBaselineHistory').textContent=baselineHistoryVisible?'📋 이력 닫기':'📋 수정이력';
  if(baselineHistoryVisible) await loadBaselineHistory();
}

async function loadBaselineHistory(){
  const container=document.getElementById('baselineHistoryList');
  try{
    const snap=await db.collection('baseline_history').orderBy('changedAt','desc').limit(30).get();
    if(snap.empty){container.innerHTML='<div class="empty-msg">수정 이력이 없습니다.</div>';return;}
    const rows=[];
    snap.forEach(doc=>{
      const d=doc.data();
      const dt=d.changedAt?d.changedAt.toDate().toLocaleString('ko-KR'):'-';
      rows.push(`<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;font-size:11px;color:#718096;">${dt}</td><td style="padding:6px 8px;font-weight:600;">${d.teamName}</td><td style="padding:6px 8px;text-align:center;">${d.before} → <strong style="color:#2F5496;">${d.after}</strong></td><td style="padding:6px 8px;text-align:center;font-size:11px;color:#718096;">C:${d.gradeC_before}→${d.gradeC_after}<br>B:${d.gradeB_before}→${d.gradeB_after}<br>A:${d.gradeA_before}→${d.gradeA_after}</td><td style="padding:6px 8px;font-size:11px;color:#4a5568;">${d.reason||'-'}</td><td style="padding:6px 8px;font-size:11px;color:#718096;">${d.changedBy||'-'}</td></tr>`);
    });
    container.innerHTML=`<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#f7fafc;"><th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">일시</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">팀명</th><th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">일평균 변경</th><th style="padding:6px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">등급기준 변경</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">사유</th><th style="padding:6px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">변경자</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }catch(e){container.innerHTML='<div class="card-error">이력 로드 실패: '+e.message+'</div>';}
}

let deliveryDetailVisible=false;
async function loadDeliveryLogs(){
  const summaryEl=document.getElementById('deliverySummary');
  const badgeEl=document.getElementById('deliveryDateBadge');
  const today=new Date();
  const todayStr=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const startOfDay=new Date(todayStr+'T00:00:00');
  const endOfDay=new Date(todayStr+'T23:59:59');
  badgeEl.textContent=`📅 ${todayStr}`;
  try{
    const tsStart=firebase.firestore.Timestamp.fromDate(startOfDay);
    const tsEnd=firebase.firestore.Timestamp.fromDate(endOfDay);
    const snap=await db.collection('delivery_logs').where('createdAt','>=',tsStart).where('createdAt','<=',tsEnd).orderBy('createdAt','desc').get();
    const logs=[];
    snap.forEach(doc=>logs.push({id:doc.id,...doc.data()}));
    if(!logs.length){summaryEl.innerHTML='<div class="empty-msg">오늘 배송완료 기록이 없습니다.</div>';if(deliveryDetailVisible)document.getElementById('deliveryDetailList').innerHTML='<div class="empty-msg">없음</div>';return;}
    const teamMap={};
    logs.forEach(log=>{const tid=log.teamId||'미배정';const tname=log.teamName||'미배정';if(!teamMap[tid])teamMap[tid]={teamName:tname,count:0,drivers:new Set()};teamMap[tid].count++;teamMap[tid].drivers.add(log.driverName||log.driverId);});
    const teamRows=Object.entries(teamMap).sort((a,b)=>b[1].count-a[1].count).map(([tid,t])=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f0f0f0;"><span style="font-weight:600;">${t.teamName}</span><div style="display:flex;gap:8px;align-items:center;"><span style="font-size:11px;color:#718096;">${[...t.drivers].join(', ')}</span><span style="font-weight:700;color:#2F5496;font-size:15px;">${t.count}건</span></div></div>`).join('');
    summaryEl.innerHTML=`<div style="font-size:12px;color:#718096;margin-bottom:8px;">전체 <strong style="color:#2F5496;">${logs.length}건</strong> 완료</div>${teamRows}`;
    if(deliveryDetailVisible) renderDeliveryDetail(logs);
  }catch(e){summaryEl.innerHTML=`<div class="card-error">로드 실패: ${e.message}</div>`;}
}

function renderDeliveryDetail(logs){
  const el=document.getElementById('deliveryDetailList');
  if(!logs||!logs.length){el.innerHTML='<div class="empty-msg">없음</div>';return;}
  const rows=logs.map(log=>{const dt=log.completedAt?log.completedAt.toDate().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}):'-';return `<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:5px 8px;font-size:12px;color:#718096;">${dt}</td><td style="padding:5px 8px;font-weight:600;font-size:12px;">${log.driverName||log.driverId}</td><td style="padding:5px 8px;font-size:12px;color:#4a5568;">${log.teamName||'-'}</td><td style="padding:5px 8px;font-size:12px;">${log.courseId||'-'}</td><td style="padding:5px 8px;font-size:12px;color:#718096;">${log.clientName||'-'}</td><td style="padding:5px 8px;font-size:11px;color:#a0aec0;">${log.source||'app'}</td></tr>`;}).join('');
  el.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#f7fafc;"><th style="padding:5px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">완료시간</th><th style="padding:5px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">기사</th><th style="padding:5px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">팀</th><th style="padding:5px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">코스</th><th style="padding:5px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">거래처</th><th style="padding:5px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">출처</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function toggleDeliveryDetail(){
  deliveryDetailVisible=!deliveryDetailVisible;
  document.getElementById('deliveryDetail').style.display=deliveryDetailVisible?'block':'none';
  document.getElementById('btnDeliveryDetail').textContent=deliveryDetailVisible?'📋 상세닫기':'📋 상세보기';
  if(deliveryDetailVisible) loadDeliveryLogs();
}

async function loadVehicleStatus(){
  const container=document.getElementById('vehicleStatusBody');
  if(!container) return;
  const ym=getCurrentYearMonth();
  try{
    const usersSnap=await db.collection('users').where('role','in',['driver','leader']).where('active','==',true).get();
    const drivers=[];
    usersSnap.forEach(doc=>{const d=doc.data();drivers.push({id:doc.id,name:d.name||'-',teamId:d.teamId||'-',teamName:''});});
    const teamsSnap=await db.collection('teams').get();
    const teamMap={};
    teamsSnap.forEach(doc=>{teamMap[doc.id]=doc.data().name||doc.id;});
    drivers.forEach(d=>{d.teamName=teamMap[d.teamId]||d.teamId;});
    const checksSnap=await db.collection('vehicle_checks').doc(ym).collection('drivers').get();
    const checkMap={};
    checksSnap.forEach(doc=>{checkMap[doc.id]=doc.data();});
    if(!drivers.length){container.innerHTML='<div style="text-align:center;color:#a0aec0;font-size:13px;padding:20px 0;">등록된 기사가 없습니다.</div>';return;}
    const doneCount=drivers.filter(d=>checkMap[d.id]).length;
    drivers.sort((a,b)=>{const ta=a.teamName||'',tb=b.teamName||'';if(ta!==tb)return ta.localeCompare(tb,'ko');return(a.name||'').localeCompare(b.name||'','ko');});
    const rows=drivers.map(d=>{const check=checkMap[d.id];const isDone=!!check;const uploadDate=isDone&&check.uploadedAt?check.uploadedAt.toDate().toLocaleDateString('ko-KR',{month:'numeric',day:'numeric'}):'-';const photoCount=isDone?(check.photoCount||0):0;return `<tr style="border-bottom:1px solid #f0f4f1;"><td style="padding:8px 6px;font-size:13px;font-weight:600;">${d.name}</td><td style="padding:8px 6px;font-size:12px;color:#4a5568;">${d.teamName}</td><td style="padding:8px 6px;text-align:center;"><span style="display:inline-block;padding:3px 9px;border-radius:10px;font-size:12px;font-weight:700;${isDone?'background:#c6f6d5;color:#276749;':'background:#fed7d7;color:#9b2335;'}">${isDone?'✅ 완료':'❌ 미완료'}</span></td><td style="padding:8px 6px;font-size:12px;color:#718096;text-align:center;">${uploadDate}</td><td style="padding:8px 6px;font-size:12px;text-align:center;">${isDone?photoCount+'장':'-'}</td></tr>`;}).join('');
    container.innerHTML=`<div style="display:flex;gap:12px;margin-bottom:12px;"><div style="background:#c6f6d5;color:#276749;padding:6px 14px;border-radius:10px;font-size:13px;font-weight:700;">완료 ${doneCount}명</div><div style="background:#fed7d7;color:#9b2335;padding:6px 14px;border-radius:10px;font-size:13px;font-weight:700;">미완료 ${drivers.length-doneCount}명</div></div><div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:#f0f4f1;"><th style="padding:8px 6px;text-align:left;font-size:12px;color:#4a5568;border-bottom:1px solid #e2e8f0;">이름</th><th style="padding:8px 6px;text-align:left;font-size:12px;color:#4a5568;border-bottom:1px solid #e2e8f0;">팀</th><th style="padding:8px 6px;text-align:center;font-size:12px;color:#4a5568;border-bottom:1px solid #e2e8f0;">상태</th><th style="padding:8px 6px;text-align:center;font-size:12px;color:#4a5568;border-bottom:1px solid #e2e8f0;">업로드일</th><th style="padding:8px 6px;text-align:center;font-size:12px;color:#4a5568;border-bottom:1px solid #e2e8f0;">사진수</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }catch(e){console.error('차량 현황 로드 실패:',e);container.innerHTML='<div style="text-align:center;color:#e53e3e;font-size:13px;padding:16px;">데이터를 불러오지 못했습니다.<br><small>'+e.message+'</small></div>';}
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
      <button onclick="document.getElementById('cum-explain-modal').remove()" style="margin-top:16px;width:100%;padding:10px;background:#276749;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">확인</button>
    </div>
  `;
};

// ───────────────────────────────────────────
// 영업 현장 기록 관리 (admin)
// ───────────────────────────────────────────

function initFvmFilters() {
  // 월 드롭다운: 최근 6개월
  const sel = document.getElementById('fvm-month');
  if (!sel || sel.options.length > 1) return;
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const opt = document.createElement('option');
    opt.value = ym;
    opt.textContent = ym;
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  }
  // 팀 드롭다운
  const tsel = document.getElementById('fvm-team');
  if (tsel && allTeamsData.length) {
    allTeamsData.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      tsel.appendChild(opt);
    });
  }
}

async function loadAdminFieldVisits() {
  initFvmFilters();
  const ym = document.getElementById('fvm-month').value;
  const teamFilter = document.getElementById('fvm-team').value;
  const container = document.getElementById('fvm-list');
  container.innerHTML = '<div style="text-align:center;color:#718096;padding:16px;font-size:13px;">로딩 중...</div>';

  try {
    let query = db.collection('field_visits').where('yearMonth', '==', ym).orderBy('createdAt', 'desc');
    const snap = await query.get();

    let items = [];
    snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

    if (teamFilter) items = items.filter(v => v.teamId === teamFilter);

    if (!items.length) {
      container.innerHTML = '<div style="text-align:center;color:#718096;padding:20px;font-size:13px;">기록이 없습니다.</div>';
      return;
    }

    container.innerHTML = `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f7fafc;">
              <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e2e8f0;white-space:nowrap;">날짜</th>
              <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e2e8f0;white-space:nowrap;">기사명</th>
              <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e2e8f0;white-space:nowrap;">팀명</th>
              <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e2e8f0;white-space:nowrap;">거래처</th>
              <th style="padding:8px 6px;text-align:left;border-bottom:2px solid #e2e8f0;">내용</th>
              <th style="padding:8px 6px;text-align:center;border-bottom:2px solid #e2e8f0;white-space:nowrap;">사진</th>
              <th style="padding:8px 6px;text-align:center;border-bottom:2px solid #e2e8f0;"></th>
            </tr>
          </thead>
          <tbody>
            ${items.map(v => {
              const dt = v.createdAt ? v.createdAt.toDate().toLocaleDateString('ko-KR', {month:'numeric',day:'numeric'}) : '-';
              const preview = v.content && v.content.length > 30 ? v.content.slice(0,30)+'…' : (v.content||'');
              const photoCnt = (v.photoUrls||[]).length;
              return `<tr style="border-bottom:1px solid #f0f0f0;" onclick="showAdminFvDetail(${JSON.stringify(v).replace(/"/g,'&quot;')})" style="cursor:pointer;">
                <td style="padding:8px 6px;white-space:nowrap;color:#718096;font-size:12px;">${dt}</td>
                <td style="padding:8px 6px;font-weight:600;white-space:nowrap;">${v.driverName||'-'}</td>
                <td style="padding:8px 6px;white-space:nowrap;color:#4a5568;">${v.teamName||'-'}</td>
                <td style="padding:8px 6px;white-space:nowrap;"><span style="background:#f0fff4;color:#276749;padding:1px 7px;border-radius:10px;font-size:12px;">${v.clientName||'-'}</span></td>
                <td style="padding:8px 6px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${preview}</td>
                <td style="padding:8px 6px;text-align:center;color:#718096;">${photoCnt > 0 ? '📷'+photoCnt : '-'}</td>
                <td style="padding:8px 6px;text-align:center;" onclick="event.stopPropagation()">
                  <button onclick="deleteFieldVisit('${v.id}', ${JSON.stringify(v.photoUrls||[]).replace(/"/g,'&quot;')})" style="padding:3px 8px;background:#fff5f5;color:#e53e3e;border:1px solid #fed7d7;border-radius:5px;font-size:11px;cursor:pointer;font-weight:600;">삭제</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div style="font-size:12px;color:#718096;margin-top:8px;text-align:right;">총 ${items.length}건</div>
    `;

    // 통계도 갱신
    renderFvmStat(items);
  } catch (e) {
    console.error('현장기록 로드 실패:', e);
    container.innerHTML = '<div style="color:#e53e3e;text-align:center;padding:16px;font-size:13px;">로드 실패: ' + e.message + '</div>';
  }
}

function renderFvmStat(items) {
  const statEl = document.getElementById('fvm-stat-content');
  if (!statEl) return;
  const countMap = {};
  items.forEach(v => {
    const key = v.driverId || v.driverName;
    if (!countMap[key]) countMap[key] = { name: v.driverName||'-', team: v.teamName||'-', count: 0 };
    countMap[key].count++;
  });
  const ranked = Object.values(countMap).sort((a,b) => b.count - a.count);
  if (!ranked.length) { statEl.innerHTML = '<div style="color:#718096;font-size:13px;">데이터 없음</div>'; return; }
  statEl.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f7fafc;">
          <th style="padding:7px 8px;text-align:center;border-bottom:1px solid #e2e8f0;width:40px;">순위</th>
          <th style="padding:7px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">기사명</th>
          <th style="padding:7px 8px;text-align:left;border-bottom:1px solid #e2e8f0;">팀명</th>
          <th style="padding:7px 8px;text-align:center;border-bottom:1px solid #e2e8f0;">방문횟수</th>
        </tr>
      </thead>
      <tbody>
        ${ranked.map((r,i) => `
          <tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:7px 8px;text-align:center;color:#718096;">${i+1}</td>
            <td style="padding:7px 8px;font-weight:600;">${r.name}</td>
            <td style="padding:7px 8px;color:#4a5568;">${r.team}</td>
            <td style="padding:7px 8px;text-align:center;font-weight:700;color:#1a4731;">${r.count}회</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

let fvmStatOpen = false;
function toggleFvmStat() {
  fvmStatOpen = !fvmStatOpen;
  document.getElementById('fvm-stat').style.display = fvmStatOpen ? 'block' : 'none';
  document.getElementById('fvm-stat-btn').textContent = fvmStatOpen ? '📊 방문 통계 닫기' : '📊 방문 통계 보기';
}

async function deleteFieldVisit(docId, photoUrls) {
  if (!confirm('이 기록을 삭제하시겠습니까?\n사진 파일도 함께 삭제됩니다.')) return;
  try {
    await db.collection('field_visits').doc(docId).delete();
    for (const url of (photoUrls || [])) {
      try { await storage.refFromURL(url).delete(); } catch (e) { /* 파일 없어도 무시 */ }
    }
    loadAdminFieldVisits();
  } catch (e) {
    alert('삭제 실패: ' + e.message);
  }
}

window.showAdminFvDetail = function(v) {
  if (typeof v === 'string') v = JSON.parse(v);
  const dt = v.createdAt && v.createdAt.toDate ? v.createdAt.toDate().toLocaleString('ko-KR') : '-';
  const photos = (v.photoUrls||[]).map(url => `<img src="${url}" style="width:100%;border-radius:10px;margin-bottom:8px;">`).join('');
  let modal = document.getElementById('admin-fv-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'admin-fv-detail-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:20px;width:100%;max-width:400px;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="font-size:15px;font-weight:800;">&#128247; 현장 기록 상세</div>
        <button onclick="document.getElementById('admin-fv-detail-modal').remove()" style="background:none;border:none;font-size:20px;color:#718096;cursor:pointer;">&#10005;</button>
      </div>
      <div style="font-size:12px;color:#718096;margin-bottom:4px;">${dt}</div>
      <div style="font-size:13px;font-weight:700;color:#1a4731;margin-bottom:2px;">${v.driverName||'-'} &middot; ${v.teamName||'-'}</div>
      <div style="font-size:13px;background:#f0fff4;color:#276749;display:inline-block;padding:2px 10px;border-radius:10px;margin-bottom:12px;">${v.clientName||'-'}</div>
      <div style="font-size:14px;color:#2d3748;white-space:pre-wrap;margin-bottom:14px;">${v.content||''}</div>
      ${photos}
      <button onclick="document.getElementById('admin-fv-detail-modal').remove()" style="width:100%;padding:10px;background:#1a4731;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin-top:8px;">닫기</button>
    </div>`;
};

// ── 경보 팀장 문자 수동 발송 ──────────────────────────────────
window.sendAlertSms = async (alertId, clientName, level, days, teamId) => {
  const levelLabel = level === 'urgent' ? '🚨 즉시경보' : level === 'watch' ? '⚠️ 주시경보' : '확인보고';
  const text = `[준도시락 배송관리] ${levelLabel}\n거래처: ${clientName}\n${days ? days+'일 연속 미주문' : ''}\n\n확인 후 조치 결과를 시스템에 입력해주세요.`;

  if (!confirm(`팀장에게 경보 문자를 발송하시겠습니까?\n\n[메시지]\n${text}`)) return;

  try {
    let targets = [];
    if (teamId) {
      const snap = await db.collection('users')
        .where('teamId', '==', teamId)
        .where('role', '==', 'leader')
        .get();
      snap.forEach(doc => {
        const u = doc.data();
        if (u.phone && u.active !== false) targets.push({ name: u.name, phone: u.phone });
      });
    }

    if (!targets.length) {
      alert('해당 팀 팀장의 전화번호가 등록되어 있지 않습니다.');
      return;
    }

    const res = await fetch('https://us-central1-jundosirak-delivery.cloudfunctions.net/sendSms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets, text })
    });
    const data = await res.json();

    if (data.ok && data.sent > 0) {
      await db.collection('alerts').doc(alertId).update({
        smsSentAt: firebase.firestore.FieldValue.serverTimestamp(),
        smsSentTo: targets.map(t => t.name).join(', ')
      });
      alert('✅ ' + targets.map(t=>t.name).join(', ') + '에게 문자 발송 완료!');
      loadAdminAlerts();
    } else {
      alert('❌ 문자 발송 실패: ' + (data.error || '알 수 없는 오류'));
    }
  } catch (e) {
    alert('❌ 오류: ' + e.message);
  }
};

// ── 경보 상세 모달 ──────────────────────────────────────────────
window.showAlertDetail = function(id, clientName, level, consecutiveDays, teamId, courseId, dailyAvgOrder, date, isPriority) {
  const teamNames = { team1:'1팀 준고', team2:'2팀 해운대', team3:'3팀 공오일', team4:'4팀 연수남', team5:'5팀 아가리', team6:'6팀 도세마', team7:'7팀 강서영' };
  const levelLabel = level==='urgent'?'🔴 즉시경보':level==='watch'?'🟡 주시':'🟠 확인보고';
  const levelColor = level==='urgent'?'#e53e3e':level==='watch'?'#dd6b20':'#c05621';
  const bgColor    = level==='urgent'?'#fff5f5':level==='watch'?'#fffaf0':'#fffbf5';
  const priorityLabel = isPriority ? '⭐ 1순위 (8개↑)' : '일반 업체';

  // 기존 모달 제거
  const old = document.getElementById('alertDetailModal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'alertDetailModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:2000;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:28px;width:92%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.18);position:relative;">
      <button onclick="document.getElementById('alertDetailModal').remove()" style="position:absolute;top:14px;right:16px;background:none;border:none;font-size:22px;color:#718096;cursor:pointer;">✕</button>
      <div style="background:${bgColor};border-radius:10px;padding:14px 18px;margin-bottom:18px;text-align:center;">
        <div style="font-size:22px;font-weight:800;color:${levelColor};">${levelLabel}</div>
      </div>
      <table style="width:100%;font-size:14px;border-collapse:collapse;">
        <tr><td style="padding:8px 0;color:#718096;width:90px;">거래처</td><td style="padding:8px 0;font-weight:700;font-size:16px;">${clientName}</td></tr>
        <tr><td style="padding:8px 0;color:#718096;">구분</td><td style="padding:8px 0;font-weight:700;color:${isPriority?'#744210':'#718096'};">${priorityLabel}</td></tr>
        <tr><td style="padding:8px 0;color:#718096;">팀</td><td style="padding:8px 0;">${teamNames[teamId]||teamId||'-'}</td></tr>
        <tr><td style="padding:8px 0;color:#718096;">코스</td><td style="padding:8px 0;">${courseId||'-'}</td></tr>
        <tr><td style="padding:8px 0;color:#718096;">일평균 수량</td><td style="padding:8px 0;font-weight:700;color:#e53e3e;">${dailyAvgOrder}개</td></tr>
        <tr><td style="padding:8px 0;color:#718096;">연속 미주문</td><td style="padding:8px 0;font-weight:700;color:${levelColor};">${consecutiveDays}일째</td></tr>
        <tr><td style="padding:8px 0;color:#718096;">발생일</td><td style="padding:8px 0;">${date||'-'}</td></tr>
      </table>
      <div style="margin-top:20px;display:flex;gap:10px;">
        <button onclick="sendAlertSms('${id}','${clientName}','${level}',${consecutiveDays},'${teamId}');document.getElementById('alertDetailModal').remove();" style="flex:1;padding:11px;background:#1a4731;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">📱 팀장 문자 발송</button>
        <button onclick="document.getElementById('alertDetailModal').remove()" style="padding:11px 18px;background:#e2e8f0;color:#4a5568;border:none;border-radius:8px;font-size:14px;cursor:pointer;">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
};
