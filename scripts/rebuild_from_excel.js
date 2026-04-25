// 원본 엑셀을 admin.html의 parseClientOrderData 로직 그대로 재현해서 teamStats 재집계
// 지역(섹션 헤더) 기반 → 기사가 누구든 상관없음
// 사용: node scripts/rebuild_from_excel.js [--dry-run]

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');
const XLSX = require(path.resolve(__dirname, '..', 'node_modules', 'xlsx'));

const SA_PATH = path.resolve(__dirname, '..', '..', 'jundosirak-delivery-ae87f-sa-new.json');
admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
const db = admin.firestore();

const UPLOAD_DIR = '/home/work/.openclaw/workspace/upload';

// admin.html의 parseClientOrderData 로직 그대로
function parseClientOrderData(wb) {
  const MENUS = ['뜨','프','샐','품','덮','샌','세트','김밥','밥','국'];
  const MENUS_STATS = ['뜨','프','샐','품','덮','샌','세트','김밥'];
  const MENUS_EXCLUDE = ['밥','국'];
  const COURSE_TO_TEAM = {
    '코스1':'team2','코스2':'team2','코스3':'team4','코스4':'team3','코스5':'team1','코스6':'team1',
    '코스7':'team2','코스8':'team4','코스9':'team1','코스10':'team5','코스11':'team7','코스12':'team6',
    '코스13':'team4','코스14':'team7','코스15':'team3','코스16':'team5','코스17':'team7','코스18':'team5','코스19':'team6'
  };
  const SKIP_HEADER_KW = ['번호','순서','이름','거래처1','거래처2','거래처3','거래처4','거래처5','거래처6','거래처7','거래처8','거래처9','기사명','합계','소계','총합계','총 합계'];
  const orderedClients = [], notOrderedClients = [];
  const driverStats = {};
  const teamStats = {};
  const clientOrderMap = {};
  const sheetOrder = [...wb.SheetNames].sort((a, b) => a === '결과' ? -1 : b === '결과' ? 1 : 0);

  for (const sheetName of sheetOrder) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:null });
    if (rows.length < 45) continue;
    const hdr = rows[43] || [];
    let colClient = -1;
    for (let j = 0; j < hdr.length; j++) {
      if (String(hdr[j]||'').trim() === '거래처') { colClient = j; break; }
    }
    if (colClient < 0) {
      if (!String(hdr[10]||'').includes('거래처') && !String(hdr[3]||'').includes('이름')) continue;
      colClient = 10;
    }
    const SECTION_PAT = /^(\d+)\s*◎/;
    const COURSE_NUM_MAP = {};
    for (let i = 1; i <= 19; i++) COURSE_NUM_MAP[i] = `코스${i}`;
    let currentCourseId = '';
    const scanStart = Math.max(0, 43 - 10);
    for (let i = scanStart; i < rows.length; i++) {
      const row = rows[i]; if (!row) continue;
      const secCell = String(row[colClient]||'').trim();
      if (secCell.includes('배송코스') && SECTION_PAT.test(secCell)) {
        currentCourseId = COURSE_NUM_MAP[parseInt(secCell.match(SECTION_PAT)[1])] || '';
        continue;
      }
      if (i < 44) continue;
      const clientName = secCell;
      if (!clientName) continue;
      if (SKIP_HEADER_KW.some(k => clientName === k || clientName.startsWith('거래처'))) continue;
      const driverName = String(row[3]||'').trim();
      let total = 0; const menuQtys = {};
      MENUS.forEach((menu, idx) => {
        const qty = parseInt(row[colClient + 1 + idx]) || 0;
        menuQtys[menu] = qty;
        if (!MENUS_EXCLUDE.includes(menu)) total += qty;
      });
      if (total > 0) {
        const teamId = COURSE_TO_TEAM[currentCourseId];
        if (teamId) {
          if (!teamStats[teamId]) { teamStats[teamId] = { total: 0 }; MENUS_STATS.forEach(m => teamStats[teamId][m] = 0); }
          teamStats[teamId].total += total;
          MENUS_STATS.forEach(m => teamStats[teamId][m] += (menuQtys[m]||0));
        }
        if (clientOrderMap[clientName]) {
          clientOrderMap[clientName].total += total;
          MENUS.forEach(m => { if (driverName && driverStats[driverName]) driverStats[driverName][m] += menuQtys[m]; });
          if (driverName && driverStats[driverName]) driverStats[driverName].total += total;
        } else {
          orderedClients.push(clientName);
          clientOrderMap[clientName] = { total, driverName, courseId: currentCourseId };
          if (driverName) {
            if (!driverStats[driverName]) { driverStats[driverName] = { total:0 }; MENUS.forEach(m => driverStats[driverName][m] = 0); }
            driverStats[driverName].total += total;
            MENUS.forEach(m => driverStats[driverName][m] += menuQtys[m]);
          }
        }
      } else if (!clientOrderMap[clientName] && !orderedClients.includes(clientName)) {
        notOrderedClients.push(clientName);
      }
    }
    if (orderedClients.length || notOrderedClients.length) break;
  }
  return { orderedClients, notOrderedClients, driverStats, teamStats };
}

