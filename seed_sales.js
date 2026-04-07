/**
 * seed_sales.js - 4월 판매 데이터 Firestore 삽입
 * 코스명 기준으로 팀 매핑 (기사가 바뀌어도 팀은 코스로 결정)
 * 실행: node seed_sales.js
 */
const admin = require('firebase-admin');
const XLSX = require('xlsx');
const path = require('path');
const sa = require('./jundosirak-delivery-sa.json');

admin.initializeApp({ credential: admin.credential.cert(sa), projectId: 'jundosirak-delivery' });
const db = admin.firestore();

// ★ 코스명 → 팀 매핑 (기사가 누구든 코스로 팀 결정)
const COURSE_TEAM = {
  '센텀시티':    'team2',
  '마린시티':    'team2',
  '해운대':      'team2',
  '기장읍,일광읍': 'team1',
  '기장읍, 일광읍': 'team1',
  '송정':        'team1',
  '정관':        'team1',
  '서면':        'team3',
  '서면2':       'team3',
  '연제,서면':   'team4',
  '연제, 서면':  'team4',
  '남구,동구':   'team4',
  '남구, 동구':  'team4',
  '수영구':      'team4',
  '수영구,동래구': 'team5',
  '수영구, 동래구': 'team5',
  '동래구,금정구': 'team5',
  '동래구, 금정구': 'team5',
  '금정구, 양산': 'team5',
  '금정구,양산':  'team5',
  '북구':        'team6',
  '사상, 개금':  'team6',
  '사상,개금':   'team6',
  '영도구,사하구': 'team7',
  '영도구, 사하구': 'team7',
  '중구,영도구': 'team7',
  '중구, 영도구': 'team7',
  '강서구, 사상구': 'team7',
  '강서구,사상구': 'team7',
};

const TEAM_NAMES = {
  team1:'준고', team2:'해운대', team3:'공오일(051)',
  team4:'연수남', team5:'아가리', team6:'도세마', team7:'강서영'
};

// 요일별 팀 기준선 (1~3월 팀합계 기준, 0=월~4=금)
const DOW_BASELINE = {
  0: {team1:498,team2:596,team3:257,team4:580,team5:497,team6:202,team7:493},
  1: {team1:518,team2:573,team3:281,team4:565,team5:526,team6:220,team7:497},
  2: {team1:498,team2:529,team3:250,team4:514,team5:466,team6:195,team7:453},
  3: {team1:449,team2:474,team3:212,team4:482,team5:437,team6:173,team7:401},
  4: {team1:483,team2:546,team3:256,team4:572,team5:497,team6:190,team7:465},
};

const TEAM_BASELINE = {
  team1:488, team2:541, team3:349, team4:554, team5:483, team6:299, team7:460
};
const TEAM_GRADES = {
  team1:{C:538,B:568,A:608}, team2:{C:591,B:621,A:661}, team3:{C:399,B:429,A:469},
  team4:{C:604,B:634,A:674}, team5:{C:533,B:563,A:603}, team6:{C:349,B:379,A:419},
  team7:{C:510,B:540,A:580}
};

// xlsx 파일에서 코스별 데이터 파싱
function parseXlsx(filePath) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['결과'];
  if (!ws) throw new Error(`결과 시트 없음: ${filePath}`);
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // 날짜 추출 (◎ 포함 행에서)
  let date = null;
  const courseRows = [];   // { course, driver, total }

  for (const row of rows) {
    for (const cell of row) {
      if (cell && typeof cell === 'string' && cell.includes('◎')) {
        const m = cell.match(/◎\s*(.+?)\((.+?)\)배송코스:\s*(.+)/);
        if (m && !date) {
          // 날짜 파싱 예: "4월1일 수요일"
          const dm = m[3].match(/(\d+)월(\d+)일/);
          if (dm) {
            const mo = dm[1].padStart(2,'0');
            const dy = dm[2].padStart(2,'0');
            date = `2026-${mo}-${dy}`;
          }
        }
      }
    }
    // 기사명(col14), 합계(col25) 행
    if (row[14] && typeof row[14] === 'string' && row[14].match(/^\d+\.\s*.+/)) {
      const nameMatch = row[14].match(/^\d+\.\s*(.+)/);
      const driverName = nameMatch ? nameMatch[1].trim() : '';
      const total = row[25];
      if (driverName && total && typeof total === 'number' && total > 0) {
        courseRows.push({ driver: driverName, total });
      }
    }
  }

  // 코스명-기사 매핑 재추출
  const driverCourse = {};
  for (const row of rows) {
    for (const cell of row) {
      if (cell && typeof cell === 'string' && cell.includes('◎')) {
        const m = cell.match(/◎\s*(.+?)\((.+?)\)배송코스/);
        if (m) {
          const course = m[1].trim();
          const driver = m[2].trim();
          driverCourse[driver] = course;
        }
      }
    }
  }

  return { date, courseRows, driverCourse };
}

