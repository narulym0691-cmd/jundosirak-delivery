/**
 * seed.js - Firestore 초기 데이터 삽입 스크립트
 *
 * 실행 방법:
 *   node seed.js
 *
 * 주의: Firebase Admin SDK 필요
 *   npm install firebase-admin
 */

const admin = require('firebase-admin');
const serviceAccount = require('./jundosirak-delivery-sa.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'jundosirak-delivery'
});

const db = admin.firestore();

// =============================================================
// 팀 데이터 7개 (실제 팀명 + 인센티브 기준)
// =============================================================
const teams = [
  {
    id: 'team1',
    name: '준고',
    region: '송정/기장/정관',
    baselineDailyAvg: 488,
    gradeC: 538,
    gradeB: 568,
    gradeA: 608
  },
  {
    id: 'team2',
    name: '해운대',
    region: '센텀/해운대/마린시티',
    baselineDailyAvg: 541,
    gradeC: 591,
    gradeB: 621,
    gradeA: 661
  },
  {
    id: 'team3',
    name: '공오일(051)',
    region: '서면',
    baselineDailyAvg: 349,
    gradeC: 399,
    gradeB: 429,
    gradeA: 469
  },
  {
    id: 'team4',
    name: '연수남',
    region: '수영/남구/연제',
    baselineDailyAvg: 554,
    gradeC: 604,
    gradeB: 634,
    gradeA: 674
  },
  {
    id: 'team5',
    name: '아가리',
    region: '동래/금정/양산',
    baselineDailyAvg: 483,
    gradeC: 533,
    gradeB: 563,
    gradeA: 603
  },
  {
    id: 'team6',
    name: '도세마',
    region: '사상/북구',
    baselineDailyAvg: 299,
    gradeC: 349,
    gradeB: 379,
    gradeA: 419
  },
  {
    id: 'team7',
    name: '강서영',
    region: '영도/사하/강서',
    baselineDailyAvg: 460,
    gradeC: 510,
    gradeB: 540,
    gradeA: 580
  }
];

// =============================================================
// 기사 19명 + 관리자 1명 (실제 이름)
// role: admin / leader / driver
// 3팀(공오일), 6팀(도세마) → 팀장 없음, 모두 driver
// =============================================================
const users = [
  // 관리자
  { id: 'user_admin',    name: '대표님', role: 'admin',  teamId: null,    password: 'song4433' },

  // 1팀 준고 (팀장: 유상하)
  { id: 'user_t1_ysh',  name: '유상하', role: 'leader', teamId: 'team1', password: 'jundo1234' },
  { id: 'user_t1_ljw',  name: '이진우', role: 'driver', teamId: 'team1', password: 'jundo1234' },
  { id: 'user_t1_pis',  name: '박인수', role: 'driver', teamId: 'team1', password: 'jundo1234' },

  // 2팀 해운대 (팀장: 표창훈)
  { id: 'user_t2_pch',  name: '표창훈', role: 'leader', teamId: 'team2', password: 'jundo1234' },
  { id: 'user_t2_ajs',  name: '안준수', role: 'driver', teamId: 'team2', password: 'jundo1234' },
  { id: 'user_t2_lgi',  name: '이근일', role: 'driver', teamId: 'team2', password: 'jundo1234' },

  // 3팀 공오일(051) (팀장 없음)
  { id: 'user_t3_ocs',  name: '오철석', role: 'driver', teamId: 'team3', password: 'jundo1234' },
  { id: 'user_t3_jty',  name: '전태영', role: 'driver', teamId: 'team3', password: 'jundo1234' },

  // 4팀 연수남 (팀장: 김민기)
  { id: 'user_t4_kmg',  name: '김민기', role: 'leader', teamId: 'team4', password: 'jundo1234' },
  { id: 'user_t4_cyh',  name: '최용혁', role: 'driver', teamId: 'team4', password: 'jundo1234' },
  { id: 'user_t4_lcm',  name: '이창목', role: 'driver', teamId: 'team4', password: 'jundo1234' },

  // 5팀 아가리 (팀장: 김종호)
  { id: 'user_t5_kjh',  name: '김종호', role: 'leader', teamId: 'team5', password: 'jundo1234' },
  { id: 'user_t5_cje',  name: '최준은', role: 'driver', teamId: 'team5', password: 'jundo1234' },
  { id: 'user_t5_gj',   name: '금정',   role: 'driver', teamId: 'team5', password: 'jundo1234' },

  // 6팀 도세마 (팀장 없음)
  { id: 'user_t6_jhc',  name: '조홍철', role: 'driver', teamId: 'team6', password: 'jundo1234' },
  { id: 'user_t6_kcy',  name: '김창연', role: 'driver', teamId: 'team6', password: 'jundo1234' },

  // 7팀 강서영 (팀장: 류대현)
  { id: 'user_t7_rdh',  name: '류대현', role: 'leader', teamId: 'team7', password: 'jundo1234' },
  { id: 'user_t7_lhj',  name: '이호주', role: 'driver', teamId: 'team7', password: 'jundo1234' },
  { id: 'user_t7_kdw',  name: '김동완', role: 'driver', teamId: 'team7', password: 'jundo1234' }
];

// =============================================================
// 삽입 함수들
// =============================================================

async function insertTeams() {
  console.log('\n--- 팀 데이터 삽입 ---');
  for (const team of teams) {
    const { id, ...data } = team;
    await db.collection('teams').doc(id).set(data);
    console.log(`  ✓ ${data.name} (${id}) - ${data.region}`);
  }
}

async function insertUsers() {
  console.log('\n--- 사용자 데이터 삽입 ---');
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
}

// =============================================================
// 메인 실행
// =============================================================
async function main() {
  console.log('====================================');
  console.log(' 준도시락 배송관리 초기 데이터 삽입');
  console.log('====================================');

  try {
    await insertTeams();
    await insertUsers();

    console.log('\n====================================');
    console.log(' ✅ 모든 초기 데이터 삽입 완료!');
    console.log('====================================');
    console.log('\n 초기 비밀번호: jundo1234');
    console.log(' 총 19명 기사 + 관리자 1명 = 20명');

  } catch (e) {
    console.error('\n❌ 오류 발생:', e);
  }

  process.exit(0);
}

main();
