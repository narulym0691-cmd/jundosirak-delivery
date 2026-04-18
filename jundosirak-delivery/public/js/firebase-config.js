// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyCMUqXPDxPyqnRIBRV2UIgxbShWzEUD5yg",
  authDomain: "jundosirak-delivery-ae87f.firebaseapp.com",
  projectId: "jundosirak-delivery-ae87f",
  storageBucket: "jundosirak-delivery-ae87f.firebasestorage.app",
  messagingSenderId: "758374011966",
  appId: "1:758374011966:web:b379171e702e521830ed6f"
};

// Firebase 초기화 (중복 방지)
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const db = firebase.firestore();
const auth = firebase.auth();
let storage = null;
try { storage = firebase.storage(); } catch(e) {}

// 현재 년월 (YYYY-MM 형식)
function getCurrentYearMonth() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// 등급 계산
function calcGrade(cumulative, stats) {
  if (!stats) return '-';
  if (cumulative >= stats.gradeA) return 'A';
  if (cumulative >= stats.gradeB) return 'B';
  if (cumulative >= stats.gradeC) return 'C';
  return '기준미달';
}

// 등급 뱃지 색상
function gradeColor(grade) {
  switch (grade) {
    case 'A': return '#2f855a';
    case 'B': return '#38a169';
    case 'C': return '#68d391';
    default: return '#a0aec0';
  }
}

// 숫자 천단위 콤마
function numFormat(n) {
  if (n == null) return '-';
  return Number(n).toLocaleString();
}