function calcTeamsByCourseName(courseRows, driverCourse) {
  const totals = {}, drivers = {};
  const unmatched = [];

  courseRows.forEach(({ driver, total }) => {
    const course = driverCourse[driver] || '';
    const team = COURSE_TEAM[course];
    if (!team) {
      unmatched.push(`${driver}(${course}):${total}`);
      return;
    }
    totals[team] = (totals[team]||0) + total;
    if (!drivers[team]) drivers[team] = [];
    drivers[team].push(`${driver}(${course}):${total}`);
  });

  if (unmatched.length) {
    console.log(`  ⚠️ 미매핑: ${unmatched.join(', ')}`);
  }
  return { totals, drivers };
}

function calcGrade(dailyAvg, tid) {
  const g = TEAM_GRADES[tid];
  if (dailyAvg >= g.A) return 'A';
  if (dailyAvg >= g.B) return 'B';
  if (dailyAvg >= g.C) return 'C';
  return '기준미달';
}

async function main() {
  console.log('=== 4월 판매 데이터 삽입 (코스명 기준) ===\n');

  // 처리할 xlsx 파일 목록 (파일명에서 날짜 추출: 260401 → 2026-04-01)
  const xlsxFiles = [
    '일일장부_260401.xlsx',
    '일일장부_260402.xlsx',
    '일일장부_260403.xlsx',
  ];

  const processedDates = [];

  for (const fname of xlsxFiles) {
    const fpath = path.join(__dirname, fname);
    try {
      let { date, courseRows, driverCourse } = parseXlsx(fpath);
      // 파일명에서 날짜 추출 (260401 → 2026-04-01)
      if (!date) {
        const dm = fname.match(/(\d{2})(\d{2})(\d{2})\.xlsx$/);
        if (dm) date = `20${dm[1]}-${dm[2]}-${dm[3]}`;
      }
      if (!date) { console.log(`⚠️ ${fname}: 날짜 파싱 실패`); continue; }

      const { totals, drivers } = calcTeamsByCourseName(courseRows, driverCourse);

      await db.collection('daily_sales').doc(date).set({
        date, teamTotals: totals, teamDrivers: drivers,
        driverRows: courseRows, savedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`✓ ${date} 저장 완료`);
      Object.keys(TEAM_NAMES).forEach(t => {
        console.log(`  ${TEAM_NAMES[t]}: ${totals[t]||0}개`);
      });
      processedDates.push(date);
    } catch(e) {
      console.log(`⚠️ ${fname} 처리 실패: ${e.message}`);
    }
  }

  if (!processedDates.length) {
    console.log('처리된 파일 없음. 종료.');
    process.exit(0);
  }

  // monthly_stats 업데이트
  const ym = processedDates[0].slice(0,7); // 2026-04
  const allSnap = await db.collection('daily_sales')
    .where('date','>=',`${ym}-01`).where('date','<=',`${ym}-31`).get();

  const monthTotals = {}, bizDays = new Set(), bizDates = [];
  allSnap.forEach(d => {
    const data = d.data();
    bizDays.add(data.date);
    bizDates.push(data.date);
    Object.entries(data.teamTotals||{}).forEach(([t,v]) => {
      monthTotals[t] = (monthTotals[t]||0) + v;
    });
  });

  // 요일별 기준선 누적
  const dowBaselineCum = {};
  Object.keys(TEAM_NAMES).forEach(tid => dowBaselineCum[tid] = 0);
  bizDates.forEach(dateStr => {
    const [y,m,d] = dateStr.split('-').map(Number);
    const localDow = new Date(y,m-1,d).getDay();
    const adj = localDow === 0 ? 6 : localDow - 1;
    Object.keys(TEAM_NAMES).forEach(tid => {
      dowBaselineCum[tid] += (DOW_BASELINE[adj]||{})[tid] || TEAM_BASELINE[tid];
    });
  });

  const monthlyStats = {};
  Object.keys(TEAM_NAMES).forEach(tid => {
    const cum = monthTotals[tid]||0;
    const biz = bizDays.size;
    const avg = biz > 0 ? Math.round(cum/biz) : 0;
    const grade = calcGrade(avg, tid);
    const baselineCum = dowBaselineCum[tid];
    monthlyStats[tid] = {
      cumulativeTotal: cum,
      baselineCumulative: baselineCum,
      dailyAvgDiff: cum - baselineCum,
      grade, bizDays: biz
    };
    const diff = cum - baselineCum;
    console.log(`\n${TEAM_NAMES[tid]}: 누적=${cum.toLocaleString()} / 기준=${baselineCum} / 기준대비${diff>=0?'+':''}${diff} / ${grade}`);
  });

  await db.collection('monthly_stats').doc(ym).set(monthlyStats);
  console.log(`\n✅ monthly_stats/${ym} 업데이트 완료! (영업일 ${bizDays.size}일)`);
  process.exit(0);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
