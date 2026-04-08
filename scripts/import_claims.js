const admin = require('firebase-admin');
const https = require('https');

// SA 키 경로
const SA_KEY = require('/home/work/.openclaw/workspace/jundosirak-delivery-sa.json');
admin.initializeApp({ credential: admin.credential.cert(SA_KEY) });
const db = admin.firestore();

// 구글시트 CSV URLs
const SHEETS = [
  { url: 'https://docs.google.com/spreadsheets/d/1-cw2uOlbPyA8vjSrs5O6SyRBl9bgiMSfb5lQPQ6F9DM/gviz/tq?tqx=out:csv&gid=227649692', type: '상함' },
  { url: 'https://docs.google.com/spreadsheets/d/1-cw2uOlbPyA8vjSrs5O6SyRBl9bgiMSfb5lQPQ6F9DM/gviz/tq?tqx=out:csv&gid=362633177', type: '이물' },
  { url: 'https://docs.google.com/spreadsheets/d/1-cw2uOlbPyA8vjSrs5O6SyRBl9bgiMSfb5lQPQ6F9DM/gviz/tq?tqx=out:csv&gid=1690872474', type: '오배송누락' },
  { url: 'https://docs.google.com/spreadsheets/d/1-cw2uOlbPyA8vjSrs5O6SyRBl9bgiMSfb5lQPQ6F9DM/gviz/tq?tqx=out:csv&gid=1352070318', type: '지연' },
];

function fetchCsv(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCsv(text) {
  const lines = text.trim().split('\n');
  return lines.slice(1).map(line => {
    const cols = [];
    let cur = '', inQuote = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') { inQuote = !inQuote; }
      else if (line[i] === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; }
      else cur += line[i];
    }
    cols.push(cur.trim());
    return cols;
  }).filter(r => r.some(c => c));
}

function toNum(s) { return parseFloat((s||'').replace(/,/g,'')) || 0; }

async function importSheet(sheetInfo) {
  console.log(`\n📥 ${sheetInfo.type} 가져오는 중...`);
  const csv = await fetchCsv(sheetInfo.url);
  const rows = parseCsv(csv);
  const docs = [];

  rows.forEach(r => {
    if (!r[2] || !r[2].match(/\d{4}-\d{2}-\d{2}/)) return;
    const base = { date: r[2], createdAt: admin.firestore.FieldValue.serverTimestamp(), csCompleted: false };

    if (sheetInfo.type === '상함') {
      // 년도,월,날짜,온도,습도,업체명,품목명,수량,메뉴명,내용,사무실대응,(빈칸),담당기사
      docs.push({ ...base, type:'상함', temperature:toNum(r[3]), humidity:toNum(r[4]),
        clientName:r[5]||'', menu:r[8]||'', quantity:toNum(r[7]),
        content:r[9]||'', officeResponse:r[10]||'', driverName:r[12]||'' });
    } else if (sheetInfo.type === '이물') {
      // 년도,월,날짜,업체명,품목명,수량,메뉴명,내용
      docs.push({ ...base, type:'이물', clientName:r[3]||'',
        menu:r[6]||'', quantity:toNum(r[5]), content:r[7]||'', driverName:'' });
    } else if (sheetInfo.type === '오배송누락') {
      // 년도,월,날짜,기사명,유형,업체명,내용,금액,부담금
      const t = (r[4]||'').includes('오배송') && (r[4]||'').includes('누락') ? '오배송 및 누락'
              : (r[4]||'').includes('오배송') ? '오배송' : '누락';
      docs.push({ ...base, type:t, driverName:r[3]||'', clientName:r[5]||'',
        content:r[6]||'', amount:toNum(r[7]), driverBurden:toNum(r[8]) });
    } else if (sheetInfo.type === '지연') {
      // 년도,월,날짜,기사명,유형,업체명,내용
      docs.push({ ...base, type:'지연', driverName:r[3]||'', clientName:r[5]||'', content:r[6]||'' });
    }
  });

  console.log(`  → ${docs.length}건 파싱 완료`);

  // 100건씩 배치 저장
  let saved = 0;
  for (let i = 0; i < docs.length; i += 100) {
    const batch = db.batch();
    docs.slice(i, i+100).forEach(d => batch.set(db.collection('claims').doc(), d));
    await batch.commit();
    saved += Math.min(100, docs.length - i);
    console.log(`  → ${saved}/${docs.length} 저장됨`);
  }
  return docs.length;
}

async function main() {
  let total = 0;
  for (const sheet of SHEETS) {
    total += await importSheet(sheet);
  }
  console.log(`\n✅ 총 ${total}건 import 완료!`);
  process.exit(0);
}

main().catch(e => { console.error('❌ 오류:', e.message); process.exit(1); });
