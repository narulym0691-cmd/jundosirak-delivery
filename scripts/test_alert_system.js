const admin = require('firebase-admin');
const sa = require('/home/work/.openclaw/workspace/jundosirak-delivery-sa.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const { execSync } = require('child_process');

// 일일장부 파싱 (Python 호출)
function parseOrdersFromExcel(filename) {
  const result = execSync(`python3 << 'EOF'
import openpyxl
import json
wb = openpyxl.load_workbook('/home/work/.openclaw/workspace/upload/${filename}')
ws = wb['붙여넣기']
clients = set()
for row in ws.iter_rows(min_row=3, values_only=True):
    if not row or not row[0] or row[0] == 'No.': continue
    client = row[4] if len(row) > 4 else None
    if client: clients.add(client)
print(json.dumps(list(clients)))
EOF
`, { encoding: 'utf8' });
  return JSON.parse(result.trim());
}

// 요일 계산
function getDayOfWeek(dateStr) {
  const d = new Date(dateStr);
  const dow = d.getDay();  // 0=일 1=월 2=화 3=수 4=목 5=금 6=토
  return dow === 0 ? 6 : dow - 1;  // 0=월 1=화 2=수 3=목 4=금
}

async function testAlertSystem() {
  console.log('\n=== 경보 시스템 실전 테스트 ===\n');
  
  const dates = [
    { date: '2026-04-01', file: '일일장부_260401_1.xlsx' },
    { date: '2026-04-02', file: '일일장부_260402_1.xlsx' },
    { date: '2026-04-03', file: '일일장부_260403_1.xlsx' },
    { date: '2026-04-06', file: '일일장부_260406.xlsx' },  // 주말 제외
    { date: '2026-04-07', file: '일일장부_260407_2.xlsx' },
    { date: '2026-04-08', file: '일일장부_260408_2.xlsx' },
  ];
  
  // clients 컬렉션 로드
  const clientsSnap = await db.collection('clients').get();
  const clients = [];
  clientsSnap.forEach(d => clients.push({ id: d.id, ...d.data() }));
  
  console.log(`거래처 DB: ${clients.length}개\n`);
  
  for (const { date, file } of dates) {
    console.log(`\n--- ${date} (${['월','화','수','목','금','토','일'][getDayOfWeek(date)]}) ---`);
    
    try {
      // 일일장부 파싱
      const ordered = await parseOrdersFromExcel(file);
      console.log(`주문 거래처: ${ordered.length}개`);
      
      const orderedSet = new Set(ordered);
      const dowIndex = getDayOfWeek(date);
      
      // 주문해야 하는데 안 한 업체 찾기
      const alerts = [];
      
      for (const c of clients) {
        const orderDays = c.orderDays || [];
        const shouldOrder = orderDays.includes(dowIndex) || orderDays.includes(['월','화','수','목','금'][dowIndex]);
        
        if (!shouldOrder) continue;
        
        const didOrder = orderedSet.has(c.clientName);
        
        if (!didOrder) {
          const isPriority = (c.dailyAvgOrder || 0) >= 8;
          alerts.push({
            clientName: c.clientName,
            dailyAvgOrder: c.dailyAvgOrder,
            isPriority,
            courseId: c.courseId,
            teamId: c.teamId
          });
        }
      }
      
      const urgent = alerts.filter(a => a.isPriority);
      const watch = alerts.filter(a => !a.isPriority);
      
      console.log(`  🔴 즉시경보(8개↑): ${urgent.length}개`);
      console.log(`  🟡 주시(8개↓): ${watch.length}개`);
      
      if (urgent.length > 0) {
        console.log('\n  즉시경보 샘플 5개:');
        urgent.slice(0,5).forEach(a => {
          console.log(`    - ${a.clientName} (${a.dailyAvgOrder}개) ${a.courseId} ${a.teamId}`);
        });
      }
      
    } catch(e) {
      console.log(`  ⚠️ 오류: ${e.message}`);
    }
  }
  
  console.log('\n=== 테스트 완료 ===');
  process.exit(0);
}

testAlertSystem().catch(e => { console.error(e); process.exit(1); });
