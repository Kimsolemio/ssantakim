# 우리집 요리 (family-cook)

가족용 레시피·냉장고·장보기 웹앱(PWA). 기획서: [`docs/cooking-app-plan.md`](docs/cooking-app-plan.md)

> 저장소 루트의 `index.html`은 별개의 실험물이며 이 앱과 무관합니다.

## 구조

```
apps/web        Vite + React + TypeScript + Tailwind + PWA (프론트)
apps/worker     Cloudflare Worker (AI 호출·키 보관, 2단계부터 사용)
packages/shared zod 스키마·타입·유틸 (프론트/Worker 공용)
firestore.rules Firestore 보안 규칙
scripts/        아이콘 생성기 등
```

## 진행 단계

| 단계 | 내용 | 상태 |
|------|------|------|
| 1 | 워크스페이스·스키마·로그인·가족 공유·냉장고 탭·PWA | ✅ 완료 |
| 2 | Worker + 음식 이름 → AI 레시피 + 저장/폴더/스케일링 | ✅ 완료 |
| 3 | 쿡 모드(단계별 화면·타이머·음성) | 예정 |
| 4 | 재료 정규화·냉장고 대조·요리 완료 차감·장보기 | 예정 |
| 5 | 유튜브/인스타 가져오기 + 공유 진입 | 예정 |
| 6 | 사진으로 재료 등록 + 오늘 뭐 먹지 | 예정 |
| 7 | 식단 캘린더·오프라인·마무리 | 예정 |

## 처음 설정 (1회)

1. **Firebase 프로젝트 생성** (console.firebase.google.com)
   - Authentication → 로그인 방법 → **Google** 사용 설정
   - Firestore Database 생성(프로덕션 모드) → 규칙 탭에 `firestore.rules` 내용 붙여넣기 → 게시
   - 프로젝트 설정 → 내 앱 → 웹 앱 추가 → 설정값 복사
2. `apps/web/.env.example`을 `apps/web/.env`로 복사하고 값 채우기
3. 설치·실행

```bash
pnpm install
pnpm dev            # http://localhost:5173  (같은 와이파이의 폰에서는 --host 주소로 접속)
pnpm build          # apps/web/dist 생성
pnpm typecheck
```

폰에 설치: 사파리/크롬에서 열고 "홈 화면에 추가".

배포(권장 무료): Cloudflare Pages 또는 Firebase Hosting에 `apps/web/dist` 업로드. Firebase 콘솔 Authentication → 승인된 도메인에 배포 도메인 추가.

## AI 서버(Worker) 설정 — 2단계부터

AI 호출은 Cloudflare Worker(`apps/worker`)가 대신 한다. API 키는 Worker에만 있고 브라우저에는 절대 없다.

