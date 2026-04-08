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

// ─── 새벽 4:30 자동문자 스케줄러 ─────────────────────────────
// KST 04:30 = UTC 19:30 전날 → cron: '30 19 * * *'
exports.scheduledSmsAtDawn = functions
  .region('us-central1')
  .pubsub.schedule('30 19 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    console.log('=== 새벽 자동문자 스케줄러 시작 ===');

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
          type,          // 'new_client' | 'priority_client'
          driverName,
          clientName,
          menu,
          quantity,
          teamId,
          teamName,
          courseId,
        } = task;

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
        const text = templates[templateIdx](vars);

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

