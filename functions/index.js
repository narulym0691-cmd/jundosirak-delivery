const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const https = require('https');

admin.initializeApp();
const db = admin.firestore();

// ─── 코스-팀 매핑 ──────────────────────────────────────────────
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

// 팀별 기준선 (1~3월 일평균, MEMORY 기준)
const TEAM_BASELINE = {
  team1: 488, // 준고
  team2: 541, // 해운대
  team3: 349, // 공오일(051)
  team4: 554, // 연수남
  team5: 483, // 아가리
  team6: 299, // 도세마
  team7: 460, // 강서영
};
// 인센티브 등급 기준
const INCENTIVE_GRADE = [
  { grade: 'A', add: 120, label: 'A등급(80만원)' },
  { grade: 'B', add: 80,  label: 'B등급(50만원)' },
  { grade: 'C', add: 50,  label: 'C등급(30만원)' },
];

// ─── 솔라피 설정 (준도시락 계정) ───────────────────────────────
const SOLAPI_KEY    = 'NCSUMH158EDTPETL';
const SOLAPI_SECRET = 'OHER7WUU4VYIIN2XP6W8B5CAFOYSV3GH';
const SOLAPI_FROM   = '01024763473'; // 010-2476-3473

// ── 날씨 가져오기 (부산) ──
async function getBusanWeather() {
  return new Promise((resolve) => {
    https.get('https://api.open-meteo.com/v1/forecast?latitude=35.1796&longitude=129.0756&current=temperature_2m,weather_code&timezone=Asia/Seoul', (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const temp = Math.round(j.current.temperature_2m);
          const code = j.current.weather_code;
          resolve({ temp, code });
        } catch(e) {
          resolve({ temp: null, code: null });
        }
      });
    }).on('error', () => resolve({ temp: null, code: null }));
  });
}

// 날씨 코드 → 상태 텍스트
function weatherText(code) {
  if (code === null) return '맑음';
  if (code <= 1) return '맑음';
  if (code <= 3) return '흐림';
  if (code <= 67) return '비';
  if (code <= 77) return '눈';
  return '흐림';
}

// 날씨별 이모지
function weatherEmoji(code, temp) {
  if (code === null) return '🌤️';
  if (code <= 1) return temp >= 15 ? '🌤️' : '☀️';
  if (code <= 3) return '☁️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '❄️';
  return '☁️';
}

// 날씨 + 기온 기반 인사말 (15가지)
function getWeatherGreeting(driverName, weather) {
  const { temp, code } = weather;
  const tempVal = temp !== null ? temp : 15;
  const w = weatherText(code);
  const emoji = weatherEmoji(code, tempVal);
  
  const greetings = [];
  
  // 맑음 + 따뜻 (15℃↑)
  if (w === '맑음' && tempVal >= 15) {
    greetings.push(`${emoji} ${driverName} 기사님, 좋은 아침입니다! 오늘 부산 화창해요, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 안녕하세요! 날씨 정말 좋네요, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 활기찬 하루 시작하세요! 오늘 부산 맑음, ${tempVal}℃`);
  }
  // 맑음 + 쌀쌀 (10℃↓)
  else if (w === '맑음' && tempVal < 10) {
    greetings.push(`${emoji} ${driverName} 기사님, 좋은 아침입니다! 오늘 부산 맑지만 쌀쌀해요, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 안녕하세요! 날씨 맑지만 옷 따뜻하게 입으세요, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 건강한 하루 되세요! 오늘 부산 맑음, ${tempVal}℃ 쌀쌀`);
  }
  // 맑음 + 중간 (10~15℃)
  else if (w === '맑음') {
    greetings.push(`${emoji} ${driverName} 기사님, 좋은 아침입니다! 오늘 부산 맑음, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 즐거운 하루 보내세요! 날씨 맑아요, ${tempVal}℃`);
  }
  // 흐림
  else if (w === '흐림') {
    greetings.push(`${emoji} ${driverName} 기사님, 좋은 아침입니다! 오늘 부산 흐림, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 안녕하세요! 날씨 흐리지만 힘내세요, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 오늘도 파이팅입니다! 부산 흐림, ${tempVal}℃`);
  }
  // 비
  else if (w === '비') {
    greetings.push(`${emoji} ${driverName} 기사님, 안전운전하세요! 오늘 부산 비 예보, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 조심히 다녀오세요! 빗길 운전 주의하세요, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 건강 챙기세요! 오늘 부산 비, ${tempVal}℃`);
  }
  // 눈
  else if (w === '눈') {
    greetings.push(`${emoji} ${driverName} 기사님, 조심히 다녀오세요! 오늘 부산 눈 예보, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 안전운전하세요! 눈길 미끄러워요, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 천천히 운전하세요! 부산 눈, ${tempVal}℃`);
  }
  
  // 기본값
  if (greetings.length === 0) {
    greetings.push(`${emoji} ${driverName} 기사님, 좋은 아침입니다! 오늘 부산 ${w}, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 안녕하세요! 오늘 부산 ${w}, ${tempVal}℃`);
    greetings.push(`${emoji} ${driverName} 기사님, 힘차게 시작하세요! 부산 ${w}, ${tempVal}℃`);
  }
  
  // 랜덤 선택
  return greetings[Math.floor(Math.random() * greetings.length)];
}

