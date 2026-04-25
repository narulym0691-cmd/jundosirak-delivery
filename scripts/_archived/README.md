# Archived Scripts

이 폴더에는 **더 이상 사용하지 않는 스크립트**가 보관돼 있습니다.
**절대 직접 실행하지 마세요.** 운영 데이터를 망가뜨릴 수 있습니다.

복구가 필요하면 코드를 참고만 하고, 현재 운영 로직(`functions/index.js`의 트리거 함수, `public/admin.html`의 UI 로직)과 일치하도록 다시 작성해서 사용하세요.

---

## rebuild_alerts.js (2026-04-25 폐기)

### 폐기 사유

이 스크립트가 **`source: backfill_2026_04`** 라벨로 alert 96건을 일괄 생성했고, 그중 미해결 10건에 `autoResolveAt` 필드가 누락되어 자동 해제가 안 되는 문제를 일으켰습니다.

### 코드 결함 (당시 발견)

1. **`autoResolveAt` 필드 미설정** — 자동 해제 안 됨
2. **`dailyAvgOrder` 필드명 사용** — 실제 clients 컬렉션은 `dailyAvg`
3. **1순위 기준 `>= 8`** — 실제 운영은 `>= 6`
4. **`name` 필드 누락** — `clientName`만 저장, 대시보드는 `name` 우선 조회
5. **`watch` 등급 생성** — 현재 운영 정책에서 안 씀
6. **구 SA 키 사용** — `jundosirak-delivery-sa.json` (현재는 `jundosirak-delivery-ae87f-sa-new.json`)

### 대체 경로

이제 alert 생성/갱신은 **단일 진실 소스(SSoT)** 로 일원화돼 있습니다:

- **운영 자동 처리**: `functions/index.js` → `onSalesDailyWrite` (Firestore 트리거)
  - sales_daily 문서가 쓰일 때마다 자동으로 alert 재계산
- **수동 (UI)**: `public/admin.html` → `createAlertsFromSales` (업로드 시 즉시 실행)
- **자동 만료 해제**: `functions/index.js` → `autoResolveAlerts` (매일 KST 00:05 cron)

backfill 필요한 상황이 다시 와도 새 스크립트 만들지 말고, sales_daily 문서를 재업로드/재기록하면 자동으로 alert가 정확하게 재계산됩니다 (`scripts/rebuild_from_excel.js` 참고).
