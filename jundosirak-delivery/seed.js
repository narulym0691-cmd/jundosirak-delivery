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
const authAdmin = admin.auth();

// =============================================================
// 팀 데이터 7개
// =============================================================
const teams = [
  {
    id: 'team1',
    name: '송기정',
    baselineDailyAvg: 1957,
    gradeC: 2007,
    gradeB: 2037,
    gradeA: 2077
  },
  {
    id: 'team2',
    name: '해운대권',
    baselineDailyAvg: 2168,
    gradeC: 2218,
    gradeB: 2248,
    gradeA: 2288
  },
  {
    id: 'team3',
    name: '서면',
    baselineDailyAvg: 1396,
    gradeC: 1446,
    gradeB: 1476,
    gradeA: 1516
  },
  {
    id: 'team4',
    name: '수영',
    baselineDailyAvg: 2218,
    gradeC: 2268,
    gradeB: 2298,
    gradeA: 2338
  },
  {
    id: 'team5',
    name: '동래금정양산',
    baselineDailyAvg: 1937,
    gradeC: 1987,
    gradeB: 2017,
    gradeA: 2057
  },
  {
    id: 'team6',
    name: '사상북구',
    baselineDailyAvg: 1197,
    gradeC: 1247,
    gradeB: 1277,
    gradeA: 1317
  },
  {
    id: 'team7',
    name: '영도사하강서',
    baselineDailyAvg: 1842,
    gradeC: 1892,
    gradeB: 1922,
    gradeA: 1962
  }
];

// =============================================================
// 기사 19명 + 관리자 1명
// =============================================================
const users = [
  // 관리자
  { id: 'user_admin', name: '이영민', role: 'admin', teamId: null, courseId: null, shiftType: null, email: 'admin@jundosirak.com', active: true },

  // team1 - 송기정
  { id: 'user_t1_leader', name: '송기정', role: 'leader', teamId: 'team1', courseId: 'course_t1_1', shiftType: 'dawn', email: 'song@jundosirak.com', active: true },
  { id: 'user_t1_d1', name: '김민준', role: 'driver', teamId: 'team1', courseId: 'course_t1_2', shiftType: 'dawn', email: 'minjun@jundosirak.com', active: true },
  { id: 'user_t1_d2', name: '박현우', role: 'driver', teamId: 'team1', courseId: 'course_t1_3', shiftType: 'morning', email: 'hyunwoo@jundosirak.com', active: true },

  // team2 - 해운대권
  { id: 'user_t2_leader', name: '표창훈', role: 'leader', teamId: 'team2', courseId: 'course_t2_1', shiftType: 'dawn', email: 'pyo@jundosirak.com', active: true },
  { id: 'user_t2_d1', name: '최준서', role: 'driver', teamId: 'team2', courseId: 'course_t2_2', shiftType: 'dawn', email: 'junseo@jundosirak.com', active: true },
  { id: 'user_t2_d2', name: '이도윤', role: 'driver', teamId: 'team2', courseId: 'course_t2_3', shiftType: 'morning', email: 'doyun@jundosirak.com', active: true },

  // team3 - 서면
  { id: 'user_t3_leader', name: '정서연', role: 'leader', teamId: 'team3', courseId: 'course_t3_1', shiftType: 'dawn', email: 'seoyeon@jundosirak.com', active: true },
  { id: 'user_t3_d1', name: '한지호', role: 'driver', teamId: 'team3', courseId: 'course_t3_2', shiftType: 'morning', email: 'jiho@jundosirak.com', active: true },

  // team4 - 수영
  { id: 'user_t4_leader', name: '강태양', role: 'leader', teamId: 'team4', courseId: 'course_t4_1', shiftType: 'dawn', email: 'taeyang@jundosirak.com', active: true },
  { id: 'user_t4_d1', name: '윤서준', role: 'driver', teamId: 'team4', courseId: 'course_t4_2', shiftType: 'dawn', email: 'seojun@jundosirak.com', active: true },
  { id: 'user_t4_d2', name: '임예준', role: 'driver', teamId: 'team4', courseId: 'course_t4_3', shiftType: 'morning', email: 'yejun@jundosirak.com', active: true },

  // team5 - 동래금정양산
  { id: 'user_t5_leader', name: '오민재', role: 'leader', teamId: 'team5', courseId: 'course_t5_1', shiftType: 'dawn', email: 'minjae@jundosirak.com', active: true },
  { id: 'user_t5_d1', name: '장시우', role: 'driver', teamId: 'team5', courseId: 'course_t5_2', shiftType: 'morning', email: 'siwoo@jundosirak.com', active: true },
  { id: 'user_t5_d2', name: '신준혁', role: 'driver', teamId: 'team5', courseId: 'course_t5_3', shiftType: 'dawn', email: 'junhyuk@jundosirak.com', active: true },

  // team6 - 사상북구
  { id: 'user_t6_leader', name: '권하린', role: 'leader', teamId: 'team6', courseId: 'course_t6_1', shiftType: 'dawn', email: 'harin@jundosirak.com', active: true },
  { id: 'user_t6_d1', name: '배재원', role: 'driver', teamId: 'team6', courseId: 'course_t6_2', shiftType: 'morning', email: 'jaewon@jundosirak.com', active: true },

  // team7 - 영도사하강서
  { id: 'user_t7_leader', name: '문성빈', role: 'leader', teamId: 'team7', courseId: 'course_t7_1', shiftType: 'dawn', email: 'sungbin@jundosirak.com', active: true },
  { id: 'user_t7_d1', name: '류지훈', role: 'driver', teamId: 'team7', courseId: 'course_t7_2', shiftType: 'dawn', email: 'jihoon@jundosirak.com', active: true },
  { id: 'user_t7_d2', name: '서민호', role: 'driver', teamId: 'team7', courseId: 'course_t7_3', shiftType: 'morning', email: 'minho@jundosirak.com', active: true }
];

