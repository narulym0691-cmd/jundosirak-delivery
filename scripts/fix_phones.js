/**
 * 기사 전화번호 정규화 스크립트
 * - 모든 phone 필드를 010-XXXX-XXXX 형식으로 통일
 */
const admin = require('firebase-admin');
const sa = require('/home/work/.openclaw/workspace/jundosirak-delivery-sa.json');

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// 엑셀에서 가져온 정확한 번호 목록
const PHONE_MAP = {
  '고상우': '010-3636-9730',
  '조홍철': '010-7534-0307',
  '김대호': '010-2928-6635',
  '유상하': '010-6336-6921',
  '박인수': '010-8311-4708',
  '류대현': '010-3884-4723',
  '이진우': '010-6308-7498',
  '표창훈': '010-8895-9778',
  '최용혁': '010-2405-0282',
  '최준은': '010-2823-2558',
  '안준수': '010-2683-9633',
  '김민기': '010-3133-8642',
  '전태영': '010-3745-6661',
  '김종호': '010-4445-8849',
  '이호주': '010-6296-1917',
  '이근일': '010-2728-4437',
  '김동완': '010-2225-9220',
  '이창목': '010-6283-0084',
  '오철석': '010-9335-3726',
  '김창연': '010-4818-9335',
};

async function main() {
  const snap = await db.collection('users').get();
  const batch = db.batch();
  let updated = 0;

  snap.forEach(doc => {
    const data = doc.data();
    const name = data.name;
    const correctPhone = PHONE_MAP[name];

    if (correctPhone && data.phone !== correctPhone) {
      console.log(`✅ ${name}: ${data.phone || '없음'} → ${correctPhone}`);
      batch.update(doc.ref, { phone: correctPhone });
      updated++;
    } else if (correctPhone) {
      console.log(`✔  ${name}: ${data.phone} (이미 정확)`);
    } else {
      console.log(`⚠️  ${name}: 번호 목록에 없음 (현재: ${data.phone || '없음'})`);
    }
  });

  if (updated > 0) {
    await batch.commit();
    console.log(`\n총 ${updated}건 업데이트 완료`);
  } else {
    console.log('\n업데이트할 항목 없음');
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
