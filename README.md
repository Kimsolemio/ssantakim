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
| 3 | 쿡 모드(단계별 화면·타이머·음성) | ✅ 완료 |
| ★ | 가상 냉장고 + 영수증·주문내역 캡처로 채우기 | ✅ 완료 (6단계 일부를 앞당김) |
| 4 | 재료 정규화·냉장고 대조·요리 완료 차감·장보기 | ✅ 완료 |
| 5 | 유튜브/인스타 가져오기 + 공유 진입 | ✅ 완료 |
| 6 | 사진으로 재료 등록 + 오늘 뭐 먹지 | ✅ 완료 |
| 7 | 이번 주 식단·오프라인 열람·임박 배지·마무리 | ✅ 완료 |
| UI | 전면 개편(솔잎색·Pretendard·공통 부품·다크 모드) | ✅ 완료 |
| ★ | 오늘의 인기 레시피(유튜브 쇼츠 좋아요 1만+ 한국·미국·스페인·일본 하루 50개 안팎을 "더 보기"로, 냉장고 재료 먼저, PC는 양옆 큰 카드) | ✅ 완료 |

## 체험판 (계정 없이 둘러보기)

`pnpm --filter @cook/web build:demo` → `apps/web/dist-demo/page.html`(+ 글꼴 파일). Firebase·AI 서버 없이 예시 데이터로 돌고, 고친 것은 그 기기에만 저장된다. AI는 미리 준비한 예시로 답한다.

## 컴퓨터 없이 배포하기 (자동 배포, 권장)

브라우저에서 계정 3개를 만들고 값 6개를 GitHub 설정에 넣으면, GitHub Actions(`.github/workflows/deploy.yml`)가 앱과 AI 서버를 올린다. **키는 채팅·메신저에 붙여 넣지 말고 GitHub 설정에만 넣는다.**

1. **Firebase** (console.firebase.google.com)
   1. 프로젝트 추가 → 이름(예: `ssantakim-cook`) → 애널리틱스는 꺼도 된다 → 만들기
   2. 빌드 → **Authentication** → 시작하기 → 로그인 방법 → **Google** → 사용 설정 → 저장
   3. 빌드 → **Firestore Database** → 데이터베이스 만들기 → 위치 `asia-northeast3`(서울) → 프로덕션 모드
   4. 빌드 → **Hosting** → 시작하기 → 끝까지 다음 (명령어 안내는 따라 하지 않아도 된다)
   5. 톱니 → 프로젝트 설정 → 일반 → 내 앱 → 웹(`</>`) → 닉네임 "요리" → 앱 등록 → 나오는 `const firebaseConfig = { … };` 부분을 복사 → 아래 4번의 변수 `FIREBASE_WEB_CONFIG`
   6. 프로젝트 설정 → **서비스 계정** → 새 비공개 키 생성 → 내려받은 JSON 파일 내용 전체 → 아래 4번의 비밀값 `FIREBASE_SERVICE_ACCOUNT`
   7. 같은 화면의 서비스 계정 이메일(`firebase-adminsdk-…`)에 권한 주기: Google Cloud 콘솔(console.cloud.google.com) → 이 프로젝트 → IAM 및 관리자 → IAM → 그 줄의 연필 → 다른 역할 추가 → **Firebase Admin** → 저장 (없으면 배포가 403으로 멈춘다)
2. **Claude** (console.anthropic.com): API Keys → Create Key → 비밀값 `ANTHROPIC_API_KEY`. Billing에서 크레딧 충전, Limits에서 **월 지출 한도** 설정
3. **Cloudflare** (dash.cloudflare.com, 무료 가입)
   1. 왼쪽 **Workers & Pages**를 한 번 열어 `workers.dev` 하위 도메인을 정한다 (처음 한 번)
   2. 같은 화면의 **Account ID** → 비밀값 `CLOUDFLARE_ACCOUNT_ID`
   3. 오른쪽 위 사람 아이콘 → My Profile → API Tokens → Create Token → **Edit Cloudflare Workers** 템플릿 → 만들기 → 비밀값 `CLOUDFLARE_API_TOKEN`