1. [console.anthropic.com](https://console.anthropic.com)에서 API 키 발급, **월 지출 한도** 설정
2. Cloudflare 계정 생성 → `pnpm --filter @cook/worker exec wrangler login`
3. `apps/worker/wrangler.toml`의 `[vars]` 수정
   - `FIREBASE_PROJECT_ID`: Firebase 프로젝트 ID (토큰 검증용)
   - `ALLOWED_ORIGINS`: 앱 주소들 (쉼표 구분, 예: `http://localhost:5173,https://cook.example.pages.dev`)
   - `ALLOWED_EMAILS`: 가족 구글 계정 이메일 (쉼표 구분). **비워두면 구글 계정이 있는 누구나 AI를 호출할 수 있으니 꼭 채우자**
4. 비밀값 등록 후 배포

```bash
pnpm --filter @cook/worker exec wrangler secret put ANTHROPIC_API_KEY
pnpm worker:deploy        # 끝나면 https://family-cook-api.<계정>.workers.dev 주소가 나온다
```

5. 그 주소를 `apps/web/.env`의 `VITE_WORKER_URL`에 넣고 프론트 다시 빌드·배포
6. 확인: 브라우저에서 `https://.../health` → `{"ok":true,...,"configured":{"firebase":true,"anthropic":true}}`

로컬 개발: `apps/worker/.dev.vars.example`을 `.dev.vars`로 복사해 채우고 `pnpm worker:dev` (http://localhost:8787).

사용 모델: 레시피 생성 `claude-opus-5-5` (레시피 1건 ≈ 40원). AI가 안전 정책으로 거절하면 같은 호출에서 대체 모델로 자동 재시도하도록(`fallbacks: "default"`) 켜 두었다. 모든 프롬프트는 `apps/worker/src/prompts.ts` 한 파일에 있다.

## 로컬 에뮬레이터로 개발·테스트 (선택)

실제 Firebase 프로젝트 없이도 돌릴 수 있다. Java 필요.

```bash
npx firebase-tools setup:emulators:firestore
npx firebase-tools emulators:start --only auth,firestore --project demo-cook   # firebase.json 필요 (아래)
```

`apps/web/.env`에 `VITE_USE_EMULATORS=1`, `VITE_FIREBASE_PROJECT_ID=demo-cook`, 나머지 Firebase 값은 아무 문자열. 이 모드에서는 로그인 화면에서 `window.__cookTest.signInAs("me@test.local","이름")`으로 가짜 구글 로그인이 된다(자동 테스트용).

## 자동 테스트

- Worker 단위/통합 테스트와 공용 스키마 테스트: 별도 러너 없이 esbuild로 묶어 Node로 실행 (CI 구성은 추후).
- 브라우저 E2E(`e2e/run.mjs`): 가족 생성 → AI 레시피 생성 → 편집·저장 → 인분 환산 → 즐겨찾기·폴더 → 실패 처리 → 냉장고 → 두 번째 가족 구성원 초대 참여 → 실시간 반영까지 한 번에 검증한다. 터미널 3개가 필요하다.

```bash
# 1) Firebase 에뮬레이터 (Java 필요, 처음 한 번 npx firebase-tools setup:emulators:firestore)
npx firebase-tools emulators:start --only auth,firestore --project demo-cook --config e2e/firebase.json
# 2) 가짜 AI Worker (고정 레시피를 돌려준다)
node e2e/mock-worker.mjs
# 3) 앱 (에뮬레이터 모드)
cp e2e/.env.emulator apps/web/.env && pnpm dev
# 실행 (처음 한 번 npx playwright install chromium)
node e2e/run.mjs
```

## 2단계 수동 테스트 절차

1. Worker `/health`가 `configured.anthropic: true`를 돌려준다.
2. 레시피 탭 → ✨ → "알리오올리오", 3인분, 추가 요청 "덜 맵게" → 레시피 만들기 → 20~60초 뒤 **확인·수정** 화면이 뜬다.
3. 재료·순서·팁을 고쳐 보고 저장 → 상세 화면. 재료가 그룹(주재료/양념/고명)별로 보인다.
4. 인분 +/−: 수량이 환산된다. "약간"(인분 고정) 재료는 그대로. 기준 인분 안내 문구가 뜬다.
5. ★ 즐겨찾기 → 목록에 별 표시. ⋯ → 폴더 이동, 수정, 삭제.
6. 폴더 관리에서 폴더 추가 → 칩 필터로 걸러진다. 검색창에 재료 이름(예: 마늘)으로도 찾아진다.
7. 가족 메뉴(우상단)에서 취향(맵기·알레르기·아이)을 저장 → 다음 생성에 반영된다(생성 시트 아래 안내 문구).
8. 다른 가족 폰에서 같은 레시피가 보이고, 한쪽에서 수정하면 다른 쪽에 바로 반영된다.
9. Worker 주소를 틀리게 넣으면 "서버에 연결할 수 없습니다", API 키가 틀리면 "AI API 키가 올바르지 않습니다"가 뜬다.
10. 안드로이드 뒤로가기/iOS 스와이프백으로 상세·편집·시트가 닫히고 앱은 종료되지 않는다.

## 1단계 수동 테스트 절차

1. `.env` 없이 실행 → "설정이 필요해요" 안내 화면이 뜬다.
2. `.env` 채우고 실행 → "Google로 시작하기" → 로그인된다. (홈 화면 설치 상태에서는 리다이렉트 방식으로 동작)
3. "새 가족 만들기" → 이름 입력 → 냉장고 탭이 열리고 우상단에 가족 이름이 보인다.
4. 우상단 가족 버튼 → 초대 코드 6자리 확인.
5. 다른 계정(가족 폰)으로 로그인 → "초대 코드로 참여" → 같은 냉장고가 보인다.
6. + 버튼 → "대파, 2개, 냉장, +3일" 저장 → 목록에 D-3 빨간 배지로 표시된다. 다른 폰에서도 즉시 보인다.
7. 항목 탭 → 수량/위치/유통기한 수정 → 저장. 삭제도 확인.
8. 유통기한 없음/지난 날짜/오늘 날짜 각각 배지 표시(없음·회색 취소선·"오늘까지").
9. 검색창에 이름 일부 입력 → 필터링된다.
10. 다른 탭(레시피/장보기/뭐 먹지)은 "N단계에서 만들어집니다" 안내만 보인다.
