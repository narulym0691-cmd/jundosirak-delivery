// auth.js - 로그인/로그아웃 공통 모듈

// localStorage 키
const LS_USER_KEY = 'jundosirak_user';

// 저장된 사용자 가져오기
function getSavedUser() {
  try {
    const raw = localStorage.getItem(LS_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

// 사용자 저장
function saveUser(userData) {
  localStorage.setItem(LS_USER_KEY, JSON.stringify(userData));
}

// 로그아웃
function logout() {
  localStorage.removeItem(LS_USER_KEY);
  auth.signOut().catch(() => {});
  window.location.href = '/index.html';
}

// 역할에 따른 리다이렉트 경로
function getRoleRedirect(role) {
  if (role === 'admin' || role === 'manager') {
    return '/admin.html';
  }
  return '/dashboard.html';
}
// ※ driver 포함 모든 역할은 dashboard.html로 이동 (vehicle.html 직접 진입 제거)

// 로그인 필요 페이지에서 인증 확인
// requiredRoles: 배열 (빈 배열이면 모두 허용)
function requireAuth(requiredRoles) {
  const user = getSavedUser();
  if (!user) {
    window.location.href = '/index.html';
    return null;
  }
  if (requiredRoles && requiredRoles.length > 0) {
    if (!requiredRoles.includes(user.role)) {
      window.location.href = getRoleRedirect(user.role);
      return null;
    }
  }
  return user;
}

// index.html에서 이미 로그인된 경우 리다이렉트
function redirectIfLoggedIn() {
  const user = getSavedUser();
  if (user) {
    window.location.href = getRoleRedirect(user.role);
  }
}
