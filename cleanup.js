/**
 * cleanup.js - Firestore 기존 더미 데이터 삭제 후 실제 데이터로 재삽입
 * 실행: node cleanup.js
 */

const admin = require('firebase-admin');
const serviceAccount = require('./jundosirak-delivery-sa.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'jundosirak-delivery'
});

const db = admin.firestore();

// 실제 기사 목록 (정확한 이름)
const REAL_USERS = [
  '이영민','유상하','이진우','박인수',
  '표창훈','안준수','이근일',
  '오철석','전태영',
  '김민기','최용혁','이창목',
  '김종호','최준은','금정',
  '조홍철','김창연',
  '류대현','이호주','김동완'
];

const teams = [
  { id: 'team1', name: '준고',        region: '송정/기장/정관',      baselineDailyAvg: 488, gradeC: 538, gradeB: 568, gradeA: 608 },
  { id: 'team2', name: '해운대',      region: '센텀/해운대/마린시티', baselineDailyAvg: 541, gradeC: 591, gradeB: 621, gradeA: 661 },
  { id: 'team3', name: '공오일(051)', region: '서면',                baselineDailyAvg: 349, gradeC: 399, gradeB: 429, gradeA: 469 },
  { id: 'team4', name: '연수남',      region: '수영/남구/연제',       baselineDailyAvg: 554, gradeC: 604, gradeB: 634, gradeA: 674 },
  { id: 'team5', name: '아가리',      region: '동래/금정/양산',       baselineDailyAvg: 483, gradeC: 533, gradeB: 563, gradeA: 603 },
  { id: 'team6', name: '도세마',      region: '사상/북구',            baselineDailyAvg: 299, gradeC: 349, gradeB: 379, gradeA: 419 },
  { id: 'team7', name: '강서영',      region: '영도/사하/강서',       baselineDailyAvg: 460, gradeC: 510, gradeB: 540, gradeA: 580 },
];

const users = [
  { id: 'user_admin',   name: '대표님', role: 'admin',  teamId: null,    password: 'song4433' },
  { id: 'user_t1_ysh',  name: '유상하', role: 'leader', teamId: 'team1', password: 'jundo1234' },
  { id: 'user_t1_ljw',  name: '이진우', role: 'driver', teamId: 'team1', password: 'jundo1234' },
  { id: 'user_t1_pis',  name: '박인수', role: 'driver', teamId: 'team1', password: 'jundo1234' },
  { id: 'user_t2_pch',  name: '표창훈', role: 'leader', teamId: 'team2', password: 'jundo1234' },
  { id: 'user_t2_ajs',  name: '안준수', role: 'driver', teamId: 'team2', password: 'jundo1234' },
  { id: 'user_t2_lgi',  name: '이근일', role: 'driver', teamId: 'team2', password: 'jundo1234', active: false },  // 퇴사
  { id: 'user_t3_ocs',  name: '오철석', role: 'driver', teamId: 'team3', password: 'jundo1234' },
  { id: 'user_t3_jty',  name: '전태영', role: 'driver', teamId: 'team3', password: 'jundo1234' },
  { id: 'user_t4_kmg',  name: '김민기', role: 'leader', teamId: 'team4', password: 'jundo1234' },
  { id: 'user_t4_cyh',  name: '최용혁', role: 'driver', teamId: 'team4', password: 'jundo1234' },
  { id: 'user_t4_lcm',  name: '이창목', role: 'driver', teamId: 'team4', password: 'jundo1234' },
  { id: 'user_t5_kjh',  name: '김종호', role: 'leader', teamId: 'team5', password: 'jundo1234' },
  { id: 'user_t5_cje',  name: '최준은', role: 'driver', teamId: 'team5', password: 'jundo1234' },
  { id: 'user_t5_gj',   name: '금정',   role: 'driver', teamId: 'team5', password: 'jundo1234' },
  { id: 'user_t6_jhc',  name: '조홍철', role: 'driver', teamId: 'team6', password: 'jundo1234' },
  { id: 'user_t6_kdh',  name: '김대호',  role: 'driver', teamId: 'team6', password: 'jundo1234', active: false },  // 무급휴가 3주
  { id: 'user_t6_kcy',  name: '김창연', role: 'driver', teamId: 'team6', password: 'jundo1234' },  // 신입
  { id: 'user_t7_rdh',  name: '류대현', role: 'leader', teamId: 'team7', password: 'jundo1234' },
  { id: 'user_t7_lhj',  name: '이호주', role: 'driver', teamId: 'team7', password: 'jundo1234' },
  { id: 'user_t7_kdw',  name: '김동완', role: 'driver', teamId: 'team7', password: 'jundo1234' },
];

async function main() {
  console.log('=== 1단계: 기존 users 컬렉션 전체 삭제 ===');
  const snap = await db.collection('users').get();
  let delCount = 0;
  for (const doc of snap.docs) {
    await doc.ref.delete();
    delCount++;
  }
  console.log(`  삭제 완료: ${delCount}개 문서`);

  console.log('\n=== 2단계: 팀 데이터 재삽입 ===');
  for (const team of teams) {
    const { id, ...data } = team;
    await db.collection('teams').doc(id).set(data);
    console.log(`  ✓ ${data.name} (${data.region})`);
  }

  console.log('\n=== 3단계: 실제 기사 20명 삽입 ===');
  for (const user of users) {
    const { id, ...data } = user;
    await db.collection('users').doc(id).set({
      ...data,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const teamName = teams.find(t => t.id === data.teamId)?.name || '관리자';
    console.log(`  ✓ ${data.name} (${data.role}) - ${teamName}`);
  }

  console.log('\n====================================');
  console.log(' ✅ 완료! 총 20명 (기사19 + 관리자1)');
  console.log('====================================');
  process.exit(0);
}

main().catch(e => { console.error('❌ 오류:', e); process.exit(1); });
