const admin = require('firebase-admin');
const sa = require('/home/work/.openclaw/workspace/jundosirak-delivery-sa.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const fs = require('fs');

// 요일 맵
const DAY_MAP = { 월:0, 화:1, 수:2, 목:3, 금:4 };

async function checkAlerts(dateStr) {
  const date = new Date(dateStr);
  const dow = date.getDay();  // 0=일 1=월 2=화 3=수 4=목 5=금 6=토
  const dowIndex = dow === 0 ? 6 : dow - 1;  // 0=월 1=화 2=수 3=목 4=금
  
  console.log(`\n=== ${dateStr} (${['월','화','수','목','금','토','일'][dowIndex]}) 경보 체크 ===`);
  
  // 해당 날짜 주문 거래처 목록 (일일장부에서 파싱한 것 사용)
  const orderedFile = `/tmp/clients_${dateStr.replace(/-/g,'').slice(4)}.txt`;
  if (!fs.existsSync(orderedFile)) {
    console.log(`${orderedFile} 파일 없음`);
    return;
  }
  const ordered = new Set(fs.readFileSync(orderedFile, 'utf8').trim().split('\n'));
  
  // 전체 거래처 조회
  const clients = await db.collection('clients').get();
  const alertList = [];
  
  for (const doc of clients.docs) {
    const c = doc.data();
    const orderDays = c.orderDays || [];
    
    // 오늘이 주문 요일인지 확인
    const shouldOrder = orderDays.includes(dowIndex) || orderDays.includes(['월','화','수','목','금'][dowIndex]);
    
    if (!shouldOrder) continue;  // 주문 요일 아니면 skip
    
    // 오늘 주문 여부
    const didOrder = ordered.has(c.clientName);
    
    if (!didOrder) {
      // 경보 생성 대상
      const isPriority = c.dailyAvgOrder >= 8;
      const level = isPriority ? 'urgent' : 'watch';
      const type = isPriority ? 'immediate' : 'consecutive';
      
      alertList.push({
        clientId: doc.id,
        clientName: c.clientName,
        courseId: c.courseId,
        teamId: c.teamId,
        level,
        type,
        dailyAvgOrder: c.dailyAvgOrder,
        consecutiveDays: 1,  // 실제로는 이전 기록 확인해야 하지만 일단 1일로
        resolved: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        date: dateStr
      });
    }
  }
  
  console.log(`\n미주문 업체: ${alertList.length}개`);
  console.log(`  - 즉시경보(8개↑): ${alertList.filter(a=>a.level==='urgent').length}개`);
  console.log(`  - 주시(8개↓): ${alertList.filter(a=>a.level==='watch').length}개`);
  
  // 샘플 10개
  console.log('\n샘플 10개:');
  alertList.slice(0,10).forEach(a => {
    console.log(`  ${a.level==='urgent'?'🔴':'🟡'} ${a.clientName} (${a.dailyAvgOrder}개) - ${a.courseId} ${a.teamId}`);
  });
  
  // Firestore alerts 저장 (dry-run 아니면 주석 해제)
  // const batch = db.batch();
  // alertList.forEach(a => {
  //   const ref = db.collection('alerts').doc();
  //   batch.set(ref, a);
  // });
  // await batch.commit();
  // console.log(`\n✅ alerts 컬렉션에 ${alertList.length}건 저장 완료`);
  
  return alertList;
}

async function main() {
  const alerts = await checkAlerts('2026-04-08');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
