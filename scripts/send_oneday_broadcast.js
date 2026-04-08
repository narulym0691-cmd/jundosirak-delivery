const admin = require('firebase-admin');
const sa = require('/home/work/.openclaw/workspace/jundosirak-delivery-sa.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// 내일 날짜 (KST 기준)
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = tomorrow.toISOString().slice(0,10);

console.log(`\n=== 내일(${tomorrowStr}) 전체 문자 발송 준비 ===\n`);

async function main() {
  // 1. 전체 기사 조회
  const usersSnap = await db.collection('users')
    .where('role', 'in', ['driver','leader'])
    .where('active', '==', true)
    .get();
  
  const drivers = [];
  usersSnap.forEach(d => drivers.push(d.data()));
  
  console.log(`대상 기사: ${drivers.length}명\n`);
  
  // 2. 내일 경보 예상 업체 조회 (오늘 일일장부 기준)
  // 실제로는 내일 새벽 4:30에 실행되므로 "오늘" 경보를 가져옴
  // 테스트용으로는 4/8 데이터 사용
  
  const testDate = '2026-04-08';
  const { execSync } = require('child_process');
  
  // 오늘 주문 거래처 파싱
  const orderedResult = execSync(`python3 << 'EOF'
import openpyxl
import json
wb = openpyxl.load_workbook('/home/work/.openclaw/workspace/upload/일일장부_260408_2.xlsx')
ws = wb['붙여넣기']
clients = set()
for row in ws.iter_rows(min_row=3, values_only=True):
    if not row or not row[0] or row[0] == 'No.': continue
    client = row[4] if len(row) > 4 else None
    if client: clients.add(client)
print(json.dumps(list(clients)))
EOF
`, { encoding: 'utf8' });
  
  const ordered = new Set(JSON.parse(orderedResult.trim()));
  
  // 3. clients 컬렉션에서 8개 이상 업체 조회
  const clientsSnap = await db.collection('clients').get();
  const clients = [];
  clientsSnap.forEach(d => clients.push(d.data()));
  
  const priorityClients = clients.filter(c => (c.dailyAvgOrder || 0) >= 8);
  
  // 4. 오늘(수요일=2) 주문 요일인데 미주문 업체 찾기
  const dowIndex = 2;  // 수요일
  const alerts = [];
  
  for (const c of priorityClients) {
    const orderDays = c.orderDays || [];
    const shouldOrder = orderDays.includes(dowIndex);
    
    if (shouldOrder && !ordered.has(c.clientName)) {
      alerts.push({
        clientName: c.clientName,
        dailyAvgOrder: c.dailyAvgOrder,
        courseId: c.courseId,
        teamId: c.teamId
      });
    }
  }
  
  console.log(`경보 대상 업체: ${alerts.length}개\n`);
  
  // 5. 기사별 경보 그룹핑
  const alertsByTeam = {};
  alerts.forEach(a => {
    if (!alertsByTeam[a.teamId]) alertsByTeam[a.teamId] = [];
    alertsByTeam[a.teamId].push(a);
  });
  
  // 6. sms_schedule에 적재
  let count = 0;
  for (const driver of drivers) {
    const driverName = driver.name;
    const teamId = driver.teamId;
    const phone = driver.phone;
    
    if (!phone) {
      console.log(`⚠️ ${driverName}: 전화번호 없음`);
      continue;
    }
    
    // 경보 내용
    const teamAlerts = alertsByTeam[teamId] || [];
    let alertText = '';
    if (teamAlerts.length > 0) {
      alertText = teamAlerts.slice(0,3).map(a => 
        `${a.clientName}(${a.dailyAvgOrder}개) 오늘 주문 없습니다.`
      ).join('\n');
      if (teamAlerts.length > 3) {
        alertText += `\n외 ${teamAlerts.length - 3}건`;
      }
      alertText += '\n확인 부탁드립니다.\n';
    } else {
      alertText = '오늘도 안전운전하세요!\n';
    }
    
    // 메시지 본문 (날씨 인사말은 함수에서 자동 추가)
    const message = `${alertText}\n배송관리 시스템 사용 잘 부탁드립니다.\nhttps://jundosirak-delivery.web.app\n이영민 올림`;
    
    await db.collection('sms_schedule').add({
      type: 'broadcast_0409',
      date: tomorrowStr,
      driverName,
      teamId,
      phone,
      message,
      sent: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    count++;
    console.log(`✅ ${driverName} (${teamId}) — 경보 ${teamAlerts.length}건`);
  }
  
  console.log(`\n=== 완료: ${count}건 적재 ===`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