4. **GitHub** 저장소 → Settings → Secrets and variables → **Actions**
   - Secrets 탭 → New repository secret: `FIREBASE_SERVICE_ACCOUNT`, `ANTHROPIC_API_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variables 탭 → New repository variable: `FIREBASE_WEB_CONFIG`(5번 덩어리 그대로), `ALLOWED_EMAILS`(설치한 사람의 구글 이메일. 그 사람의 가족에 초대 코드로 들어온 가족은 따로 넣지 않아도 AI를 쓴다. 여러 가족이면 쉼표로)
5. **Actions** 탭 → 왼쪽 **Deploy** → 가장 최근 실행 → **Re-run all jobs** (이후에는 올릴 때마다 자동). 3~5분 뒤 실행 요약에 `https://<프로젝트>.web.app`이 나온다
6. 폰에서 그 주소 → 홈 화면에 추가 → Google로 시작하기 → 한 사람이 가족을 만들고 나머지는 초대 코드로

- 값이 하나라도 없으면 Deploy는 아무것도 하지 않고 "건너뜀" 안내만 남긴다. AI 키 3개 없이 Firebase 값 2개만 넣으면 AI를 뺀 앱만 올라간다.
- 선택: **오늘의 인기 레시피** 켜기 — Google Cloud 콘솔 → 이 프로젝트 → API 및 서비스 → 라이브러리 → **YouTube Data API v3** → 사용 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키 → 키 수정 → API 제한사항: YouTube Data API v3만 → 저장 → 비밀값 `YOUTUBE_API_KEY` → Deploy 다시 실행. 무료(하루 1만 단위 중 하루 몇백 단위만 쓴다). 없으면 그 칸만 안 보인다.
- 자동 배포가 하루 한도 저장소(KV `family-cook-usage`)를 없으면 만들어 연결한다(`scripts/ci-kv.mjs`, Edit Cloudflare Workers 템플릿 토큰에 KV 권한이 들어 있다). 하루 한도는 한 사람 40회·전체 150회(레시피 1건 = 1회)이고, 1분 한도(사람당 12회)와 Anthropic **월 지출 한도**가 그 위의 상한이다. **가족 공유 AI(설치한 사람 외 가족)는 이 하루 한도가 있어야만 열린다**(초대 코드가 새도 하루 손해에 상한이 있게). KV를 못 만들면 배포 기록에 경고가 남고 설치한 사람만 AI를 쓴다.
- 배포가 권한 오류(403)로 멈추면: Google Cloud 콘솔 → IAM 및 관리자 → IAM → `firebase-adminsdk-…` 서비스 계정 줄의 연필 → 다른 역할 추가 → **Firebase Admin**(Firebase 관리자) → 저장 → Deploy 다시 실행. 콘솔에서 받은 서비스 계정 키는 처음엔 보안 규칙·호스팅을 올릴 권한이 없다.

## 한눈에 보는 설치 순서 (컴퓨터에서 직접)

