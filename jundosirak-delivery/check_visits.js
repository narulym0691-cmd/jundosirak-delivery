const admin = require('firebase-admin');
const sa = require('./jundosirak-delivery-sa.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

(async () => {
  // 최근 신규 영업 가져오기
  const snap = await db.collection('field_visits')
    .where('visitType', '==', 'new_sales')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();
  console.log('field_visits (new_sales) 최근 5건:');
  snap.docs.forEach((d, i) => {
    const v = d.data();
    console.log(`\n[${i+1}] doc: ${d.id}`);
    console.log('  - driverName:', v.driverName);
    console.log('  - clientName:', JSON.stringify(v.clientName));
    console.log('  - companyName:', JSON.stringify(v.companyName));
    console.log('  - name:', JSON.stringify(v.name));
    console.log('  - placeName:', JSON.stringify(v.placeName));
    console.log('  - 전체 필드:', Object.keys(v).join(', '));
  });
  
  // jundosirak_new businessLine 도 확인
  console.log('\n=== businessLine=jundosirak_new 최근 5건 ===');
  const snap2 = await db.collection('field_visits')
    .where('businessLine', '==', 'jundosirak_new')
    .orderBy('createdAt', 'desc')
    .limit(5)
    .get();
  snap2.docs.forEach((d, i) => {
    const v = d.data();
    console.log(`\n[${i+1}] doc: ${d.id}`);
    console.log('  - driverName:', v.driverName);
    console.log('  - visitType:', v.visitType);
    console.log('  - businessLine:', v.businessLine);
    console.log('  - clientName:', JSON.stringify(v.clientName));
    console.log('  - 전체 필드:', Object.keys(v).join(', '));
  });
  process.exit(0);
})();