function getSolapiAuth() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const hmac = crypto.createHmac('sha256', SOLAPI_SECRET);
  hmac.update(date + salt);
  const signature = hmac.digest('hex');
  return `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

// 솔라피 단건 발송 유틸
function sendOneSms(phone, text) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      message: {
        to: phone.replace(/-/g, ''),
        from: SOLAPI_FROM,
        text,
      },
    });
    const options = {
      hostname: 'api.solapi.com',
      path: '/messages/v4/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getSolapiAuth(),
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const r = https.request(options, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // 솔라피 성공: statusCode 2000 또는 HTTP 200
          if (parsed.statusCode === '2000' || res.statusCode === 200) {
            resolve({ ok: true });
          } else {
            resolve({ ok: false, error: data });
          }
        } catch (e) {
          resolve({ ok: false, error: data });
        }
      });
    });
    r.on('error', (e) => resolve({ ok: false, error: e.message }));
    r.write(body);
    r.end();
  });
}

// ─── 인센티브 계산 유틸 ────────────────────────────────────────
function calcIncentive(teamId, currentAvg) {
  const baseline = TEAM_BASELINE[teamId] || 0;
  const diff = currentAvg - baseline;
  let currentGrade = '기준 미달';
  let toB = 0;

  for (const g of INCENTIVE_GRADE) {
    if (diff >= g.add) {
      currentGrade = g.label;
      break;
    }
  }
  // B등급까지 남은 개수
  const bTarget = baseline + INCENTIVE_GRADE[1].add; // +80
  toB = Math.max(0, bTarget - currentAvg);

  return { currentGrade, toB: Math.ceil(toB) };
}

// ─── 문자 템플릿 ───────────────────────────────────────────────
const NEW_CLIENT_TEMPLATES = [
  (v) => `[준도시락] ${v.기사명} 기사님, 좋은 아침입니다 🌅\n어제 ${v.업체명}에서 첫 주문이 들어왔어요! (${v.메뉴} ${v.수량}개)\n덕분에 ${v.팀명}팀 일평균이 ${v.어제일평균}→${v.오늘일평균}개로 올랐습니다 📈\n오늘 첫 배송인 만큼 밝은 인사 한 번 부탁드려요 😊`,
  (v) => `[준도시락] ${v.기사명} 기사님, 새벽부터 수고 많으십니다 🙏\n${v.업체명} 신규 계약 첫 주문이에요! (${v.수량}개)\n이 업체 하나로 ${v.팀명}팀이 B등급까지 ${v.B등급까지}개 더 가까워졌습니다.\n오늘 첫인상이 장기 거래를 결정합니다. 잘 부탁드려요!`,
  (v) => `[준도시락] 안녕하세요 ${v.기사명} 기사님! ☀️\n${v.업체명} 첫 주문 들어왔습니다 (${v.메뉴} ${v.수량}개)\n${v.팀명}팀 일평균 +${v.증가량}개 상승! 현재 ${v.오늘일평균}개입니다.\n신규 업체는 첫 3번이 중요합니다. 오늘도 파이팅입니다 💪`,
  (v) => `[준도시락] ${v.기사명} 기사님, 오늘 특별한 배송이 있어요 ⭐\n${v.업체명} 신규 첫 주문! (${v.수량}개)\n팀 일평균 ${v.어제일평균}→${v.오늘일평균}개로 ${v.증가량}개 올랐습니다.\n도착 시 담당자분께 명함 한 장 드리면 더욱 좋겠습니다 😄`,
  (v) => `[준도시락] ${v.기사명} 기사님 새벽 출근 고생하십니다 🚚\n${v.업체명} 오늘 처음 주문이 들어왔어요 (${v.메뉴} ${v.수량}개)\n이 업체가 정착되면 ${v.팀명}팀 월 인센티브에 큰 힘이 됩니다!\n첫 배송, 잘 부탁드립니다 🙏`,
  (v) => `[준도시락] Good morning ${v.기사명} 기사님! 🌄\n새 거래처 ${v.업체명} 첫 주문 (${v.수량}개) 들어왔습니다.\n덕분에 ${v.팀명}팀 오늘 일평균 목표 ${v.B등급까지}개 앞으로 당겨졌어요.\n신규 업체일수록 시간 엄수가 생명입니다. 오늘도 안전 운행하세요!`,
  (v) => `[준도시락] ${v.기사명} 기사님, 반가운 소식 전해드려요 📣\n${v.업체명}에서 첫 주문이 왔습니다! (${v.메뉴} ${v.수량}개)\n${v.팀명}팀 일평균이 ${v.오늘일평균}개가 됐어요. 착착 올라가고 있습니다 📈\n오늘 배송 후 불편한 점 없는지 한 번 여쭤봐 주시면 감사하겠습니다!`,
  (v) => `[준도시락] ${v.기사명} 기사님, 오늘 신규 거래처 있습니다 ✨\n${v.업체명} 첫 주문 (${v.수량}개) — 오늘이 첫 만남이에요.\n${v.팀명}팀 일평균 +${v.증가량}개↑ 현재 ${v.오늘일평균}개입니다.\n첫 배송은 회사 얼굴입니다. 기사님만 믿겠습니다 💙`,
  (v) => `[준도시락] ${v.기사명} 기사님 안녕하세요 🌞\n어젯밤 ${v.업체명} 계약 첫 주문이 들어왔어요 (${v.수량}개)!\n${v.팀명}팀이 이 업체 덕분에 B등급까지 ${v.B등급까지}개 남았습니다.\n오늘 밝게 인사해 주시고 정시 배송 부탁드려요 😊`,
  (v) => `[준도시락] ${v.기사명} 기사님, 오늘 기분 좋은 소식! 🎉\n${v.업체명} 신규 첫 주문 (${v.메뉴} ${v.수량}개) 확인됐습니다.\n${v.팀명}팀 누적 일평균 ${v.오늘일평균}개 — 어제보다 ${v.증가량}개 상승!\n앞으로 꾸준한 거래처가 될 수 있도록 잘 부탁드립니다 🙏`,
];

const PRIORITY_CLIENT_TEMPLATES = [
  (v) => `[준도시락] ${v.기사명} 기사님, 오늘 VIP 업체 있습니다 ⭐\n${v.업체명} 어제 ${v.수량}개 주문 확인!\n이 업체 하나가 ${v.팀명}팀 일평균의 ${v.비중}%를 차지합니다.\n오늘도 안정적인 배송 부탁드립니다 🙏`,
  (v) => `[준도시락] ${v.기사명} 기사님 좋은 아침입니다 🌅\n${v.업체명} 오늘 ${v.수량}개 — 팀 핵심 거래처입니다.\n${v.팀명}팀 현재 일평균 ${v.오늘일평균}개, B등급까지 ${v.B등급까지}개 남았어요.\n이 업체만 잘 지켜도 등급이 달라집니다 💪`,
  (v) => `[준도시락] ${v.기사명} 기사님, 오늘 중요 배송 체크해드려요 📋\n${v.업체명} ${v.수량}개 — ${v.팀명}팀 TOP 거래처입니다.\n팀 일평균 ${v.오늘일평균}개 유지 중. 이 업체가 핵심이에요.\n시간 엄수 + 밝은 응대 부탁드립니다 😊`,
  (v) => `[준도시락] ${v.기사명} 기사님 새벽 수고하십니다 🚚\n오늘 ${v.업체명} ${v.수량}개 배송 있습니다.\n이 업체 덕분에 ${v.팀명}팀이 인센티브 ${v.인센티브} 유지 중입니다.\n오늘도 믿고 맡기겠습니다 💙`,
  (v) => `[준도시락] ${v.기사명} 기사님, 오늘 핵심 거래처 알림 ⚡\n${v.업체명} ${v.수량}개 — ${v.팀명}팀 일평균에서 비중 ${v.비중}%.\nB등급까지 ${v.B등급까지}개 남았어요. 이 업체 하나가 큰 힘입니다.\n오늘도 파이팅입니다! 💪`,
  (v) => `[준도시락] Good morning ${v.기사명} 기사님! ☀️\n${v.업체명} 오늘 ${v.수량}개 주문 들어왔습니다.\n${v.팀명}팀 이번달 일평균 ${v.오늘일평균}개 — 목표까지 ${v.B등급까지}개!\n대형 거래처 관리가 인센티브를 결정합니다. 잘 부탁드려요 🙏`,
  (v) => `[준도시락] ${v.기사명} 기사님 안녕하세요 🌞\n${v.업체명} 오늘 ${v.수량}개 — 이 업체 빠지면 팀 평균 -${v.증가량}개입니다.\n현재 ${v.팀명}팀 ${v.인센티브} 달성 중!\n오늘도 꼼꼼하게 부탁드립니다 😄`,
  (v) => `[준도시락] ${v.기사명} 기사님, 오늘 VIP 배송 체크 📌\n${v.업체명} ${v.수량}개 — ${v.팀명}팀 매출 핵심 거래처.\n팀 일평균 ${v.오늘일평균}개 유지 중이에요.\n혹시 담당자 분위기 변화 있으면 꼭 알려주세요 👍`,
  (v) => `[준도시락] ${v.기사명} 기사님, 오늘도 힘내세요 💙\n${v.업체명} 오늘 ${v.수량}개 주문 확인!\n${v.팀명}팀 B등급까지 ${v.B등급까지}개 — 이 업체가 든든한 버팀목입니다.\n안전 운행하시고 좋은 하루 되세요 🙏`,
  (v) => `[준도시락] ${v.기사명} 기사님 새벽 출근 감사합니다 🌄\n${v.업체명} ${v.수량}개 — ${v.팀명}팀 일평균의 ${v.비중}% 담당 중요 업체입니다.\n현재 팀 일평균 ${v.오늘일평균}개, ${v.인센티브} 달성 중!\n오늘도 믿음직한 배송 기대하겠습니다 💪`,
];

// 랜덤 템플릿 선택 (연속 3일 같은 번호 방지)
async function pickTemplate(templates, driverName, clientName, type) {
  const logKey = `${type}_${driverName}_${clientName}`;
  const logRef = db.collection('sms_template_log').doc(logKey);
  const logSnap = await logRef.get();

  let recentIndexes = [];
  if (logSnap.exists) {
    recentIndexes = logSnap.data().recentIndexes || [];
  }

  const available = templates.map((_, i) => i).filter((i) => !recentIndexes.includes(i));
  const pool = available.length > 0 ? available : templates.map((_, i) => i);
  const chosen = pool[Math.floor(Math.random() * pool.length)];

  // 최근 3개만 유지
  const newRecent = [...recentIndexes, chosen].slice(-3);
  await logRef.set({ recentIndexes: newRecent, updatedAt: admin.firestore.FieldValue.serverTimestamp() });

  return chosen;
}

// ─── 팀 당일 일평균 계산 ──────────────────────────────────────
async function getTeamDailyAvg(teamId, dateStr) {
  // sales_daily에서 해당 팀의 최근 30일 평균 계산
  const thirtyDaysAgo = new Date(dateStr);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const fromStr = thirtyDaysAgo.toISOString().slice(0, 10);

  const snap = await db.collection('sales_daily')
    .where('teamId', '==', teamId)
    .where('date', '>=', fromStr)
    .where('date', '<=', dateStr)
    .get();

  if (snap.empty) return TEAM_BASELINE[teamId] || 0;

  let total = 0;
  let count = 0;
  snap.forEach((doc) => {
    total += doc.data().totalQuantity || 0;
    count++;
  });
  return count > 0 ? Math.round(total / count) : TEAM_BASELINE[teamId] || 0;
}

// ─── 오전 7:00 자동문자 스케줄러 ─────────────────────────────
// KST 07:00 = UTC 22:00 전날 → cron: '0 22 * * *'
exports.scheduledSmsAtDawn = functions
  .region('us-central1')
  .pubsub.schedule('0 22 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    console.log('=== 오전 7시 자동문자 스케줄러 시작 ===');

    // 부산 날씨 가져오기
    const weather = await getBusanWeather();
    console.log(`부산 날씨: ${weatherText(weather.code)} ${weather.temp}℃`);

    // KST 기준 "어제" 날짜 (이 함수가 UTC 19:30에 실행 = KST 04:30)
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const yesterday = new Date(kstNow);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    console.log(`대상 날짜: ${yesterdayStr}`);

    try {
      // sms_schedule 에서 어제자 발송 대기 건 조회
      const scheduleSnap = await db.collection('sms_schedule')
        .where('date', '==', yesterdayStr)
        .where('sent', '==', false)
        .get();

      if (scheduleSnap.empty) {
        console.log('발송 대기 건 없음');
        return null;
      }

      // users 캐시
      const usersSnap = await db.collection('users').where('active', '==', true).get();
      const usersMap = {};
      usersSnap.forEach((doc) => {
        const d = doc.data();
        if (d.name) usersMap[d.name] = d;
      });

      let totalSent = 0;
      let totalFailed = 0;

      for (const schedDoc of scheduleSnap.docs) {
        const task = schedDoc.data();
        const {
          type,          // 'new_client' | 'priority_client' | 'broadcast_0409'
          driverName,
          clientName,
          menu,
          quantity,
          teamId,
          teamName,
          courseId,
          message,       // broadcast용
          phone,         // broadcast용
        } = task;

        // broadcast 타입 처리
        if (type === 'broadcast_0409') {
          if (!phone) {
            console.log(`❌ ${driverName} 전화번호 없음 (broadcast)`);
            await schedDoc.ref.update({ sent: true, skipped: true });
            continue;
          }
          
          const greeting = getWeatherGreeting(driverName, weather);
          const text = greeting + '\n\n' + message;
          const result = await sendOneSms(phone, text);
          
          await db.collection('sms_logs').add({
            type: 'broadcast',
            driverName,
            teamId,
            date: yesterdayStr,
            text,
            phone,
            sent: result.ok ? 1 : 0,
            failed: result.ok ? 0 : 1,
            error: result.ok ? null : (result.error || null),
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          
          await schedDoc.ref.update({
            sent: true,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            ok: result.ok,
          });
          
          if (result.ok) {
            console.log(`✅ 전체발송: ${driverName}(${phone})`);
            totalSent++;
          } else {
            console.log(`❌ 전체발송 실패: ${driverName}: ${result.error}`);
            totalFailed++;
          }
          continue;
        }

        const driverInfo = usersMap[driverName];
        if (!driverInfo || !driverInfo.phone) {
          console.log(`❌ ${driverName} 기사 전화번호 없음, 스킵`);
          await schedDoc.ref.update({ sent: true, skipped: true, skippedReason: '전화번호 없음' });
          continue;
        }

        // 팀 일평균 계산
        const avgBefore = await getTeamDailyAvg(teamId, yesterdayStr);
        const avgAfter  = avgBefore + quantity;
        const increase  = quantity;
        const { currentGrade, toB } = calcIncentive(teamId, avgAfter);

        // 팀 일평균에서 이 업체 비중 %
        const ratio = avgAfter > 0 ? Math.round((quantity / avgAfter) * 100) : 0;

        const vars = {
          기사명:     driverName,
          업체명:     clientName,
          수량:       quantity,
          메뉴:       menu || '도시락',
          팀명:       teamName || teamId,
          어제일평균: avgBefore,
          오늘일평균: avgAfter,
          증가량:     increase,
          B등급까지:  toB,
          인센티브:   currentGrade,
          비중:       ratio,
        };

        const templates = type === 'new_client' ? NEW_CLIENT_TEMPLATES : PRIORITY_CLIENT_TEMPLATES;
        const templateIdx = await pickTemplate(templates, driverName, clientName, type);
        let text = templates[templateIdx](vars);
        
        // 문자 앞에 날씨 인사말 추가
        const greeting = getWeatherGreeting(driverName, weather);
        text = greeting + '\n\n' + text.replace(`[준도시락] ${driverName} 기사님, `, '').replace(/^(안녕하세요|좋은 아침입니다|새벽부터 수고 많으십니다|오늘 특별한 배송이 있어요|새벽 출근 고생하십니다|반가운 소식 전해드려요|오늘도 힘내세요|새벽 출근 감사합니다|오늘 기분 좋은 소식|Good morning) [🌅🙏☀️⭐🚚📣💙🌄🎉!]*\n/, '');

        const result = await sendOneSms(driverInfo.phone, text);

        // sms_logs 저장
        await db.collection('sms_logs').add({
          type,
          driverName,
          clientName,
          menu,
          quantity,
          teamId,
          teamName,
          date: yesterdayStr,
          templateIndex: templateIdx,
          text,
          phone: driverInfo.phone,
          sent: result.ok ? 1 : 0,
          failed: result.ok ? 0 : 1,
          error: result.ok ? null : (result.error || null),
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // 스케줄 문서 완료 처리
        await schedDoc.ref.update({
          sent: true,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          ok: result.ok,
        });

        if (result.ok) {
          console.log(`✅ 발송 성공: ${driverName}(${driverInfo.phone}) → ${clientName} [${type}]`);
          totalSent++;
        } else {
          console.log(`❌ 발송 실패: ${driverName} → ${clientName}: ${result.error}`);
          totalFailed++;
        }
      }

      console.log(`=== 완료: 성공 ${totalSent}건, 실패 ${totalFailed}건 ===`);
      
      // ── 신규업체 고객관리 기록 체크 ──
      await checkNewClientFeedback();
      
    } catch (e) {
      console.error('scheduledSmsAtDawn 오류:', e);
    }
    return null;
  });

// ─── 판매 업로드 시 sms_schedule 자동 적재 ───────────────────
// daily_sales 문서 생성/갱신 시 신규/1순위 업체 감지 → sms_schedule에 적재
// 실제 daily_sales 구조: { date, teamTotals, teamDrivers, driverRows, savedAt }
// 거래처별 주문 상세가 없으므로 → 구글시트 연동으로 신규업체 감지
// 이 트리거는 1순위 업체 문자만 처리 (신규업체는 관리자 구글시트 등록 시 처리)
exports.onDailySalesCreated = functions
  .region('us-central1')
  .firestore.document('daily_sales/{docId}')
  .onWrite(async (change, context) => {
    // 생성 또는 수정 모두 처리
    const sale = change.after.exists ? change.after.data() : null;
    if (!sale) return null;

    const { date, driverRows = [] } = sale;
    if (!date || !driverRows.length) return null;

    try {
      // 기사명 → courseId 매핑
      const DRIVER_COURSE = {
        '표창훈': '코스1', '박인수': '코스6', '안준수': '코스7',
        '김민기': '코스3', '최용혁': '코스8', '이창목': '코스13',
        '오철석': '코스4', '전태영': '코스15', '이진우': '코스5',
        '송정':   '코스6', '유상하': '코스9', '금정':   '코스10',
        '김종호': '코스16', '최준은': '코스18', '이호주': '코스11',
        '김창연': '코스12', '조홍철': '코스19', '김동완': '코스14',
        '류대현': '코스17',
      };

      // 1순위 업체(isPriority:true) 전체 조회
      const prioritySnap = await db.collection('clients')
        .where('isPriority', '==', true)
        .where('active', '==', true)
        .get();

      // courseId별 1순위 업체 목록
      const priorityByCourse = {};
      prioritySnap.forEach(doc => {
        const d = doc.data();
        if (!priorityByCourse[d.courseId]) priorityByCourse[d.courseId] = [];
        priorityByCourse[d.courseId].push(d);
      });

      const batch = db.batch();
      let taskCount = 0;

      for (const row of driverRows) {
        const driverName = row.driver || row.name;
        const total = row.total || 0;
        if (!driverName || !total) continue;

        const courseId = DRIVER_COURSE[driverName];
        if (!courseId) continue;

        const teamInfo = COURSE_TEAM_MAP[courseId];
        const priorityClients = priorityByCourse[courseId] || [];

        for (const client of priorityClients) {
          // 이미 이 날짜에 같은 업체로 적재된 건 있는지 중복 체크
          const existing = await db.collection('sms_schedule')
            .where('date', '==', date)
            .where('clientName', '==', client.clientName)
            .where('type', '==', 'priority_client')
            .limit(1)
            .get();
          if (!existing.empty) continue;

          const schedRef = db.collection('sms_schedule').doc();
          batch.set(schedRef, {
            type: 'priority_client',
            date,
            courseId,
            driverName,
            clientName: client.clientName,
            menu: '도시락',
            quantity: client.dailyAvgOrder || 0,
            teamId: teamInfo.teamId,
            teamName: teamInfo.teamName,
            sent: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          taskCount++;
          console.log(`sms_schedule 1순위 적재: ${driverName} → ${client.clientName}`);
        }
      }

      if (taskCount > 0) await batch.commit();
      console.log(`onDailySalesCreated: ${date} → ${taskCount}건 적재`);

    } catch (e) {
      console.error('onDailySalesCreated 오류:', e);
    }
    return null;
  });

// ─── 배송완료 수신 (주문앱 연동용) ───────────────────────────
exports.deliveryComplete = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    try {
      const { driverId, courseId, completedAt, clientName } = req.body;
      if (!driverId || !courseId || !completedAt) {
        res.status(400).json({ error: 'driverId, courseId, completedAt 필수' });
        return;
      }

      let driverName = driverId;
      let teamId = null;
      let teamName = null;

      const userSnap = await db.collection('users').doc(driverId).get();
      if (userSnap.exists) {
        const u = userSnap.data();
        driverName = u.name || driverId;
        teamId = u.teamId || null;
        teamName = u.teamName || null;
      }
      if (!teamId && courseId && COURSE_TEAM_MAP[courseId]) {
        teamId = COURSE_TEAM_MAP[courseId].teamId;
        teamName = COURSE_TEAM_MAP[courseId].teamName;
      }

      const logRef = db.collection('delivery_logs').doc();
      await logRef.set({
        logId: logRef.id,
        driverId,
        driverName,
        teamId: teamId || '',
        teamName: teamName || '',
        courseId,
        clientName: clientName || '',
        completedAt: admin.firestore.Timestamp.fromDate(new Date(completedAt)),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        source: 'app',
      });

      res.status(200).json({ ok: true, message: '배송완료 기록 저장 성공', logId: logRef.id, driverName, teamName });
    } catch (e) {
      console.error('deliveryComplete 오류:', e);
      res.status(500).json({ error: '서버 오류: ' + e.message });
    }
  });

// ─── 경보 생성 시 팀장 자동 문자 발송 ────────────────────────
exports.onAlertCreated = functions
  .region('us-central1')
  .firestore.document('alerts/{alertId}')
  .onCreate(async (snap, context) => {
    const alert = snap.data();
    const { clientName, courseId, level, consecutiveDays, teamId } = alert;
    if (!level || level === 'check') return null;

    const levelLabel = level === 'urgent' ? '🚨 즉시경보' : '⚠️ 주시경보';

    try {
      let leaderPhone = null;
      let leaderName = null;
      const targetTeamId = teamId || (courseId && COURSE_TEAM_MAP[courseId] ? COURSE_TEAM_MAP[courseId].teamId : null);

      if (targetTeamId) {
        const usersSnap = await db.collection('users')
          .where('teamId', '==', targetTeamId)
          .where('role', '==', 'leader')
          .where('active', '==', true)
          .get();
        if (!usersSnap.empty) {
          const leader = usersSnap.docs[0].data();
          leaderPhone = leader.phone || null;
          leaderName = leader.name || '팀장';
        }
      }

      if (!leaderPhone) {
        console.log(`경보 발생(${clientName}) - 팀장 전화번호 없음, 문자 미발송`);
        return null;
      }

      const text = `[준도시락 배송관리] ${levelLabel}\n거래처: ${clientName}\n${consecutiveDays ? consecutiveDays + '일 연속 미주문' : ''}\n\n확인 후 조치 결과를 시스템에 입력해주세요.`;
      const result = await sendOneSms(leaderPhone, text);

      await db.collection('sms_logs').add({
        type: 'alert_auto',
        alertId: context.params.alertId,
        clientName,
        level,
        targets: [leaderName],
        text,
        sent: result.ok ? 1 : 0,
        failed: result.ok ? 0 : 1,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await snap.ref.update({
        smsSentAt: admin.firestore.FieldValue.serverTimestamp(),
        smsSentTo: leaderName,
      });

      console.log(`경보 자동문자 발송 ${result.ok ? '완료' : '실패'}: ${clientName} → ${leaderName}(${leaderPhone})`);
    } catch (e) {
      console.error('경보 자동문자 발송 실패:', e);
    }
    return null;
  });

// ─── 수동 SMS 발송 (관리자 화면용) ───────────────────────────
exports.sendSms = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    try {
      const { targets, text } = req.body;
      if (!targets || !text) { res.status(400).json({ error: 'targets, text 필수' }); return; }

      let sent = 0;
      let failed = 0;

      for (const t of targets) {
        const result = await sendOneSms(t.phone, text);
        if (result.ok) sent++; else failed++;
      }

      await db.collection('sms_logs').add({
        type: 'manual',
        targets: targets.map((t) => t.name),
        text,
        sent,
        failed,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(200).json({ ok: true, sent, failed });
    } catch (e) {
      console.error('sendSms 오류:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

// ─── 테스트 문자 발송 (관리자용) ─────────────────────────────
// POST { phone: '010-xxxx-xxxx', text: '테스트 메시지' }
exports.sendTestSms = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    try {
      const { phone, text } = req.body;
      if (!phone || !text) { res.status(400).json({ error: 'phone, text 필수' }); return; }

      const result = await sendOneSms(phone, text);
      res.status(200).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

// ── 신규업체 고객관리 기록 체크 (3일째) ──
async function checkNewClientFeedback() {
  try {
    console.log('\n=== 신규업체 고객관리 체크 시작 ===');
    
    // 오늘 날짜
    const today = new Date();
    const todayStr = today.toISOString().slice(0,10);
    
    // 신규업체 (firstOrderDate 있는 것)
    const clientsSnap = await admin.firestore().collection('clients')
      .where('isNew','==',true)
      .where('firstOrderDate','!=',null)
      .get();
    
    let fbNeeded = 0;
    let fbSent = 0;
    
    for (const doc of clientsSnap.docs) {
      const client = doc.data();
      const firstDate = new Date(client.firstOrderDate);
      
      // firstOrderDate부터 오늘까지 일수
      const diffDays = Math.floor((today - firstDate) / (1000*60*60*24));
      
      // 3일 이상 경과 (firstOrderDate 포함 3일째 = +2일)
      if (diffDays < 2) continue;
      
      // 이미 고객관리 기록 있는지 확인
      const fvSnap = await admin.firestore().collection('field_visits')
        .where('clientName','==',client.clientName)
        .where('type','==','customer_care')
        .limit(1)
        .get();
      
      if (!fvSnap.empty) continue;  // 이미 작성됨
      
      fbNeeded++;
      
      // 담당 기사 찾기
      const usersSnap = await admin.firestore().collection('users')
        .where('teamId','==',client.teamId)
        .where('role','in',['driver','leader'])
        .limit(1)
        .get();
      
      if (usersSnap.empty) {
        console.log(`⚠️ ${client.clientName}: 담당 기사 없음 (${client.teamId})`);
        continue;
      }
      
      const driver = usersSnap.docs[0].data();
      const driverName = driver.name;
      const driverPhone = driver.phone;
      
      if (!driverPhone) {
        console.log(`⚠️ ${driverName}: 전화번호 없음`);
        continue;
      }
      
      // 오늘 이미 발송했는지 체크
      const logSnap = await admin.firestore().collection('sms_logs')
        .where('type','==','new_client_feedback')
        .where('driverName','==',driverName)
        .where('clientName','==',client.clientName)
        .where('date','==',todayStr)
        .limit(1)
        .get();
      
      if (!logSnap.empty) continue;  // 오늘 이미 발송
      
      // 문자 발송
      const text = `[준도시락] ${driverName} 기사님, ${client.clientName}(신규업체) 고객관리 기록을 작성해주세요. (첫 주문 ${diffDays+1}일째)`;
      
      const result = await sendSolapiSms(driverPhone, text);
      
      // 로그 저장
      await admin.firestore().collection('sms_logs').add({
        type: 'new_client_feedback',
        driverName,
        clientName: client.clientName,
        phone: driverPhone,
        text,
        date: todayStr,
        sent: result.ok ? 1 : 0,
        failed: result.ok ? 0 : 1,
        error: result.ok ? null : (result.error||null),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      
      if (result.ok) {
        console.log(`✅ 신규업체 문자: ${driverName}(${driverPhone}) → ${client.clientName}`);
        fbSent++;
      } else {
        console.log(`❌ 신규업체 문자 실패: ${driverName} → ${client.clientName}: ${result.error}`);
      }
    }
    
    console.log(`=== 신규업체 고객관리 체크 완료: 대상 ${fbNeeded}건, 발송 ${fbSent}건 ===`);
  } catch (e) {
    console.error('checkNewClientFeedback 오류:', e);
  }
}

// ── 클레임 발생 시 자동 처리 ──
exports.onClaimCreated = functions
  .region('us-central1')
  .firestore.document('claims/{claimId}')
  .onCreate(async (snap, context) => {
    const claim = snap.data();
    const { type, driverName, date, clientName, source } = claim;
    
    console.log(`클레임 발생: ${type} | ${driverName} | ${clientName} | ${date} | source: ${source||'manual'}`);
    
    // 구글시트 동기화로 추가된 데이터는 문자 발송 안 함
    if (source === 'google_sheets') {
      console.log('⏭ 구글시트 동기화 데이터 — 문자 발송 건너뜀');
      return null;
    }
    
    try {
      // 1. 오배송/지연 → 정성평가 감점
      if ((type === '오배송' || type === '누락' || type === '지연') && driverName) {
        const points = (type === '지연') ? -2 : -5;
        const yearMonth = date.slice(0,7);  // YYYY-MM
        
        // users에서 uid 찾기
        const userSnap = await db.collection('users')
          .where('name','==',driverName)
          .limit(1)
          .get();
        
        if (userSnap.empty) {
          console.log(`⚠️ ${driverName} 사용자 없음`);
          return null;
        }
        
        const uid = userSnap.docs[0].id;
        const userData = userSnap.docs[0].data();
        const teamId = userData.teamId;
        
        // monthly_stats에 감점 기록
        const statsRef = db.doc(`monthly_stats/${yearMonth}/drivers/${uid}`);
        const statsSnap = await statsRef.get();
        
        if (statsSnap.exists) {
          await statsRef.update({
            claimPenalty: admin.firestore.FieldValue.increment(points)
          });
        } else {
          await statsRef.set({
            uid,
            driverName,
            teamId,
            claimPenalty: points,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });
        }
        
        console.log(`✅ 감점 적용: ${driverName} ${points}점 (${type})`);
      }
      
      // 2. 상함/이물 → 기사 고객관리 문자
      if ((type === '상함' || type === '이물') && clientName) {
        // 거래처 → 담당 기사 찾기
        const clientSnap = await db.collection('clients')
          .where('clientName','==',clientName)
          .limit(1)
          .get();
        
        if (clientSnap.empty) {
          console.log(`⚠️ ${clientName} 거래처 없음`);
          return null;
        }
        
        const client = clientSnap.docs[0].data();
        const teamId = client.teamId;
        
        // 팀 기사 찾기
        const driverSnap = await db.collection('users')
          .where('teamId','==',teamId)
          .where('role','in',['driver','leader'])
          .limit(1)
          .get();
        
        if (driverSnap.empty) {
          console.log(`⚠️ ${teamId} 담당 기사 없음`);
          return null;
        }
        
        const driver = driverSnap.docs[0].data();
        const driverName = driver.name;
        const driverPhone = driver.phone;
        
        if (!driverPhone) {
          console.log(`⚠️ ${driverName} 전화번호 없음`);
          return null;
        }
        
        // 오늘 이미 발송했는지 체크
        const today = new Date().toISOString().slice(0,10);
        const logSnap = await db.collection('sms_logs')
          .where('type','==','claim_cs')
          .where('driverName','==',driverName)
          .where('clientName','==',clientName)
          .where('date','==',today)
          .limit(1)
          .get();
        
        if (!logSnap.empty) {
          console.log(`이미 발송함: ${driverName} → ${clientName}`);
          return null;
        }
        
        // 문자 발송
        const text = `[준도시락] ${driverName} 기사님, ${clientName} ${type} 발생했습니다. 고객관리 기록을 작성해주세요. (재배송 여부, 고객 반응 등)`;
        
        const result = await sendOneSms(driverPhone, text);
        
        // 로그 저장
        await db.collection('sms_logs').add({
          type: 'claim_cs',
          claimType: type,
          driverName,
          clientName,
          phone: driverPhone,
          text,
          date: today,
          sent: result.ok ? 1 : 0,
          failed: result.ok ? 0 : 1,
          error: result.ok ? null : (result.error||null),
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        // claim 문서에 문자 발송 기록
        await snap.ref.update({
          csSmsSent: true,
          csSmsSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        
        if (result.ok) {
          console.log(`✅ CS 문자: ${driverName}(${driverPhone}) → ${clientName} ${type}`);
        } else {
          console.log(`❌ CS 문자 실패: ${driverName}: ${result.error}`);
        }
      }
      
    } catch(e) {
      console.error('onClaimCreated 오류:', e);
    }
    
    return null;
  });

// ─── 매일 오후 3시 현장기록 일괄 문자 ───────────────────────────────
exports.scheduledFieldVisitSms = functions
  .region('us-central1')
  .pubsub.schedule('0 6 * * *')  // UTC 06:00 = KST 15:00
  .timeZone('UTC')
  .onRun(async () => {
    try {
      // KST 기준 오늘 00:00 ~ 14:59:59
      const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
      const yyyy = nowKst.getUTCFullYear();
      const mm = String(nowKst.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(nowKst.getUTCDate()).padStart(2, '0');
      const dateLabel = `${mm}월 ${dd}일`;

      const dayStartUtc = new Date(`${yyyy}-${mm}-${dd}T00:00:00+09:00`); // KST 00:00
      const dayEndUtc   = new Date(`${yyyy}-${mm}-${dd}T15:00:00+09:00`); // KST 15:00

      const snap = await db.collection('field_visits')
        .where('createdAt', '>=', dayStartUtc)
        .where('createdAt', '<',  dayEndUtc)
        .get();

      if (snap.empty) {
        console.log('현장기록 없음 → 문자 미발송');
        return null;
      }

      const visits = [];
      snap.forEach(doc => visits.push(doc.data()));

      const newSales = visits.filter(v => v.visitType === 'new_sales');
      const newSalesConfirmed = newSales.filter(v => v.isNewSalesConfirmed);
      const newSalesUnconf    = newSales.filter(v => !v.isNewSalesConfirmed);
      const careCnt = visits.filter(v => v.visitType === 'customer_care').length;

      // 관리방문: 기사별 집계
      const careByDriver = {};
      visits.filter(v => v.visitType === 'customer_care').forEach(v => {
        const name = v.driverName || '?';
        careByDriver[name] = (careByDriver[name] || 0) + 1;
      });

      const lines = [];
      lines.push(`[준도시락 현장기록] ${dateLabel}`);
      lines.push(`총 ${visits.length}건 (신규영업 ${newSales.length}건 / 관리방문 ${careCnt}건)`);
      lines.push('');

      if (newSalesConfirmed.length > 0) {
        const items = newSalesConfirmed.map(v => `${v.driverName||'?'}-${v.clientName||'?'}`).join(', ');
        lines.push(`📍신규영업✓: ${items}`);
      }
      if (newSalesUnconf.length > 0) {
        const items = newSalesUnconf.map(v => `${v.driverName||'?'}-${v.clientName||'?'}`).join(', ');
        lines.push(`📍신규영업: ${items}`);
      }
      if (Object.keys(careByDriver).length > 0) {
        const items = Object.entries(careByDriver).map(([n, c]) => `${n}(${c}건)`).join(', ');
        lines.push(`📍관리방문: ${items}`);
      }

      const text = lines.join('\n');
      const toPhone = '01058804433';

      const result = await sendOneSms(toPhone, text);

      await db.collection('sms_logs').add({
        type: 'field_visit_daily_summary',
        date: `${yyyy}-${mm}-${dd}`,
        phone: toPhone,
        text,
        totalCount: visits.length,
        newSalesCount: newSales.length,
        careCount: careCnt,
        sent: result.ok ? 1 : 0,
        failed: result.ok ? 0 : 1,
        error: result.ok ? null : (result.error || null),
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(result.ok
        ? `✅ 현장기록 일괄문자 발송: ${visits.length}건`
        : `❌ 현장기록 일괄문자 실패: ${result.error}`);
    } catch (e) {
      console.error('scheduledFieldVisitSms 오류:', e);
    }
    return null;
  });


// ─── 매월 1일 기준수량 자동 갱신 스케줄러 ───────────────────────
// KST 00:01 = UTC 15:01 전날 → cron: '1 15 * * *' (매일 실행, 1일만 동작)
// 기존 함수 일절 수정 없음 — 신규 함수만 추가
exports.autoUpdateBaseline = functions
  .region('us-central1')
  .pubsub.schedule('1 15 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    // KST 기준 오늘 날짜 확인
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const kstDay = kstNow.getDate();

    // 매월 1일에만 실행
    if (kstDay !== 1) {
      console.log(`기준수량 갱신 스킵: KST ${kstDay}일 (1일만 실행)`);
      return null;
    }

    console.log('=== 매월 1일 기준수량 자동 갱신 시작 ===');

    // 전월 계산
    const prevMonth = new Date(kstNow.getFullYear(), kstNow.getMonth() - 1, 1);
    const prevMonthStr = prevMonth.toISOString().slice(0, 7); // 'YYYY-MM'
    const prevStart = `${prevMonthStr}-01`;
    const prevEnd   = `${prevMonthStr}-31`;

    console.log(`전월: ${prevMonthStr} (${prevStart} ~ ${prevEnd})`);

    try {
      // 전월 daily_sales 전체 조회
      const snap = await db.collection('daily_sales')
        .where('date', '>=', prevStart)
        .where('date', '<=', prevEnd)
        .get();

      if (snap.empty) {
        console.log('전월 판매 데이터 없음, 갱신 중단');
        return null;
      }

      // 팀별 합계 & 영업일수 집계
      const teamSum  = {}; // { teamId: 합계 }
      const teamDays = {}; // { teamId: 영업일수 }

      snap.forEach(doc => {
        const { teamTotals } = doc.data();
        if (!teamTotals) return;
        Object.entries(teamTotals).forEach(([teamId, qty]) => {
          if (!teamSum[teamId])  teamSum[teamId]  = 0;
          if (!teamDays[teamId]) teamDays[teamId] = 0;
          teamSum[teamId]  += Number(qty) || 0;
          teamDays[teamId] += 1;
        });
      });

      console.log(`팀별 집계 완료: ${Object.keys(teamSum).length}팀, 영업일 ${snap.size}일`);

      // teams 컬렉션 조회
      const teamsSnap = await db.collection('teams').get();
      const batch = db.batch();
      const historyRef = db.collection('baseline_history');
      const updatedAt = admin.firestore.FieldValue.serverTimestamp();

      teamsSnap.forEach(teamDoc => {
        const teamId   = teamDoc.id;
        const teamData = teamDoc.data();
        const days     = teamDays[teamId] || 0;
        if (days === 0) return; // 데이터 없는 팀 스킵

        const newBaseline = Math.round(teamSum[teamId] / days);
        const newGradeC   = newBaseline + 50;
        const newGradeB   = newBaseline + 80;
        const newGradeA   = newBaseline + 120;

        const oldBaseline = teamData.baselineDailyAvg || 0;

        // teams 문서 업데이트 (name, region 절대 건드리지 않음)
        batch.update(teamDoc.ref, {
          baselineDailyAvg: newBaseline,
          gradeC: newGradeC,
          gradeB: newGradeB,
          gradeA: newGradeA,
        });

        // 변경 이력 저장
        batch.set(historyRef.doc(), {
          teamId,
          teamName:    teamData.name || teamId,
          month:       prevMonthStr,
          bizDays:     days,
          oldBaseline,
          newBaseline,
          newGradeC,
          newGradeB,
          newGradeA,
          reason:      `${prevMonthStr} 전월 실적 자동 반영`,
          autoUpdated: true,
          updatedAt,
        });

        console.log(`✅ ${teamData.name}(${teamId}): ${oldBaseline} → ${newBaseline} (${days}일 기준)`);
      });

      await batch.commit();
      console.log('=== 기준수량 자동 갱신 완료 ===');

    } catch (e) {
      console.error('autoUpdateBaseline 오류:', e);
    }
    return null;
  });

// ─── 구글시트 클레임 자동 동기화 ────────────────────────────────
// 매일 KST 06:00 (UTC 21:00 전날) 실행
// 공개 구글시트 CSV 읽기 → claims 컬렉션 신규 행만 추가
// 기존 데이터 일절 수정/삭제 없음 — 신규 추가만
const CLAIMS_SHEET_ID = '1-cw2uOlbPyA8vjSrs5O6SyRBl9bgiMSfb5lQPQ6F9DM';
// ※ 시트명과 실제 데이터가 다름 (구글시트 탭 순서 기준으로 gid 확인)
// 상함 탭(gid=227649692) → 실제 오배송/누락 데이터 (col2=날짜,col3=기사명,col4=유형,col5=업체명,col7=금액,col8=부담금)
// 오배송/누락 탭(gid=1690872474) → 실제 상함 데이터 (col2=날짜,col5=업체명,col8=메뉴명,col9=내용,col11=기사명)
const CLAIMS_SHEETS = [
  { name: '오배송/누락탭(상함데이터)', gid: '1690872474', type: '상함_raw'  },
  { name: '배송지연',                  gid: '1352070318', type: '지연'      },
  { name: '상함탭(오배송누락데이터)',   gid: '227649692',  type: '누락_raw'  },
  { name: '이물',                      gid: '362633177',  type: '이물'      },
];

function fetchSheetCsv(gid) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    function get(url, n = 5) {
      https.get(url, (res) => {
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && n > 0) {
          return get(res.headers.location, n - 1);
        }
        let d = '';
        res.on('data', (c) => { d += c; });
        res.on('end', () => resolve(d));
      }).on('error', reject);
    }
    get(`https://docs.google.com/spreadsheets/d/${CLAIMS_SHEET_ID}/export?format=csv&gid=${gid}`);
  });
}