1. Firebase 프로젝트 만들기 → `apps/web/.env` 채우기 ([처음 설정](#처음-설정-1회)). 아이폰을 쓰면 **처음부터** `VITE_FIREBASE_AUTH_DOMAIN`을 앱을 올릴 주소(`<프로젝트>.web.app`)로 적는다 ([아이폰 로그인](#아이폰-로그인-중요))
2. Claude API 키 발급 + **월 지출 한도** → Worker 설정·배포 ([AI 서버 설정](#ai-서버worker-설정--2단계부터))
3. Worker 주소를 `VITE_WORKER_URL`에 넣고 빌드·배포
   ```bash
   npx firebase-tools login
   pnpm build
   npx firebase-tools deploy --only hosting,firestore:rules --project <프로젝트-ID>
   ```
   보안 규칙(`firestore.rules`)이 바뀐 버전으로 올릴 때도 같은 명령을 쓴다(7단계에서 식단 `meal_plans`가 추가됐다).
4. 가족 폰에 설치(홈 화면에 추가) → 한 사람이 가족을 만들고 초대 코드로 나머지가 참여
5. (선택) 아이폰 [공유 단축어](#다른-앱에서-공유로-레시피-보내기) 설치
6. [전체 수동 테스트 체크리스트](docs/manual-test.md)를 폰에서 한 번 쭉 해 본다

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

배포(권장 무료): **Firebase Hosting**에 `apps/web/dist` 업로드(`npx firebase-tools login` 후 `npx firebase-tools deploy --only hosting,firestore:rules --project <프로젝트-ID>`, 저장소에 `.firebaserc`가 없으므로 `--project`를 꼭 붙인다). Firebase 콘솔 Authentication → 승인된 도메인에 배포 도메인 추가.

### 아이폰 로그인 (중요)

아이폰 홈 화면 앱은 리다이렉트 방식으로 구글 로그인을 하는데, 사파리는 다른 사이트의 저장소를 막기 때문에 **앱 주소와 로그인 주소(`VITE_FIREBASE_AUTH_DOMAIN`)가 같아야** 로그인이 끝난다.
- 가장 쉬운 방법: 앱을 Firebase Hosting(`<프로젝트>.web.app`)에 올리고 `VITE_FIREBASE_AUTH_DOMAIN=<프로젝트>.web.app`으로 빌드한다. 내 도메인을 Firebase Hosting에 연결했다면 그 도메인을 쓴다.
- Cloudflare Pages 등 다른 곳에 올리면 `/__/auth/*` 요청을 `<프로젝트>.firebaseapp.com`으로 넘겨 주는 프록시가 필요하다 (Firebase 문서 "signInWithRedirect 권장사항" 3번 방법). 그다음 authDomain을 그 앱 주소로 바꾼다.
- 둘이 다르면 로그인 화면 아래에 "설치하는 분께" 안내가 뜬다.
- 확인: 아이폰 사파리로 열기 → 공유 → 홈 화면에 추가 → 홈 화면 아이콘으로 열기 → Google로 시작하기 → 레시피 탭이 보이면 성공. 앱을 완전히 닫았다 열어도 로그인이 유지되는지 본다.

## AI 서버(Worker) 설정 — 2단계부터

AI 호출은 Cloudflare Worker(`apps/worker`)가 대신 한다. API 키는 Worker에만 있고 브라우저에는 절대 없다.

### Claude를 이렇게 쓴다

| 기능 | 모델 | 쓰는 Claude 기능 |
|---|---|---|
| 음식 이름 → 레시피, 사진 가져오기, 레시피 바꾸기, 메뉴 추천, 영수증·식재료 사진 | `CLAUDE_MODEL` (이 배포는 `claude-sonnet-5-5`) | 구조화 출력(JSON 스키마), 사진 이해 |
| 이름 정리, AI 셰프에게 묻기, 대체 재료, 글로 된 레시피 가져오기(유튜브 설명란·웹 페이지·붙여 넣은 글) | `CLAUDE_FAST_MODEL` (기본 `claude-haiku-5-5`, 아주 쌈) | 구조화 출력, 프롬프트 캐시 |
| 음식 이름으로 만들기의 "인기 레시피 찾아서 참고" | 기본 모델 | 웹 검색(1회 약 14원) → 메모 → JSON 정리 두 단계, 참고한 글은 레시피에 남김 |
| 링크를 Worker가 못 읽을 때 | 기본 모델 | 웹 읽기(web_fetch)로 Claude가 직접 페이지를 읽음 |
| 물어보기·다른 메뉴로·이름 정리처럼 연달아 부르는 것 | | 프롬프트 캐시(같은 지시문은 5분간 입력비 1/20) |

설명란에 레시피가 없는 유튜브 영상을 "보는" 것만 Claude가 못 해서, 그때만 Gemini 키(선택)를 쓴다.

### AI 고르기

| | Claude (권장) | Gemini (무료 대안) |
|---|---|---|
| 비용 | 사용한 만큼 결제 (레시피 1건 약 100원 안팎) | 무료 등급, 카드 불필요 |
| 품질 | 레시피 디테일·한국어 표현이 더 좋음 | 단순한 편 |
| 한도 | 결제 잔액만큼 | 분당 약 10회, 하루 약 1,500회 |
| 키 이름 | `ANTHROPIC_API_KEY` | `GEMINI_API_KEY` |

둘 중 하나만 넣으면 된다. 기본값 `AI_PROVIDER = "auto"`는 Claude 키가 있으면 Claude, 없으면 Gemini를 쓴다. 강제로 고르려면 `claude` 또는 `gemini`.
코드의 Claude 모델 기본값은 `claude-opus-5-5`지만, 이 배포는 `wrangler.toml`에서 비용을 줄이려고 `CLAUDE_MODEL = "claude-sonnet-5-5"`(대략 절반 가격)로 둔다. 더 꼼꼼한 결과가 필요하면 Opus로 되돌린다.
Claude가 안전 정책으로 거절하면 같은 호출 안에서 알맞은 대체 모델로 자동 재시도하도록 켜 두었다.

> Claude Max/Pro 구독은 API 사용을 포함하지 않는다. API는 [console.anthropic.com](https://console.anthropic.com)에서 크레딧을 따로 충전해 쓴다.

### 설정 순서

1. AI 키 발급
   - Claude: console.anthropic.com → API Keys에서 키 발급 → Billing에서 크레딧 충전 → **월 지출 한도(Spend limit) 설정**
   - Gemini: [Google AI Studio](https://aistudio.google.com/apikey)에서 무료 키 발급
2. Cloudflare 계정 생성(무료) → `pnpm --filter @cook/worker exec wrangler login`
3. `apps/worker/wrangler.toml`의 `[vars]` 수정
   - `FIREBASE_PROJECT_ID`: Firebase 프로젝트 ID (토큰 검증용)
   - `ALLOWED_ORIGINS`: 앱 주소들 (쉼표 구분, 예: `http://localhost:5173,https://cook.example.pages.dev`)
   - `ALLOWED_EMAILS`: 설치한 사람(가족 대표)의 구글 이메일 (쉼표 구분). 이 사람이 있는 가족에 초대 코드로 들어온 사람은 모두 AI를 쓸 수 있다(각자 앱을 한 번 열면 자기 인증된 이메일이 가족 문서에 적히고, AI 서버가 그 사람 권한으로 가족 문서를 읽어 확인한다). **비어 있으면 AI 기능이 전부 막힌다**(비용 사고 방지). 누구나 허용하려면 `*`를 적어야 한다(권장하지 않음). 이메일 인증이 끝난 구글 계정만 맞춰 본다.
   - `DAILY_LIMIT_PER_USER` / `DAILY_LIMIT_TOTAL`: 하루 한도 (기본 40 / 150, 레시피 1·영수증/식재료 사진 2·링크 가져오기 1·글 가져오기 1(사진 있으면 2)·메뉴 추천 1로 센다. 저장할 때 뒤에서 도는 이름 정리는 세지 않는다). 한국 자정에 초기화. AI 호출이 실패하면 돌려준다. "우리 가족" 화면에 오늘 남은 횟수가 보인다.
4. 하루 한도용 저장소 만들기 (무료. 설치한 사람 외 가족에게 AI를 열어 주려면 꼭 필요, 자동 배포는 알아서 만든다): `pnpm --filter @cook/worker exec wrangler kv namespace create USAGE` → 출력된 id를 `wrangler.toml` 맨 아래 `[[kv_namespaces]]` 주석을 풀어 넣는다. 없으면 1분 한도(사람당 12회)만 동작한다.
5. 비밀값 등록 후 배포

```bash
pnpm --filter @cook/worker exec wrangler secret put ANTHROPIC_API_KEY   # Claude를 쓸 때
pnpm --filter @cook/worker exec wrangler secret put GEMINI_API_KEY      # Gemini를 쓸 때 (선택)
pnpm worker:deploy        # 끝나면 https://family-cook-api.<계정>.workers.dev 주소가 나온다
```

   - 선택: `YOUTUBE_API_KEY` (Google Cloud Console에서 YouTube Data API v3 키, 무료). 없어도 유튜브 페이지에서 설명란을 읽지만, 있으면 더 안정적이다.
     이 키가 있으면 "오늘 뭐 먹지"에 **오늘의 인기 레시피**(쇼츠 중 좋아요 1만 개 넘는 요리, 한국·미국·스페인·일본 영상만, 냉장고 재료가 제목에 나오는 것 먼저, 다섯 개마다 나라가 섞이게)가 보인다. 하루에 50개 안팎이 모이고 "더 보기"로 이어서 본다. 카드를 누르면 바로 레시피로 가져온다. PC처럼 넓은 화면에서는 가운데 앱 양옆에 큰 카드로 나온다. 서버가 하루 한 번만 유튜브에 묻고(약 400~500단위, 무료 한도 1만) 기기도 하루 동안 기억한다.
   - 유튜브 설명란에 레시피가 없을 때 영상 자체를 보고 정리하는 기능은 `GEMINI_API_KEY`가 있을 때만 동작한다(Claude는 영상을 볼 수 없다).
6. 그 주소를 `apps/web/.env`의 `VITE_WORKER_URL`에 넣고 프론트 다시 빌드·배포
7. 확인: 브라우저에서 `https://.../health` → `"ai":{"provider":"claude","model":"claude-opus-5-5"}`, `"guard":{"allowList":3,"perMinute":true,"daily":true}` (허용 이메일 수, 1분 한도, 하루 한도)

> 비용의 진짜 상한은 Anthropic 콘솔의 **월 지출 한도**다. Worker 한도는 실수·무한 반복을 막는 2차 안전장치다.

로컬 개발: `apps/worker/.dev.vars.example`을 `.dev.vars`로 복사해 채우고 `pnpm worker:dev` (http://localhost:8787).
모든 프롬프트는 `apps/worker/src/prompts.ts` 한 파일에 있다. AI 호출은 `apps/worker/src/ai/` 폴더에 제공자별로 나뉘어 있다.

## 로컬 에뮬레이터로 개발·테스트 (선택)

실제 Firebase 프로젝트 없이도 돌릴 수 있다. Java 필요.

```bash
npx firebase-tools setup:emulators:firestore
npx firebase-tools emulators:start --only auth,firestore --project demo-cook   # 저장소 루트의 firebase.json 사용
```

`apps/web/.env`에 `VITE_USE_EMULATORS=1`, `VITE_FIREBASE_PROJECT_ID=demo-cook`, 나머지 Firebase 값은 아무 문자열. 이 모드에서는 로그인 화면에서 `window.__cookTest.signInAs("me@test.local","이름")`으로 가짜 구글 로그인이 된다(자동 테스트용).

## 다른 앱에서 "공유"로 레시피 보내기

**안드로이드**: 크롬에서 앱을 열고 메뉴 → "앱 설치"(홈 화면에 추가). 그다음 유튜브·인스타·블로그 앱에서 공유 → "우리집 요리"를 고르면 바로 가져오기가 시작된다. 인스타는 공개 게시물의 캡션을 "퍼가기" 페이지에서 읽어 보고(블로그에 붙인 틀 안에서 여는 것처럼 열어야 캡션이 담겨 온다. 인스타가 막으면 캡션·스크린샷 화면이 열린다), 릴스인데 캡션에 레시피가 없으면 앱이 AI 서버를 거쳐 영상을 받아 장면을 최대 12장 뽑아 다시 정리한다(화면 글자·보이는 재료와 동작으로. 글자가 없으면 양은 "추정"으로 적는다. Claude는 영상·소리를 직접 보지 못한다). 영상을 못 받으면 릴스를 화면 녹화해 "동영상"으로 올려도 같은 방법으로 읽는다. 인스타에서 실제로 읽히는지는 Actions의 "인스타 읽기 점검"에 링크를 넣어 돌려 보면 단계별로 나온다. 인스타 이용약관은 자동 수집을 허용하지 않으므로, 가족이 직접 연 공개 게시물 한 건씩만 읽고 인스타가 막으면 10분 동안 다시 묻지 않는다. 끄려면 Worker 변수 `INSTAGRAM_EMBED=off`.

**아이폰** (iOS는 웹앱을 공유 목록에 넣을 수 없어서 단축어로 연결한다):
1. 단축어 앱 → 오른쪽 위 + → 이름 "요리앱에 저장"
2. 아래 ⓘ(정보) → "공유 시트에서 보기" 켜기, 받는 항목은 URL·텍스트
3. 동작 추가: **URL 인코딩** (입력: 단축어 입력)
4. 동작 추가: **텍스트** → `https://내-앱-주소/share?url=` 뒤에 3번 결과(URL 인코딩된 텍스트) 넣기
5. 동작 추가: **URL 열기** (입력: 4번 텍스트)
6. 유튜브·인스타·블로그에서 공유 → "요리앱에 저장"

참고: 아이폰 단축어는 사파리로 연다. 사파리에서도 한 번 로그인해 두면 되고, 저장한 레시피는 같은 가족 데이터라 홈 화면 앱에도 바로 보인다.

배포할 때는 `/share` 주소도 앱(index.html)이 열리게 해야 한다. Cloudflare Pages는 기본으로 그렇게 동작하고, Firebase Hosting은 저장소의 `firebase.json`에 넣어 둔 rewrites 설정을 쓴다(`npx firebase-tools deploy --only hosting`).

## 자동 테스트

- 단위·통합 테스트: `pnpm test` (공용 스키마·인분 환산, Worker 토큰 검증·권한·요청 형식, Claude/Gemini 요청 형식과 오류 처리를 가짜 응답으로 검증).
- 실제 AI로 확인하기(키가 있을 때만 돈다): 레시피 1건 생성 + 예시 영수증(`apps/worker/test/fixtures/sample-receipt.png`, "실제 거래 아님" 표시된 가짜 영수증) 인식.
  `COOK_ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @cook/worker test live` (Claude, 요금 2회 발생) 또는 `COOK_GEMINI_API_KEY=... pnpm --filter @cook/worker test live` (Gemini 무료).
  영수증 테스트는 품목 12개 이상, 날짜, 보관 위치(우유 냉장·만두 냉동·라면 실온), 봉투는 식품 아님, 콜라 2개, 카드번호·합계가 결과에 없는지를 확인하고 읽은 품목 전체를 출력한다.
- 브라우저 E2E(`e2e/run.mjs`): 가족 생성 → AI 레시피 생성 → 편집·저장 → 인분 환산 → 쿡 모드 → 즐겨찾기·폴더 → 실패 처리 → 영수증으로 냉장고 채우기(칸 배치·기한·애니메이션, 장보기 자동 정리) → 직접 추가 → 냉장고 대조·장보기 담기(양 합치기)·요리 후 차감·장본 것 냉장고로 → 유튜브 링크·인스타 캡션+스크린샷·인스타 공개 게시물 캡션·인스타 릴스 영상 자동으로 받아 장면 읽기·화면 녹화 영상 장면·레시피 없는 영상·공유로 들어오기 → 저장 안 한 초안 보관·다 먹었어요·영수증 결과 보관·식재료 사진 → 오늘 뭐 먹지(임박 재료 꼭 쓰기·내 레시피·AI 추천·살 것 담기·바로 레시피 만들기·다른 메뉴로) → 이번 주 식단(끼니·인분, 부족한 재료 한 번에 장보기, 상세에서 식단에 넣기) → AI 셰프·레시피 바꾸기·대체 재료 → 두 번째 가족 구성원 초대 참여 → 실시간 반영까지 한 번에 검증한다. 터미널 3개가 필요하다.
- 오프라인 E2E(`e2e/offline.mjs`): 빌드한 앱(서비스워커)에서 인터넷을 끊고 새로 고쳐도 레시피·냉장고가 보이는지, 끊긴 동안 넣은 재료가 다시 연결되면 다른 기기에 보이는지, AI는 바로 안내하는지 확인한다.
- 보안 규칙 테스트: `pnpm test:rules` (가족이 아닌 사람은 가족 데이터·식단에 못 들어온다)

```bash
# 1) Firebase 에뮬레이터 (Java 필요, 처음 한 번 npx firebase-tools setup:emulators:firestore)
npx firebase-tools emulators:start --only auth,firestore --project demo-cook
# 2) 가짜 AI Worker (고정 레시피를 돌려준다)
node e2e/mock-worker.mjs
# 3) 앱 (에뮬레이터 모드)
cp e2e/.env.emulator apps/web/.env && pnpm dev
# 실행 (처음 한 번 npx playwright install chromium)
node e2e/run.mjs
# 오프라인: 빌드한 앱을 따로 띄운 뒤
(cd apps/web && pnpm build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort)
node e2e/offline.mjs
```

## 수동 테스트

폰에서 하는 전체 체크리스트는 [`docs/manual-test.md`](docs/manual-test.md)에 있다(설치·로그인·가족 → 레시피 만들기·가져오기 → 상세·요리 모드 → 냉장고·영수증 → 장보기 → 뭐 먹지 → 이번 주 식단 → 오프라인·다크 모드 → 비용·안전).
