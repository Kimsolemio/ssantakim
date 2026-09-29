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
| 2 | Worker + 음식 이름 → AI 레시피 + 저장/폴더/스케일링 | 예정 |
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
