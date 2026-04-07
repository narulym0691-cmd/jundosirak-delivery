// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyARaQ_iFPRKBhMOrRcX0fhQtLGlZtC7UHo",
  authDomain: "jundosirak-delivery.firebaseapp.com",
  projectId: "jundosirak-delivery",
  storageBucket: "jundosirak-delivery.firebasestorage.app",
  messagingSenderId: "570663336725",
  appId: "1:570663336725:web:16f1a6662196d6ce7c071c"
};

// Firebase 초기화
firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();

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
