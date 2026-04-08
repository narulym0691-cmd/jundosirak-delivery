/**
 * 4월 1일 이후 신규업체 sms_schedule 소급 적재 스크립트
 * - 구글시트 신규업체 21건 → sms_schedule + clients.firstOrderDate 업데이트
 */
const admin = require('firebase-admin');
const sa = require('/home/work/.openclaw/workspace/jundosirak-delivery-sa.json');
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();

// 기사명 → courseId 매핑 (MEMORY 기준)
const DRIVER_COURSE = {
  '표창훈':  '코스1',
  '박인수':  '코스6',  // 송정
  '안준수':  '코스7',
  '김민기':  '코스3',
  '최용혁':  '코스8',
  '이창목':  '코스13',
  '오철석':  '코스4',
  '전태영':  '코스15',
  '이진우':  '코스5',
  '송정':    '코스6',
  '유상하':  '코스9',
  '금정':    '코스10',
  '김종호':  '코스16',
  '최준은':  '코스18',
  '이호주':  '코스11',
  '김창연':  '코스12',
  '조홍철':  '코스19',
  '김동완':  '코스14',
  '류대현':  '코스17',
};

const COURSE_TEAM_MAP = {
  '코스1':  { teamId: 'team2', teamName: '해운대' },
  '코스2':  { teamId: 'team2', teamName: '해운대' },
  '코스3':  { teamId: 'team4', teamName: '연수남' },
  '코스4':  { teamId: 'team3', teamName: '공오일(051)' },
  '코스5':  { teamId: 'team1', teamName: '준고' },
  '코스6':  { teamId: 'team1', teamName: '준고' },
  '코스7':  { teamId: 'team2', teamName: '해운대' },
  '코스8':  { teamId: 'team4', teamName: '연수남' },
  '코스9':  { teamId: 'team1', teamName: '준고' },
  '코스10': { teamId: 'team5', teamName: '아가리' },
  '코스11': { teamId: 'team7', teamName: '강서영' },
  '코스12': { teamId: 'team6', teamName: '도세마' },
  '코스13': { teamId: 'team4', teamName: '연수남' },
  '코스14': { teamId: 'team7', teamName: '강서영' },
  '코스15': { teamId: 'team3', teamName: '공오일(051)' },
  '코스16': { teamId: 'team5', teamName: '아가리' },
  '코스17': { teamId: 'team7', teamName: '강서영' },
  '코스18': { teamId: 'team5', teamName: '아가리' },
  '코스19': { teamId: 'team6', teamName: '도세마' },
};

// 구글시트에서 파싱한 4월 신규업체 21건
const NEW_CLIENTS = [
  { date: '2026-04-01', name: '미앤미의원센텀시티점',            driver: '박인수',  qty: 6,  menu: '뜨근한식' },
  { date: '2026-04-01', name: '아이젠트리안경 제니스',            driver: '박인수',  qty: 3,  menu: '뜨근한식' },
  { date: '2026-04-01', name: '주식회사 태성통신부산점',          driver: '김민기',  qty: 5,  menu: '뜨근한식' },
  { date: '2026-04-01', name: '코지이비인후과_해운대구',          driver: '안준수',  qty: 16, menu: '뜨근한식' },
  { date: '2026-04-01', name: '폰픽대연점',                      driver: '최용혁',  qty: 3,  menu: '뜨근한식' },
  { date: '2026-04-01', name: '경희홍익한의원_사하구',            driver: '이호주',  qty: 6,  menu: '뜨근한식' },
  { date: '2026-04-01', name: '열차폰 구포점',                   driver: '김창연',  qty: 4,  menu: '뜨근한식' },
  { date: '2026-04-01', name: '더부산_영도구',                   driver: '김동완',  qty: 12, menu: '뜨근한식' },
  { date: '2026-04-01', name: '부산금정영업소',                  driver: '최준은',  qty: 12, menu: '뜨근한식' },
  { date: '2026-04-02', name: '에스클래스짐_부산진구',            driver: '김민기',  qty: 3,  menu: '뜨근한식' },
  { date: '2026-04-03', name: '행복나눔_해운대구',               driver: '표창훈',  qty: 2,  menu: '뜨근한식' },
  { date: '2026-04-03', name: '삼대한의원_사상구',               driver: '김창연',  qty: 4,  menu: '뜨근한식' },
  { date: '2026-04-03', name: '주식회사 미진미트_사상구',         driver: '조홍철',  qty: 4,  menu: '뜨근한식' },
  { date: '2026-04-06', name: '자아연에스테틱_해운대구',          driver: '박인수',  qty: 2,  menu: '뜨근한식' },
  { date: '2026-04-06', name: '그루조경',                        driver: '박인수',  qty: 11, menu: '뜨근한식' },
  { date: '2026-04-06', name: '김민서치과의원_부산진구',          driver: '오철석',  qty: 7,  menu: '뜨근한식' },
  { date: '2026-04-06', name: '펜톤나인 더 테라스 송정1호점',    driver: '송정',    qty: 3,  menu: '뜨근한식' },
  { date: '2026-04-06', name: '두산위브더제니스오션시티 관리사무소', driver: '최용혁', qty: 9, menu: '뜨근한식' },
  { date: '2026-04-07', name: '열차폰 사상점',                   driver: '김창연',  qty: 3,  menu: '뜨근한식' },
  { date: '2026-04-07', name: '케이티_동구',                     driver: '오철석',  qty: 5,  menu: '뜨근한식' },
  { date: '2026-04-08', name: '부영연립_남구',                   driver: '최용혁',  qty: 2,  menu: '뜨근한식' },
];