function parseCsv(text) {
  // 간단한 CSV 파서 (쉼표+큰따옴표 처리)
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

function parseClaimsRows(rows, type) {
  const items = [];
  // 첫 행은 헤더
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;

    let date = '', driverName = '', clientName = '', content = '', amount = 0, burden = 0, menu = '', itemType = type;

    if (type === '누락_raw') {
      // 상함탭(gid=227649692)의 실제 데이터: 오배송/누락
      // 헤더: 년도,월,날짜,기사명,유형(누락/오배송),업체명,내용,금액,부담금
      date       = (r[2] || '').trim();
      driverName = (r[3] || '').trim();
      itemType   = (r[4] || '누락').trim(); // 누락 or 오배송
      clientName = (r[5] || '').trim();
      content    = (r[6] || '').trim();
      amount     = parseInt((r[7] || '0').replace(/[^0-9]/g, '')) || 0;
      burden     = parseInt((r[8] || '0').replace(/[^0-9]/g, '')) || 0;
    } else if (type === '상함_raw') {
      // 오배송/누락탭(gid=1690872474)의 실제 데이터: 상함
      // 헤더: 년도,월,날짜,온도,습도,업체명,품목명,수량,메뉴명,내용,사무실대응,담당기사님,번호
      date       = (r[2] || '').trim();
      clientName = (r[5] || '').trim();
      menu       = (r[8] || '').trim();
      content    = (r[9] || '').trim();
      driverName = (r[11] || '').trim();
      itemType   = '상함';
    } else if (type === '지연') {
      // 헤더: 년도,월,날짜,날짜,목록,업체/주소,내용
      date       = (r[2] || '').trim();
      driverName = (r[3] || '').trim();
      clientName = (r[5] || '').trim();
      content    = (r[6] || '').trim();
    } else if (type === '이물') {
      // 헤더: 년도,월,날짜,업체명,품목명,수량,메뉴명,내용
      date       = (r[2] || '').trim();
      clientName = (r[3] || '').trim();
      menu       = (r[6] || '').trim();
      content    = (r[7] || '').trim();
    }

    // 날짜 유효성 검사 (YYYY-MM-DD)
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!clientName) continue;

    items.push({ date, driverName, clientName, type: itemType, content, menu, amount, burden, csCompleted: false });
  }
  return items;
}