// 초기 비밀번호
const DEFAULT_PASSWORD = 'jundo1234!';

// =============================================================
// 더미 월간 통계 (2026-04)
// 영업일 기준: 4월 1~3일 = 3일 경과
// =============================================================
const bizDaysPassed = 3;

const monthlyStats = {
  team1: {
    cumulativeTotal: 1957 * bizDaysPassed + 120,
    baselineCumulative: 1957 * bizDaysPassed,
    dailyAvgDiff: 40,
    grade: 'B'
  },
  team2: {
    cumulativeTotal: 2168 * bizDaysPassed + 280,
    baselineCumulative: 2168 * bizDaysPassed,
    dailyAvgDiff: 93,
    grade: 'A'
  },
  team3: {
    cumulativeTotal: 1396 * bizDaysPassed - 60,
    baselineCumulative: 1396 * bizDaysPassed,
    dailyAvgDiff: -20,
    grade: '기준미달'
  },
  team4: {
    cumulativeTotal: 2218 * bizDaysPassed + 180,
    baselineCumulative: 2218 * bizDaysPassed,
    dailyAvgDiff: 60,
    grade: 'B'
  },
  team5: {
    cumulativeTotal: 1937 * bizDaysPassed + 90,
    baselineCumulative: 1937 * bizDaysPassed,
    dailyAvgDiff: 30,
    grade: 'C'
  },
  team6: {
    cumulativeTotal: 1197 * bizDaysPassed + 150,
    baselineCumulative: 1197 * bizDaysPassed,
    dailyAvgDiff: 50,
    grade: 'B'
  },
  team7: {
    cumulativeTotal: 1842 * bizDaysPassed - 30,
    baselineCumulative: 1842 * bizDaysPassed,
    dailyAvgDiff: -10,
    grade: '기준미달'
  }
};

// =============================================================
// 더미 거래처 경보
// =============================================================
const alerts = [
  {
    clientName: '해운대병원',
    courseId: 'course_t2_1',
    driverId: 'user_t2_leader',
    level: 'urgent',
    consecutiveDays: 3,
    lastOrderDate: admin.firestore.Timestamp.fromDate(new Date('2026-04-01')),
    isPriority: true
  },
  {
    clientName: '좋은아침식당',
    courseId: 'course_t2_2',
    driverId: 'user_t2_d1',
    level: 'watch',
    consecutiveDays: 2,
    lastOrderDate: admin.firestore.Timestamp.fromDate(new Date('2026-04-02')),
    isPriority: false
  },
  {
    clientName: '서면빌딩',
    courseId: 'course_t3_1',
    driverId: 'user_t3_leader',
    level: 'check',
    consecutiveDays: 1,
    lastOrderDate: admin.firestore.Timestamp.fromDate(new Date('2026-04-02')),
    isPriority: false
  },
  {
    clientName: '수영구청',
    courseId: 'course_t4_1',
    driverId: 'user_t4_leader',
    level: 'urgent',
    consecutiveDays: 2,
    lastOrderDate: admin.firestore.Timestamp.fromDate(new Date('2026-04-01')),
    isPriority: true
  },
  {
    clientName: '동래시장',
    courseId: 'course_t5_2',
    driverId: 'user_t5_d1',
    level: 'watch',
    consecutiveDays: 1,
    lastOrderDate: admin.firestore.Timestamp.fromDate(new Date('2026-04-02')),
    isPriority: false
  }
];

