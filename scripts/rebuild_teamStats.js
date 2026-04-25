// sales_daily 문서의 teamStats를 driverStats 기반으로 재계산
// 사용: node scripts/rebuild_teamStats.js [--dry-run] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
// 원인: 구 parseClientOrderData 오프셋 버그로 teamStats가 약 2배로 저장됨.
// driverStats는 정확하므로 이를 기반으로 기사→코스→팀 매핑해서 teamStats 재생성.

const admin = require('firebase-admin');
const path = require('path');
const SA_PATH = path.resolve(__dirname, '..', '..', 'jundosirak-delivery-ae87f-sa-new.json');

admin.initializeApp({ credential: admin.credential.cert(require(SA_PATH)) });
const db = admin.firestore();

// 기사→코스 매핑 (MEMORY.md 기준)
const DRIVER_TO_COURSE = {
  '표창훈':'코스1','이근일':'코스2','김민기':'코스3','오철석':'코스4',
  '이진우':'코스5','박인수':'코스6','안준수':'코스7','최용혁':'코스8',
  '유상하':'코스9','금정':'코스10','이호주':'코스11','김창연':'코스12',
  '이창목':'코스13','김동완':'코스14','전태영':'코스15','김종호':'코스16',
  '류대현':'코스17','최준은':'코스18','조홍철':'코스19',
  // 2026-04-01 파일엔 '송정'이 코스6(박인수 자리)에 등장. 이건 임시/대체 기사.
  '송정':'코스6',
  // 김대호: 6팀 도세마 소속 (MEMORY.md 참고)
  '김대호':'코스19',
  // 한재영: 코스10 동래구·금정구 → team5 아가리 (2026-04-24~ 금정 기사 대체)
  '한재영':'코스10',
};

// 코스→팀 매핑 (admin.html COURSE_TO_TEAM과 동일)
const COURSE_TO_TEAM = {
  '코스1':'team2','코스2':'team2','코스3':'team4','코스4':'team3','코스5':'team1','코스6':'team1',
  '코스7':'team2','코스8':'team4','코스9':'team1','코스10':'team5','코스11':'team7','코스12':'team6',
  '코스13':'team4','코스14':'team7','코스15':'team3','코스16':'team5','코스17':'team7','코스18':'team5','코스19':'team6',
};

const MENUS_STATS = ['뜨','프','샐','품','덮','샌','세트','김밥']; // 밥/국 제외

function rebuildTeamStats(driverStats) {
  const teamStats = {};
  const unmapped = [];
  for (const [driver, stats] of Object.entries(driverStats || {})) {
    const course = DRIVER_TO_COURSE[driver];
    if (!course) { unmapped.push(driver); continue; }
    const team = COURSE_TO_TEAM[course];
    if (!team) { unmapped.push(`${driver}(${course})`); continue; }
    if (!teamStats[team]) {
      teamStats[team] = { total: 0 };
      MENUS_STATS.forEach(m => teamStats[team][m] = 0);
    }
    // 기사 stats에서 메뉴별 누적 (구데이터는 '유부', 신규는 '김밥')
    const contribTotal = MENUS_STATS.reduce((a, m) => a + (stats[m] || (m==='김밥' ? (stats['유부']||0) : 0) || 0), 0);
    teamStats[team].total += contribTotal;
    MENUS_STATS.forEach(m => {
      const v = stats[m] || (m==='김밥' ? (stats['유부']||0) : 0) || 0;
      teamStats[team][m] += v;
    });
  }
  return { teamStats, unmapped };
}

(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fromArg = args.find(a => a.startsWith('--from='))?.split('=')[1];
  const toArg   = args.find(a => a.startsWith('--to='))?.split('=')[1];

  console.log(`=== teamStats 재집계 ${dryRun ? '(DRY-RUN)' : '(실제 쓰기)'} ===`);
  if (fromArg) console.log(`from: ${fromArg}`);
  if (toArg) console.log(`to: ${toArg}`);

  let query = db.collection('sales_daily');
  if (fromArg) query = query.where(admin.firestore.FieldPath.documentId(), '>=', fromArg);
  if (toArg) query = query.where(admin.firestore.FieldPath.documentId(), '<=', toArg);
  const snap = await query.get();

  console.log(`\n총 ${snap.size}개 문서 처리 대상\n`);

  let updated = 0, skipped = 0, errors = 0;
  const batch = db.batch();
  let batchCount = 0;
  const summary = [];

  for (const doc of snap.docs) {
    try {
      const data = doc.data();
      if (!data.driverStats) { skipped++; console.log(`⏭️  ${doc.id}: driverStats 없음 스킵`); continue; }

      const { teamStats: newTeamStats, unmapped } = rebuildTeamStats(data.driverStats);

      const oldTotal = data.teamStats ? Object.values(data.teamStats).reduce((a,t)=>a+(t.total||0),0) : 0;
      const newTotal = Object.values(newTeamStats).reduce((a,t)=>a+(t.total||0),0);
      const driverTotal = Object.values(data.driverStats).reduce((a,d)=>a+(d.total||0),0);

      summary.push({ date: doc.id, old: oldTotal, new: newTotal, driver: driverTotal, unmapped });

      if (!dryRun) {
        batch.update(doc.ref, { teamStats: newTeamStats, teamStatsRebuildAt: admin.firestore.FieldValue.serverTimestamp() });
        batchCount++;
        if (batchCount >= 400) {
          await batch.commit();
          batchCount = 0;
        }
      }
      updated++;
    } catch (e) {
      errors++;
      console.error(`❌ ${doc.id}:`, e.message);
    }
  }

  if (!dryRun && batchCount > 0) await batch.commit();

  console.log('\n=== 결과 요약 ===');
  console.log(`처리: ${updated} / 스킵: ${skipped} / 오류: ${errors}`);
  console.log('\n날짜별 변경 상세 (old teamTotal → new teamTotal / driver 총합):');
  summary.forEach(s => {
    const ratio = s.old > 0 ? (s.old / s.new).toFixed(2) : '-';
    const unmappedStr = s.unmapped.length ? ` [unmapped: ${s.unmapped.join(',')}]` : '';
    console.log(`  ${s.date}: ${s.old.toString().padStart(5)} → ${s.new.toString().padStart(5)} / driver=${s.driver} (배율 ${ratio}x)${unmappedStr}`);
  });

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