function findExcelFile(dateStr) {
  // dateStr: "2026-04-01"
  const yymmdd = dateStr.slice(2, 4) + dateStr.slice(5, 7) + dateStr.slice(8, 10);
  // 우선순위: 일일장부_{yymmdd}-나래.xlsx > 일일장부_{yymmdd}.xlsx > 일일장부_20{yymmdd}.xlsx
  const candidates = [
    `일일장부_${yymmdd}-나래.xlsx`,
    `일일장부_${yymmdd}.xlsx`,
    `일일장부_20${yymmdd}.xlsx`,
    `일일장부_${yymmdd}-sk.xlsx`,
    // ⚠️ CSV는 한글 인코딩 이슈로 파싱 실패 위험 → 후보 제외
  ];
  for (const name of candidates) {
    const p = path.join(UPLOAD_DIR, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  console.log(`=== 엑셀 원본 재파싱 ${dryRun ? '(DRY-RUN)' : '(실제 쓰기)'} ===\n`);

  // 4월 sales_daily 문서 목록
  const snap = await db.collection('sales_daily')
    .where(admin.firestore.FieldPath.documentId(), '>=', '2026-04-01')
    .where(admin.firestore.FieldPath.documentId(), '<=', '2026-04-30')
    .get();

  const results = [];
  for (const doc of snap.docs) {
    const date = doc.id;
    const excelPath = findExcelFile(date);
    if (!excelPath) {
      results.push({ date, status: 'SKIP', msg: '엑셀 파일 없음' });
      continue;
    }
    try {
      const wb = XLSX.readFile(excelPath);
      const parsed = parseClientOrderData(wb);
      const teamTotal = Object.values(parsed.teamStats).reduce((a,t)=>a+(t.total||0), 0);
      const driverTotal = Object.values(parsed.driverStats).reduce((a,d)=>a+(d.total||0), 0);
      const oldTeamTotal = Object.values(doc.data().teamStats||{}).reduce((a,t)=>a+(t.total||0), 0);

      // ⚠️ 안전장치: 파싱 결과가 비정상(driverTotal=0)이면 DB 쓰지 않음
      if (driverTotal === 0) {
        results.push({ date, status: 'SKIP', msg: `파싱 실패 (driverTotal=0): ${path.basename(excelPath)}` });
        continue;
      }
      if (!dryRun) {
        await doc.ref.update({
          teamStats: parsed.teamStats,
          driverStats: parsed.driverStats,
          orderedClients: parsed.orderedClients,
          notOrderedClients: parsed.notOrderedClients,
          teamStatsRebuildAt: admin.firestore.FieldValue.serverTimestamp(),
          rebuildSource: path.basename(excelPath),
        });
      }
      results.push({ date, status: 'OK', file: path.basename(excelPath), oldTeam: oldTeamTotal, newTeam: teamTotal, driver: driverTotal, teamStats: parsed.teamStats });
    } catch (e) {
      results.push({ date, status: 'ERR', msg: e.message });
    }
  }

  console.log('날짜       파일                          old → new (driverTotal)');
  console.log('─────────────────────────────────────────────────────────────');
  results.forEach(r => {
    if (r.status === 'OK') {
      console.log(`${r.date}  ${r.file.padEnd(30)} ${String(r.oldTeam).padStart(5)} → ${String(r.newTeam).padStart(5)} (driver=${r.driver})`);
    } else {
      console.log(`${r.date}  [${r.status}] ${r.msg}`);
    }
  });

  console.log('\n=== 4월 팀별 누적 (재집계 후) ===');
  const teamSum = {};
  results.filter(r => r.status === 'OK').forEach(r => {
    Object.entries(r.teamStats).forEach(([t, s]) => {
      teamSum[t] = (teamSum[t] || 0) + s.total;
    });
  });
  Object.entries(teamSum).sort().forEach(([t, v]) => console.log(`  ${t}: ${v}`));
  console.log(`  합계: ${Object.values(teamSum).reduce((a,b)=>a+b, 0)}`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