// =============================================================
// 더미 지시사항
// =============================================================
const directives = [
  {
    targetTeams: [],  // 전체
    content: '복장 단정 유지 및 위생 마스크 착용 필수',
    deadline: admin.firestore.Timestamp.fromDate(new Date('2026-04-30')),
    createdAt: admin.firestore.Timestamp.fromDate(new Date('2026-04-01')),
    completions: {}
  },
  {
    targetTeams: ['team2', 'team4'],
    content: '배송 완료 후 반드시 실시간 보고 앱 입력할 것',
    deadline: admin.firestore.Timestamp.fromDate(new Date('2026-04-10')),
    createdAt: admin.firestore.Timestamp.fromDate(new Date('2026-04-02')),
    completions: {}
  },
  {
    targetTeams: ['team1', 'team3', 'team5'],
    content: '신규 거래처 방문 시 명함 전달 및 담당자 이름 기록',
    deadline: admin.firestore.Timestamp.fromDate(new Date('2026-04-15')),
    createdAt: admin.firestore.Timestamp.fromDate(new Date('2026-04-03')),
    completions: {}
  }
];

// =============================================================
// 삽입 함수들
// =============================================================

async function insertTeams() {
  console.log('\n--- 팀 데이터 삽입 ---');
  for (const team of teams) {
    const { id, ...data } = team;
    data.members = [];  // 기사 등록 후 업데이트 가능
    await db.collection('teams').doc(id).set(data);
    console.log(`  ✓ ${data.name} (${id})`);
  }
}

async function insertUsers() {
  console.log('\n--- 사용자 데이터 삽입 (Firebase Auth + Firestore) ---');
  for (const user of users) {
    const { id, email, ...firestoreData } = user;

    try {
      // Firebase Auth 계정 생성
      let authUser;
      try {
        authUser = await authAdmin.getUserByEmail(email);
        console.log(`  ↺ 기존 Auth 계정 사용: ${email}`);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          authUser = await authAdmin.createUser({
            email: email,
            password: DEFAULT_PASSWORD,
            displayName: user.name
          });
          console.log(`  ✓ Auth 계정 생성: ${email}`);
        } else {
          throw e;
        }
      }

      // Firestore 사용자 문서 (문서 ID = 지정 ID)
      await db.collection('users').doc(id).set({
        ...firestoreData,
        email: email,
        authUid: authUser.uid,
        passwordHash: ''
      });
      console.log(`  ✓ Firestore 저장: ${user.name} (${user.role})`);

    } catch (e) {
      console.error(`  ✗ 실패 [${user.name}]: ${e.message}`);
    }
  }
}

async function insertMonthlyStats() {
  console.log('\n--- 월간 통계 삽입 (2026-04) ---');
  await db.collection('monthly_stats').doc('2026-04').set(monthlyStats);
  console.log('  ✓ monthly_stats/2026-04 저장 완료');
}

async function insertAlerts() {
  console.log('\n--- 거래처 경보 삽입 ---');
  for (const alert of alerts) {
    const ref = await db.collection('alerts').add(alert);
    console.log(`  ✓ ${alert.clientName} (${alert.level}) - ${ref.id}`);
  }
}

async function insertDirectives() {
  console.log('\n--- 지시사항 삽입 ---');
  for (const dir of directives) {
    const ref = await db.collection('directives').add(dir);
    const target = dir.targetTeams.length === 0 ? '전체' : dir.targetTeams.join(', ');
    console.log(`  ✓ [${target}] ${dir.content.slice(0, 20)}... - ${ref.id}`);
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
    await insertMonthlyStats();
    await insertAlerts();
    await insertDirectives();

    console.log('\n====================================');
    console.log(' ✅ 모든 초기 데이터 삽입 완료!');
    console.log('====================================');
    console.log(`\n 초기 비밀번호: ${DEFAULT_PASSWORD}`);
    console.log(' (배포 후 각 기사에게 비밀번호 변경 안내)');

  } catch (e) {
    console.error('\n❌ 오류 발생:', e);
  }

  process.exit(0);
}

main();
