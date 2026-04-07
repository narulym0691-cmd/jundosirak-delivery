const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// 기사-팀 매핑 (users 컬렉션 기반, 없을 경우 fallback용)
const COURSE_TEAM_MAP = {
  '코스1': { teamId: 'team2', teamName: '해운대' },
  '코스2': { teamId: 'team2', teamName: '해운대' },
  '코스3': { teamId: 'team4', teamName: '연수남' },
  '코스4': { teamId: 'team3', teamName: '공오일(051)' },
  '코스5': { teamId: 'team1', teamName: '준고' },
  '코스6': { teamId: 'team1', teamName: '준고' },
  '코스7': { teamId: 'team2', teamName: '해운대' },
  '코스8': { teamId: 'team4', teamName: '연수남' },
  '코스9': { teamId: 'team1', teamName: '준고' },
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

exports.deliveryComplete = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    // CORS 허용
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    try {
      const { driverId, courseId, completedAt, clientName } = req.body;

      // 필수값 검증
      if (!driverId || !courseId || !completedAt) {
        res.status(400).json({ error: 'driverId, courseId, completedAt 필수' });
        return;
      }

      // 기사 정보 조회 (users 컬렉션)
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

      // teamId 없으면 courseId로 fallback
      if (!teamId && courseId && COURSE_TEAM_MAP[courseId]) {
        teamId = COURSE_TEAM_MAP[courseId].teamId;
        teamName = COURSE_TEAM_MAP[courseId].teamName;
      }

      // delivery_logs에 저장
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
        source: 'app'
      });

      console.log(`배송완료 수신: ${driverName}(${courseId}) → ${clientName || '-'} at ${completedAt}`);

      res.status(200).json({
        ok: true,
        message: '배송완료 기록 저장 성공',
        logId: logRef.id,
        driverName,
        teamName
      });

    } catch (e) {
      console.error('deliveryComplete 오류:', e);
      res.status(500).json({ error: '서버 오류: ' + e.message });
    }
  });

// SMS 발송 함수
const crypto = require('crypto');

const SOLAPI_KEY = 'NCSJP3I9QX02TKZO';
const SOLAPI_SECRET = 'JSBXRDGAFLL0DLTNAOP2EAEERH90FRMS';
const SOLAPI_FROM = '0517154600';

function getSolapiAuth() {
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString('hex');
  const hmac = crypto.createHmac('sha256', SOLAPI_SECRET);
  hmac.update(date + salt);
  const signature = hmac.digest('hex');
  return `HMAC-SHA256 apiKey=${SOLAPI_KEY}, date=${date}, salt=${salt}, signature=${signature}`;
}

// ── 경보 생성 시 팀장 자동 문자 발송 ──────────────────────────
exports.onAlertCreated = functions
  .region('us-central1')
  .firestore.document('alerts/{alertId}')
  .onCreate(async (snap, context) => {
    const alert = snap.data();
    const { clientName, courseId, level, consecutiveDays, teamId } = alert;

    // 주시(watch) 이상만 문자 발송
    if (!level || level === 'check') return null;

    const levelLabel = level === 'urgent' ? '🚨 즉시경보' : '⚠️ 주시경보';

    try {
      // 해당 팀의 팀장 조회
      let leaderPhone = null;
      let leaderName = null;

      // teamId로 팀장 찾기
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

      const text = `[준도시락 배송관리] ${levelLabel}\n거래처: ${clientName}\n${consecutiveDays ? consecutiveDays+'일 연속 미주문' : ''}\n\n확인 후 조치 결과를 시스템에 입력해주세요.`;

      const https = require('https');
      const body = JSON.stringify({
        message: {
          to: leaderPhone.replace(/-/g, ''),
          from: SOLAPI_FROM,
          text
        }
      });

      await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.solapi.com',
          path: '/messages/v4/send',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': getSolapiAuth(),
            'Content-Length': Buffer.byteLength(body)
          }
        };
        const r = require('https').request(options, res => {
          let data = '';
          res.on('data', d => data += d);
          res.on('end', () => {
            console.log(`경보 문자 발송(${leaderName}): ${data}`);
            resolve();
          });
        });
        r.on('error', reject);
        r.write(body);
        r.end();
      });

      // 문자 발송 이력 저장
      await db.collection('sms_logs').add({
        type: 'alert_auto',
        alertId: context.params.alertId,
        clientName,
        level,
        targets: [leaderName],
        text,
        sent: 1,
        failed: 0,
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // alert 문서에 문자발송 기록
      await snap.ref.update({
        smsSentAt: admin.firestore.FieldValue.serverTimestamp(),
        smsSentTo: leaderName
      });

      console.log(`경보 자동문자 발송 완료: ${clientName} → ${leaderName}(${leaderPhone})`);

    } catch (e) {
      console.error('경보 자동문자 발송 실패:', e);
    }
    return null;
  });

exports.sendSms = functions
  .region('us-central1')
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

    try {
      const { targets, text, from } = req.body;
      if (!targets || !text) { res.status(400).json({ error: 'targets, text 필수' }); return; }

      const https = require('https');
      let sent = 0, failed = 0;

      // 개별 발송 (솔라피 단건 발송)
      const sendOne = (phone, name) => new Promise((resolve) => {
        const body = JSON.stringify({
          message: {
            to: phone.replace(/-/g, ''),
            from: (from || SOLAPI_FROM).replace(/-/g, ''),
            text: text
          }
        });

        const options = {
          hostname: 'api.solapi.com',
          path: '/messages/v4/send',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': getSolapiAuth(),
            'Content-Length': Buffer.byteLength(body)
          }
        };

        const r = https.request(options, response => {
          let data = '';
          response.on('data', d => data += d);
          response.on('end', () => {
            const parsed = JSON.parse(data);
            if (parsed.statusCode === '2000' || response.statusCode === 200) {
              console.log(`SMS 발송 성공: ${name}(${phone})`);
              resolve(true);
            } else {
              console.error(`SMS 발송 실패: ${name}(${phone})`, data);
              resolve(false);
            }
          });
        });
        r.on('error', e => { console.error('SMS 오류:', e); resolve(false); });
        r.write(body);
        r.end();
      });

      for (const t of targets) {
        const ok = await sendOne(t.phone, t.name);
        if (ok) sent++; else failed++;
      }

      // 발송 이력 Firestore 저장
      await db.collection('sms_logs').add({
        targets: targets.map(t => t.name),
        text,
        sent, failed,
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });

      res.status(200).json({ ok: true, sent, failed });

    } catch(e) {
      console.error('sendSms 오류:', e);
      res.status(500).json({ ok: false, error: e.message });
    }
  });
