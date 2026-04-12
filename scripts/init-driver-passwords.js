/**
 * init-driver-passwords.js
 *
 * 기존 기사(role='driver' 또는 role='leader') 전원의 password 필드를
 * 'jundo1234' 로 초기화하고, role이 없거나 불명확한 경우 'driver' 로 설정합니다.
 *
 * 실행: node scripts/init-driver-passwords.js
 */

const admin = require('firebase-admin');

const DEFAULT_PASSWORD = 'jundo1234';

// Firebase Admin 초기화 (seed.js와 동일한 방식)
const serviceAccount = require('../jundosirak-delivery-sa.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'jundosirak-delivery'
});

const db = admin.firestore();

// 기존 기사 19명 목록 (이름 기준 확인용)
const KNOWN_DRIVERS = [
  '유상하', '이진우', '박인수',
  '표창훈', '안준수', '이근일',
  '오철석', '전태영',
  '김민기', '최용혁', '이창목',
  '김종호', '최준은', '금정',
  '조홍철', '김창연',
  '류대현', '이호주', '김동완',
];

async function run() {
  console.log('=== 기사 비밀번호 초기화 시작 ===\n');

  const snapshot = await db.collection('users').get();
  const batch    = db.batch();
  let   updated  = 0;
  let   skipped  = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    const role = data.role;
    const name = data.name || '(이름없음)';

    // admin/manager는 스킵
    if (role === 'admin' || role === 'manager') {
      console.log(`⏭  SKIP  [${name}] role=${role}`);
      skipped++;
      return;
    }

    // driver 또는 leader, 또는 role 없는 경우
    const updates = {};

    // role 설정: leader는 유지, 나머지는 driver
    if (!role || (role !== 'driver' && role !== 'leader')) {
      updates.role = 'driver';
      console.log(`  → role 변경: ${role || '(없음)'} → driver`);
    }

    // password 항상 초기화
    updates.password = DEFAULT_PASSWORD;

    batch.update(doc.ref, updates);
    console.log(`✅ 업데이트 [${name}] role=${updates.role || role} password=jundo1234`);
    updated++;
  });

  if (updated === 0) {
    console.log('\n업데이트할 항목이 없습니다.');
    process.exit(0);
  }

  await batch.commit();

  console.log(`\n=== 완료 ===`);
  console.log(`✅ 업데이트: ${updated}명`);
  console.log(`⏭  스킵:     ${skipped}명`);
  console.log(`\n기사 초기 비밀번호: ${DEFAULT_PASSWORD}`);

  process.exit(0);
}

run().catch(err => {
  console.error('❌ 오류 발생:', err);
  process.exit(1);
});