exports.syncClaimsFromSheets = functions
  .region('us-central1')
  .pubsub.schedule('0 21 * * *')  // UTC 21:00 = KST 06:00
  .timeZone('UTC')
  .onRun(async () => {
    console.log('=== 구글시트 클레임 동기화 시작 ===');
    let totalAdded = 0;
    let totalSkipped = 0;

    try {
      for (const sheet of CLAIMS_SHEETS) {
        console.log(`시트 읽기: ${sheet.name}`);
        const csv = await fetchSheetCsv(sheet.gid);
        const rows = parseCsv(csv);
        const items = parseClaimsRows(rows, sheet.type);
        console.log(`  파싱 결과: ${items.length}건`);

        for (const item of items) {
          // 중복 체크: date + clientName + type 조합
          const existing = await db.collection('claims')
            .where('date', '==', item.date)
            .where('clientName', '==', item.clientName)
            .where('type', '==', item.type)
            .limit(1)
            .get();

          if (!existing.empty) {
            totalSkipped++;
            continue;
          }

          // 신규 추가
          await db.collection('claims').add({
            ...item,
            source: 'google_sheets',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          totalAdded++;
          console.log(`  ✅ 추가: [${item.type}] ${item.date} ${item.clientName}`);
        }
      }

      console.log(`=== 동기화 완료: 추가 ${totalAdded}건, 중복스킵 ${totalSkipped}건 ===`);
    } catch (e) {
      console.error('syncClaimsFromSheets 오류:', e);
    }
    return null;
  });

// ─── 신규업체 감사 문자 자동 발송 (매일 KST 17:00) ────────────────
// UTC 08:00 = KST 17:00
// 구글시트 신규업체 탭에서 오늘 날짜 업체 조회 → 업체 담당자 휴대폰으로 문자 발송
// 기존 함수 일절 수정 없음 — 신규 함수만 추가
const NEW_CLIENT_GID = '1000247276';
// 기본 문자 템플릿 (sms_config/new_client_templates에 저장된 값 없을 때 사용)
const NEW_CLIENT_SMS_DEFAULT =
  '안녕하세요, {업체명}입니다 😊\n' +
  '오늘 준도시락을 처음 주문해 주셔서 감사합니다! 식사는 맛있게 하셨나요?\n\n' +
  '💡 준도시락 앱을 이용하시면 구성원 모두가 각자 원하는 메뉴를 개별 주문할 수 있어요. ' +
  '업체명만 동일하게 입력하면 여러 분이 서로 다른 메뉴를 선택해도 한 번에 정확히 배송됩니다!\n\n' +
  '궁금한 점은 문자·전화·카톡 언제든지 편하게 연락 주세요. 앞으로도 잘 부탁드립니다 🍱';

async function getNewClientSmsTemplate() {
  try {
    const doc = await db.collection('sms_config').doc('new_client_templates').get();
    if (!doc.exists) return NEW_CLIENT_SMS_DEFAULT;
    const { templates, selected } = doc.data();
    const idx = typeof selected === 'number' ? selected : 0;
    return (templates && templates[idx]) || NEW_CLIENT_SMS_DEFAULT;
  } catch(e) {
    console.error('템플릿 조회 실패, 기본값 사용:', e.message);
    return NEW_CLIENT_SMS_DEFAULT;
  }
}

exports.scheduledNewClientSms = functions
  .region('us-central1')
  .pubsub.schedule('0 8 * * *')  // UTC 08:00 = KST 17:00
  .timeZone('UTC')
  .onRun(async () => {
    console.log('=== 신규업체 감사 문자 발송 시작 ===');

    // KST 오늘 날짜
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const todayKst = kstNow.toISOString().slice(0, 10); // YYYY-MM-DD
    // 구글시트 날짜 형식: 2026.04.14
    const todaySheet = todayKst.replace(/-/g, '.');
    console.log('오늘(KST):', todayKst, '/ 시트형식:', todaySheet);

    try {
      // 구글시트 신규업체 CSV 읽기
      const csv = await fetchSheetCsv(NEW_CLIENT_GID);
      const rows = parseCsv(csv);

      // 오늘 날짜 신규업체 파싱 (col0=날짜, col1=업체명, col2=연락처, col5=담당기사, col6=합계)
      const todayClients = [];
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const rawDate = (r[0] || '').trim();
        const clientName = (r[1] || '').trim();
        const phone = (r[2] || '').trim().replace(/[^0-9]/g, ''); // 숫자만
        const driverName = (r[5] || '').trim();
        const qty = parseInt((r[6] || '0').replace(/[^0-9]/g, '')) || 0;
        if (!rawDate || !clientName || !phone) continue;
        if (rawDate !== todaySheet) continue;
        todayClients.push({ clientName, phone, driverName, qty });
      }

      console.log(`오늘 신규업체: ${todayClients.length}건`);

      if (!todayClients.length) {
        console.log('오늘 신규업체 없음, 종료');
        return null;
      }

      let sent = 0, failed = 0;

      for (const client of todayClients) {
        // 중복 발송 방지
        const existing = await db.collection('new_client_sms')
          .where('date', '==', todayKst)
          .where('clientName', '==', client.clientName)
          .limit(1).get();
        if (!existing.empty) {
          console.log(`스킵(중복): ${client.clientName}`);
          continue;
        }

        // 문자 내용 생성 (sms_config에서 선택된 템플릿 사용)
        const tmpl = await getNewClientSmsTemplate();
        const text = tmpl.replace('{업체명}', client.clientName);
        const toPhone = '0' + client.phone.replace(/^0/, '');

        // 솔라피 발송
        const result = await sendSolapiSms(toPhone, text);

        // 발송 이력 저장
        await db.collection('new_client_sms').add({
          date: todayKst,
          clientName: client.clientName,
          phone: client.phone,
          driverName: client.driverName,
          qty: client.qty,
          text,
          sent: result.ok ? 1 : 0,
          failed: result.ok ? 0 : 1,
          error: result.ok ? null : (result.error || null),
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        if (result.ok) {
          sent++;
          console.log(`✅ 발송: ${client.clientName} → ${toPhone}`);
        } else {
          failed++;
          console.log(`❌ 실패: ${client.clientName} → ${result.error}`);
        }
      }

      console.log(`=== 완료: 성공 ${sent}건 / 실패 ${failed}건 ===`);
    } catch (e) {
      console.error('scheduledNewClientSms 오류:', e);
    }
    return null;
  });

// ─── 현장활동(field_visits) 고객관리 기록 시 경보 즉시 해제 ─────────────
// 기사가 dashboard에서 customer_care 기록 저장 → 해당 거래처 미해결 경보 즉시 resolved
exports.onFieldVisitCreated = functions
  .region('us-central1')
  .firestore.document('field_visits/{visitId}')
  .onCreate(async (snap, context) => {
    const visit = snap.data();
    const { type, clientName, driverName } = visit;

    // customer_care(고객관리) 기록만 처리
    if (type !== 'customer_care' || !clientName) return null;

    try {
      // 해당 거래처의 미해결 경보 조회
      const alertSnap = await db.collection('alerts')
        .where('clientName', '==', clientName)
        .where('resolved', '==', false)
        .get();

      if (alertSnap.empty) {
        console.log(`현장활동 기록: ${clientName} — 미해결 경보 없음`);
        return null;
      }

      const batch = db.batch();
      alertSnap.forEach(doc => {
        batch.update(doc.ref, {
          resolved: true,
          resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          resolvedReason: 'field_visit',
          resolvedBy: driverName || '기사',
        });
      });
      await batch.commit();

      console.log(`✅ 현장활동 → 경보 해제: ${clientName} (${alertSnap.size}건) by ${driverName}`);
    } catch (e) {
      console.error('onFieldVisitCreated 경보 해제 오류:', e);
    }
    return null;
  });

// ─── 미해결 경보 자동 해제 스케줄러 (매일 KST 00:05) ──────────────────
// autoResolveAt 이 지난 경보를 자동으로 resolved 처리
// KST 00:05 = UTC 15:05 전날 → cron: '5 15 * * *'
exports.autoResolveAlerts = functions
  .region('us-central1')
  .pubsub.schedule('5 15 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    console.log('=== 경보 자동 해제 스케줄러 시작 ===');
    try {
      const now = admin.firestore.Timestamp.now();
      const snap = await db.collection('alerts')
        .where('resolved', '==', false)
        .where('autoResolveAt', '<=', now)
        .get();

      if (snap.empty) {
        console.log('자동 해제 대상 없음');
        return null;
      }

      const batch = db.batch();
      snap.forEach(doc => {
        batch.update(doc.ref, {
          resolved: true,
          resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
          resolvedReason: 'auto_expired',
        });
        console.log(`자동 해제: ${doc.data().clientName} (${doc.data().consecutiveDays}일)`);
      });
      await batch.commit();
      console.log(`=== 자동 해제 완료: ${snap.size}건 ===`);
    } catch (e) {
      console.error('autoResolveAlerts 오류:', e);
    }
    return null;
  });

// ─── 기사 피드백 스케줄러 ─────────────────────────────────────
// 매일 KST 07:00 (UTC 22:00 전날) 기사별 미주문 경보 문자 발송
// + 이틀 경과 미피드백 경보 자동 처리
exports.scheduledDriverFeedbackSms = functions
  .region('us-central1')
  .pubsub.schedule('0 22 * * *') // UTC 22:00 = KST 07:00
  .timeZone('UTC')
  .onRun(async () => {
    const now = new Date();
    // KST 기준 오늘 날짜
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = kstNow.toISOString().slice(0, 10);
    // 이틀 전 날짜 (자동처리 기준)
    const twoDaysAgo = new Date(kstNow.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    console.log(`=== 기사 피드백 스케줄러 시작: ${today} ===`);

    try {
      // ── 1. 이틀 경과 미피드백 자동 처리 ──────────────────────
      const expiredSnap = await db.collection('alerts')
        .where('resolved', '==', false)
        .where('feedbackStatus', '==', 'pending')
        .where('feedbackDeadline', '<=', today)
        .get();

      if (!expiredSnap.empty) {
        const batch = db.batch();
        for (const doc of expiredSnap.docs) {
          const a = doc.data();
          // 미이행 로그 기록
          await db.collection('driver_feedback_log').add({
            alertId: doc.id,
            driverName: a.driverName || '',
            teamId: a.teamId || '',
            courseId: a.courseId || '',
            clientName: a.name || '',
            feedback: null,
            feedbackExtra: null,
            status: 'expired',
            isCompliant: false,
            date: a.feedbackDeadline || today,
            yearMonth: today.slice(0, 7),
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          batch.update(doc.ref, {
            feedbackStatus: 'expired',
            resolved: true,
            resolvedAt: admin.firestore.FieldValue.serverTimestamp(),
            resolvedReason: 'feedback_expired',
          });
          console.log(`미이행 자동처리: ${a.name} (${a.driverName || '기사미상'})`);
        }
        await batch.commit();
        console.log(`자동처리 완료: ${expiredSnap.size}건`);
      }

      // ── 2. 기사별 미주문 경보 문자 발송 ──────────────────────
      // 미해결 + 피드백 대기 중인 경보 전체 조회
      const alertsSnap = await db.collection('alerts')
        .where('resolved', '==', false)
        .get();

      if (alertsSnap.empty) {
        console.log('발송할 경보 없음');
        return null;
      }

      // 기사별 courseId 맵 로드
      const usersSnap = await db.collection('users').get();
      const courseDriverMap = {}; // courseId → { name, phone, userId }
      usersSnap.forEach(d => {
        const u = d.data();
        if (u.courseId && u.phone && u.active !== false) {
          courseDriverMap[u.courseId] = { name: u.name, phone: u.phone };
        }
      });

      // 경보를 코스별로 그룹핑
      const driverAlerts = {}; // driverName → [alerts]
      const deadlineDate = new Date(kstNow.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      for (const doc of alertsSnap.docs) {
        const a = doc.data();
        const courseId = a.courseId;
        if (!courseId) continue;
        const driver = courseDriverMap[courseId];
        if (!driver) continue;

        // feedbackStatus 초기화 (없으면 pending으로 설정)
        if (!a.feedbackStatus) {
          await doc.ref.update({
            feedbackStatus: 'pending',
            feedbackDeadline: deadlineDate,
            driverName: driver.name,
            feedbackRequired: true,
          });
        }

        if (!driverAlerts[driver.name]) {
          driverAlerts[driver.name] = { phone: driver.phone, alerts: [] };
        }
        driverAlerts[driver.name].alerts.push({
          id: doc.id,
          name: a.name || '',
          grade: a.grade || 'check',
          consecutiveDays: a.consecutiveDays || 0,
        });
      }

      // 기사별 문자 발송
      let sentCount = 0;
      for (const [driverName, info] of Object.entries(driverAlerts)) {
        if (!info.alerts.length) continue;

        // 등급별 정렬: urgent → watch → check
        const gradeOrder = { urgent: 0, watch: 1, check: 2 };
        info.alerts.sort((a, b) => (gradeOrder[a.grade] || 2) - (gradeOrder[b.grade] || 2));

        const urgentList = info.alerts.filter(a => a.grade === 'urgent');
        const watchList  = info.alerts.filter(a => a.grade === 'watch');
        const checkList  = info.alerts.filter(a => a.grade === 'check');

        let lines = [`[준도시락 배송관리]`, `안녕하세요 ${driverName} 기사님 👋`, ``, `담당 거래처 미주문 현황입니다.`, ``];

        if (urgentList.length) {
          lines.push(`🔴 즉시경보`);
          urgentList.forEach(a => lines.push(` · ${a.name} — ${a.consecutiveDays}일 연속`));
          lines.push('');
        }
        if (watchList.length) {
          lines.push(`🟡 주시`);
          watchList.forEach(a => lines.push(` · ${a.name} — ${a.consecutiveDays}일 연속`));
          lines.push('');
        }
        if (checkList.length) {
          lines.push(`🟠 확인보고`);
          checkList.forEach(a => lines.push(` · ${a.name} — ${a.consecutiveDays}일 연속`));
          lines.push('');
        }

        lines.push(`오늘 중으로 배송관리 앱에`);
        lines.push(`피드백을 입력해주세요.`);
        lines.push(`(미입력 시 이틀 후 자동처리)`);

        const text = lines.join('\n');
        const result = await sendOneSms(info.phone, text);

        await db.collection('sms_logs').add({
          type: 'driver_feedback_request',
          driverName,
          phone: info.phone,
          alertCount: info.alerts.length,
          text,
          sent: result.ok ? 1 : 0,
          failed: result.ok ? 0 : 1,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          date: today,
        });

        if (result.ok) sentCount++;
        console.log(`문자 ${result.ok ? '발송' : '실패'}: ${driverName} (경보 ${info.alerts.length}건)`);
      }

      console.log(`=== 기사 문자 발송 완료: ${sentCount}/${Object.keys(driverAlerts).length}명 ===`);
    } catch (e) {
      console.error('scheduledDriverFeedbackSms 오류:', e);
    }
    return null;
  });
