// 과거 일일장부 데이터 기반 경보 재생성 스크립트
const admin = require('firebase-admin');
const sa = require('/home/work/.openclaw/workspace/jundosirak-delivery-sa.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

async function createAlerts(date, orderedClients, existingAlerts) {
  // existingAlerts: 이미 로드된 모든 경보 (Map: clientName → alert[])
  const ordered = new Set(orderedClients);
  const dow = new Date(date).getDay();
  const dowIndex = dow === 0 ? 6 : dow - 1;

  const clientsSnap = await db.collection('clients').get();
  let alertCount = 0, urgentCnt = 0, watchCnt = 0, checkCnt = 0;
  const newAlerts = [];

  for (const doc of clientsSnap.docs) {
    const c = doc.data();
    const { clientName, orderDays, dailyAvgOrder, teamId, courseId } = c;
    if (!orderDays || !Array.isArray(orderDays)) continue;
    if (!orderDays.includes(dowIndex)) continue;
    if (ordered.has(clientName)) continue;

    // 중복체크 (메모리에서)
    const clientAlerts = existingAlerts.get(clientName) || [];
    if (clientAlerts.some(a => a.date === date)) continue;

    const isPriority = (dailyAvgOrder || 0) >= 8;

    if (isPriority) {
      const alertData = {
        type: 'no_order', grade: 'urgent', isPriority: true,
        clientName, dailyAvgOrder, teamId, courseId, date,
        consecutiveDays: 1, resolved: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      await db.collection('alerts').add(alertData);
      newAlerts.push({ ...alertData, createdAt: { _seconds: 0 } });
      alertCount++; urgentCnt++;
    } else {
      // 이전 미주문 기록 찾기 (grade=none 포함, 메모리에서)
      const prevRecord = clientAlerts
        .filter(a => a.date < date)
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      let consecutiveDays = prevRecord ? (prevRecord.consecutiveDays || 1) + 1 : 1;

      if (consecutiveDays < 2) {
        // 1일째 → 경보 없지만 미주문 기록 저장 (연속일수 추적용)
        const trackData = {
          type: 'no_order', grade: 'none', isPriority: false,
          clientName, dailyAvgOrder, teamId, courseId, date,
          consecutiveDays: 1, resolved: true, // 화면에 안 보이게
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await db.collection('alerts').add(trackData);
        newAlerts.push({ ...trackData, createdAt: { _seconds: 0 } });
        continue;
      }

      const grade = consecutiveDays >= 3 ? 'check' : 'watch';
      const alertData = {
        type: 'no_order', grade, isPriority: false,
        clientName, dailyAvgOrder, teamId, courseId, date,
        consecutiveDays, resolved: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      };
      await db.collection('alerts').add(alertData);
      newAlerts.push({ ...alertData, createdAt: { _seconds: 0 } });
      alertCount++;
      if (grade === 'watch') watchCnt++;
      else checkCnt++;
    }
  }

  // 새로 생성된 경보를 existingAlerts에 추가
  for (const a of newAlerts) {
    if (!existingAlerts.has(a.clientName)) existingAlerts.set(a.clientName, []);
    existingAlerts.get(a.clientName).push(a);
  }

  return { alertCount, urgentCnt, watchCnt, checkCnt };
}

async function main() {
  // 날짜 순서대로 처리 (연속일수 누적 정확히 계산하기 위해)
  const salesSnap = await db.collection('daily_sales').orderBy('date').get();
  const dates = [];
  salesSnap.forEach(doc => {
    if (doc.data().orderedClients && doc.data().orderedClients.length > 0) {
      dates.push({ date: doc.id, orderedClients: doc.data().orderedClients });
    }
  });

  console.log('처리할 날짜:', dates.map(d => d.date).join(', '));

  // 기존 경보 전체 메모리 로드 (clientName → alert[])
  const allAlertsSnap = await db.collection('alerts').get();
  const existingAlerts = new Map();
  allAlertsSnap.forEach(doc => {
    const a = { id: doc.id, ...doc.data() };
    if (!existingAlerts.has(a.clientName)) existingAlerts.set(a.clientName, []);
    existingAlerts.get(a.clientName).push(a);
  });
  console.log('기존 경보 로드:', allAlertsSnap.size, '건');

  for (const { date, orderedClients } of dates) {
    const result = await createAlerts(date, orderedClients, existingAlerts);
    console.log(`${date} | 총 ${result.alertCount}건 생성 (즉시경보:${result.urgentCnt} 주시:${result.watchCnt} 확인보고:${result.checkCnt})`);
  }

  // 최종 집계
  const alertSnap = await db.collection('alerts').get();
  let urgent = 0, watch = 0, check = 0;
  alertSnap.forEach(d => {
    const g = d.data().grade;
    if (g === 'urgent') urgent++;
    else if (g === 'watch') watch++;
    else check++;
  });
  console.log('\n=== 최종 경보 현황 ===');
  console.log(`즉시경보: ${urgent} / 주시: ${watch} / 확인보고: ${check} / 합계: ${urgent + watch + check}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('ERR:', e.message); process.exit(1); });