async function main() {
  // 기존 clients 이름 목록 (매핑용)
  const clientsSnap = await db.collection('clients').get();
  const clientsMap = {};
  clientsSnap.forEach(doc => {
    const d = doc.data();
    clientsMap[d.clientName] = { id: doc.id, ref: doc.ref, data: d };
  });

  const batch = db.batch();
  let schedCount = 0;
  let clientUpdateCount = 0;
  let newClientCount = 0;

  for (const c of NEW_CLIENTS) {
    const courseId = DRIVER_COURSE[c.driver];
    if (!courseId) {
      console.log(`⚠️  기사 코스 매핑 없음: ${c.driver} (${c.name})`);
      continue;
    }
    const teamInfo = COURSE_TEAM_MAP[courseId];

    // 1. sms_schedule 적재
    const schedRef = db.collection('sms_schedule').doc();
    batch.set(schedRef, {
      type: 'new_client',
      date: c.date,
      courseId,
      driverName: c.driver,
      clientName: c.name,
      menu: c.menu,
      quantity: c.qty,
      teamId: teamInfo.teamId,
      teamName: teamInfo.teamName,
      sent: false,
      retroactive: true, // 소급 적재 표시
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    schedCount++;

    // 2. clients 컬렉션 업데이트 or 신규 생성
    if (clientsMap[c.name]) {
      // 기존 업체 → firstOrderDate 업데이트
      batch.update(clientsMap[c.name].ref, {
        firstOrderDate: c.date,
        isNew: true,
      });
      clientUpdateCount++;
      console.log(`✅ clients 업데이트: ${c.name} (${c.date})`);
    } else {
      // clients에 없는 신규 업체 → 새로 추가
      const newRef = db.collection('clients').doc();
      batch.set(newRef, {
        clientName: c.name,
        courseId,
        teamId: teamInfo.teamId,
        isPriority: false,
        isNew: true,
        firstOrderDate: c.date,
        orderDays: [0,1,2,3,4],
        dayLabels: ['월','화','수','목','금'],
        dailyAvgOrder: c.qty,
        memo: '구글시트 소급 등록',
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      newClientCount++;
      console.log(`➕ clients 신규 추가: ${c.name} (${c.date})`);
    }

    console.log(`📩 sms_schedule 적재: ${c.date} | ${c.driver} → ${c.name} ${c.qty}개`);
  }

  await batch.commit();
  console.log(`\n=== 완료 ===`);
  console.log(`sms_schedule 적재: ${schedCount}건`);
  console.log(`clients 업데이트: ${clientUpdateCount}건`);
  console.log(`clients 신규 추가: ${newClientCount}건`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
