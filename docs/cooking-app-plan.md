# 가족 요리 앱 기획 보고서 v2 — 시중 인기·프리미엄 앱 벤치마크 기반 재정립

작성일: 2026-09-29
대상: 나와 가족만 사용하는 비영리 개인용 앱
전제: 기존 저장소의 가계부 `index.html`은 재미로 만든 실험물이며, 요리 앱은 그와 무관하게 **새로 설계**한다.

---

## 1. 한 줄 결론

원하는 세 가지(링크 → 레시피, 음식 이름 → 레시피, 냉장고 관리)는 **이미 시장 1위 앱들이 유료로 파는 조합**이다. 특히 Samsung Food는 "SNS 공유 버튼 → AI가 영상 보고 레시피 생성 → 재료 목록(Food List) 연동"을 그대로 하고 있다. 따라서 "되는가"는 검증이 끝났고, 우리 앱의 목표는 **그 앱들의 검증된 UX를 가져오되, 광고·구독·데이터 수집 없이 우리 가족 취향에 맞춘 개인 버전**을 만드는 것이다.

---

## 2. 벤치마크: 시중 인기·프리미엄 앱이 실제로 하는 것

### 2-1. 해외 프리미엄/인기 앱

| 앱 | 가격 | 핵심 강점 | 우리 앱에 가져올 것 |
|----|------|-----------|-------------------|
| **Samsung Food** (구 Whisk) | 무료 + Food+ 월 $6.99 / 연 $59.99 | 틱톡·인스타·블로그 **공유 버튼 → AI가 영상·캡션 분석해 레시피 생성**, 24만 레시피, 폴더 정리, Food List(재료 목록)에 **사진으로 재료 추가(Vision AI)**, "Use It Up"(있는 재료 소진 레시피), 장보기 ↔ 재료 목록 상호 이동, AI 주간 식단 | 공유 → AI 추출 흐름, 사진으로 재료 추가, 장보기↔냉장고 이동, Use It Up |
| **Paprika** 3 → 4 | 3: 플랫폼별 1회 구매 / 4: 구독 전환 | 웹 임포트, **인분 스케일링**, 식단 캘린더, 통로별 장보기, 팬트리. 4에서 추가: SNS 공유 임포트, **레시피 사진 스캔**, **가족 계정 공유**, 바코드, **팬트리 위치 복수(냉장/냉동 등)** | 스케일링, 가족 계정, 사진 스캔, 냉장/냉동/실온 위치 |
| **Crouton** | 1회 구매 ~£19.99 (Apple Design Award) | **쿡 모드**(화면 꺼짐 방지, 단계별 큰 글씨, 타이머), 공유 시트 임포트, 블루투스 저울 연동. ※ 2026년 1월 앱스토어에서 내려갔다는 보도 있음 | 쿡 모드의 완성도 |
| **ReciMe / Pestle** | 구독 / 무료+ | 틱톡·인스타·페북·유튜브 전 플랫폼 임포트(ReciMe). Pestle은 **캡션만** 기기 내 ML로 파싱(영상 분석 없음, 인스타 미지원) | "캡션 기반 추출"이 실무 기본값이라는 점 |
| **NYT Cooking / SideChef Premium** | 월 $4.99 | 큐레이션 레시피, **음성 안내 단계별 영상**, 요리 클래스 | 단계별 음성 안내(TTS) |
| **KitchenPal / NoWaste / Eatvora** (팬트리 특화) | 무료 / 연 $7 / 구독 | 바코드 스캔, 유통기한 알림, 재고 기반 레시피 추천, 떨어지면 자동 장보기, 가족 공유, 팬트리 건강 점수·절약 리포트 | 유통기한 알림, 자동 장보기, 가족 공유 |

### 2-2. 국내 인기 앱

| 앱 | 규모 | 핵심 기능 | 우리 앱에 가져올 것 |
|----|------|-----------|-------------------|
| **만개의레시피** | 1,000만 이용자, 20만 레시피 | **냉장고 파먹기**(가진 재료 입력 → 레시피 추천, **제외 재료** 입력 가능), 장보기 메모, **식재료 손질·보관법** | 제외 재료 옵션, 재료별 보관법 안내 |
| **우리의식탁** | 200만 이용자 | **AI에게 어떤 요리·재료든 요리법 질문**, 기본 조리법 영상, 앱 내 타이머 | "음식 이름 → AI 레시피"는 이미 국내 대형 앱의 정식 기능 |
| **냉장고를부탁해 / 유통기한 언제지 / 잇이즈 / 냉장고파먹기** | — | 사진 촬영 등록, 바코드·영수증 촬영 자동 등록, 소비기한 알림, 인원 제한 없는 가족 냉장고 공유 | 영수증 촬영 일괄 등록, 소비기한(유통기한) D-day |

### 2-3. 벤치마크에서 얻은 5가지 교훈

1. **공유 버튼이 곧 진입점이다.** 잘 되는 앱은 모두 "앱을 열고 링크를 붙여넣기"가 아니라 "인스타/유튜브에서 공유 → 우리 앱 선택"으로 시작한다. 이 한 단계 차이가 실제 사용 빈도를 좌우한다.
2. **인스타 추출의 업계 표준은 "캡션 우선, 영상은 보조"다.** Pestle은 아예 캡션만 본다. 영상 자체 분석은 Samsung Food 정도만 하고, 그것도 정확도 편차가 있어 "원본 영상과 대조하라"고 안내한다. 우리가 캡션 붙여넣기 방식을 쓰는 것은 타협이 아니라 표준이다.
3. **쿡 모드가 프리미엄과 무료의 차이를 만든다.** 한 화면에 한 단계, 큰 글씨, 그 단계에 필요한 재료만 표시, 화면 꺼짐 방지, 조리시간 자동 타이머, 음성 읽어주기. 이 묶음이 있어야 "요리하면서" 쓴다.
4. **냉장고 앱의 필수 3종은 유통기한 D-day, 가족 공유, 장보기 연동이다.** 바코드는 국내 신선식품엔 잘 안 맞아 사진·영수증 등록이 더 유용하다.
5. **재고 기반 추천은 "제외 재료"와 "임박 재료 우선"이 있어야 쓸만하다.** 만개의레시피와 Samsung Food의 Use It Up이 공통으로 갖고 있다.

---

## 3. 재정립한 기능 범위

### 3-1. 필수(Table stakes) — 이게 없으면 시중 무료 앱보다 못하다
- 레시피 저장/폴더(태그)/검색/즐겨찾기
- 음식 이름 → AI 레시피 생성(가족 프로필 반영: 인원, 매운맛, 알레르기, 아이 유무)
- 링크 가져오기: 유튜브(자동), 인스타(캡션 붙여넣기 + 스크린샷)
- **인분 스케일링**(재료 자동 환산)
- **쿡 모드**(단계별 큰 화면, 단계별 재료, 화면 켜짐 유지, 자동 타이머)
- 냉장고: 재료 추가/차감, 냉장·냉동·실온 위치, 유통기한 D-day, 가족 실시간 공유
- 장보기: 부족 재료 자동 담기, 체크하면 냉장고로 이동

### 3-2. 프리미엄 차별점 — 유료 앱이 돈 받는 기능, 우리는 공짜로
- **공유 시트 진입**: 인스타/유튜브에서 "공유" → 우리 앱(아래 4장 참고)
- **사진으로 재료 등록**: 냉장고 내부 사진 또는 영수증 사진 → AI가 재료 목록 추출(Samsung Food Vision AI, 국내 냉장고 앱 공통)
- **레시피 사진 스캔**: 요리책·손글씨 레시피 촬영 → 구조화(Paprika 4)
- **Use It Up**: 유통기한 임박 재료 우선 + 제외 재료 옵션으로 오늘 메뉴 추천
- **음성 읽어주기(TTS)**와 "다음" 음성 명령(브라우저 Web Speech API로 가능)
- 요리 완료 시 냉장고 자동 차감 + "이 레시피 언제 만들었는지" 기록
- 주간 식단 캘린더 → 일주일치 장보기 한 번에 생성

### 3-3. 의도적으로 뺄 것 — 가족용에 불필요
- 영양 정보·칼로리 추적(Samsung Food+, NYT의 핵심 유료 기능이지만 요구사항에 없음)
- 24만 개 공개 레시피 DB, 커뮤니티, 셀러샵, 광고
- 블루투스 저울, 삼성 냉장고 연동
- 바코드 스캔(국내 신선식품에 효용 낮음, 사진 등록으로 대체)

---

## 4. 실현가능성 재검토 (벤치마크 반영)

| 기능 | 판정 | 근거·방법 |
|------|------|-----------|
| 음식 이름 → 레시피 | ✅ | 우리의식탁이 이미 정식 기능. Gemini API 무료 등급 + 구조화 출력(JSON 스키마)으로 1회 호출. 0원 |
| 유튜브 링크 | ✅ | 서버(Cloudflare Worker)에서 YouTube Data API로 설명란 취득 + Gemini에 유튜브 URL 직접 입력해 영상 이해 → 같은 Gemini로 레시피 JSON 정리 |
| 인스타 링크 | ⚠️ 표준 방식으로 가능 | 캡션 붙여넣기(Pestle 방식) + 스크린샷 비전 분석. 링크는 출처 보관용. 릴스 저장 후 영상 업로드는 선택 기능 |
| 공유 시트 진입 | ⚠️ 방법 선택 필요 | 아래 4-1 참고 |
| 사진·영수증으로 재료 등록 | ✅ | Gemini 비전으로 이미지 → 재료 JSON. 국내 앱들이 이미 하는 기능 |
| 쿡 모드 | ✅ | Screen Wake Lock API(iOS 16.4+ 사파리 지원), 단계 텍스트에서 "10분" 자동 감지 → 타이머, SpeechSynthesis로 읽어주기 |
| 인분 스케일링 | ✅ | 재료를 qty/unit로 구조화해 저장하면 곱셈. "약간", "적당량"은 스케일 제외 플래그 |
| 냉장고·장보기·가족 공유 | ✅ | Firestore 실시간 동기화 |
| Use It Up 추천 | ✅ | 냉장고 목록 + 임박 재료 + 제외 재료를 프롬프트에 넣어 후보 5개 |
| 레시피↔냉장고 재료 매칭 | ⚠️ 난이도 최고 | 저장 시 AI로 표준 재료 키·표준 단위 부여. 사용자가 키를 고칠 수 있게 |

### 4-1. 공유 시트 진입 — 3가지 방법

| 방법 | 되는 것 | 안 되는 것 | 난이도 |
|------|---------|-----------|--------|
| ① iOS 단축어(Shortcut) | 공유 시트에 "요리앱에 저장" 항목 추가 → 우리 PWA를 `?url=…`로 열기. 가족 폰마다 단축어 1회 설치 | 인스타 캡션은 못 가져옴(링크만) | 낮음 |
| ② Android Web Share Target | PWA가 공유 대상으로 등록됨(텍스트·링크·이미지 수신) | iOS 미지원 | 낮음 |
| ③ Capacitor로 네이티브 래핑 | iOS/Android 모두 정식 공유 대상. 푸시 알림도 가능 | Apple 개발자 계정(연 $99) + 빌드·배포 관리 | 높음 |

**권장: ① + ②로 시작**, 나중에 유통기한 푸시 알림까지 원하면 ③ 검토. 인스타는 어차피 캡션을 따로 복사해야 하므로 ①의 한계가 실질적 손해가 아니다.

---

## 5. 기술 구성 (변경 없음, 근거 보강)

```
[아이폰/안드로이드]  Vite + React + TS, Tailwind, PWA(Web Share Target, Wake Lock, Web Speech)
        │  Firebase Auth(구글 로그인, 가족 초대 코드) + Firestore 실시간 동기화
        │
        └─▶ [Cloudflare Worker /api/*]  ── API 키 보관, Firebase 토큰 검증
                 ├─ /recipe        음식 이름 → Gemini Flash(구조화 출력, 무료)
                 ├─ /import/youtube  YouTube Data API + Gemini(유튜브 URL 직접 입력, 영상 이해)
                 ├─ /import/text     인스타 캡션·스크린샷·레시피 사진 → Gemini(비전)
                 ├─ /normalize     재료 표준화(Gemini Flash-Lite)
                 ├─ /pantry/photo  냉장고 사진·영수증 → 재료 JSON(Gemini 비전)
                 └─ /suggest       Use It Up 추천
```

- 브라우저에 AI 키를 두지 않는다(도용되면 무료 한도를 남이 써버린다). Worker에 가족 이메일 허용 목록 설정.
- 월 예상 비용: **0원** (Gemini 무료 등급: 분당 약 10회·하루 약 1,500회, 가족용에 충분). 품질이 아쉬우면 Worker의 ai.ts 하나만 바꿔 유료 모델로 교체 가능.

### 5-1. 데이터 모델 (벤치마크 반영해 확장)

```
Recipe
  title, source{type: generated|youtube|instagram|photo|text, url, channel}
  servingsBase, timeMinutes, difficulty, folderId, tags[], favorite, photoUrl
  ingredients[{ name, key, qty, unit, scalable, optional, group }]   ← group: "양념", "고명" 등
  steps[{ order, text, minutes?, ingredientKeys[] }]                 ← 쿡 모드용 단계별 재료·타이머
  tips[], cookedLog[{ date, by, servings }]

FridgeItem
  name, key, qty, unit, location(냉장|냉동|실온), expiresAt, addedBy, addedAt, photoUrl?

ShoppingItem
  name, key, qty, unit, fromRecipeId?, checked

FamilyProfile
  members, spicyLevel, allergies[], dislikes[], kidsFriendly, defaultServings

MealPlan (선택)
  date, slot(아침|점심|저녁), recipeId
```

---

## 6. 위험 요소와 대응

| 위험 | 대응 |
|------|------|
| 인스타 자동 추출 기대 불일치 | 첫 화면부터 "인스타는 캡션을 붙여넣어 주세요"를 UI로 명시. 업계 표준임을 가족에게 설명 |
| AI 레시피 정확도(분량 오류) | 저장 전 편집 화면 필수. 원본 링크 항상 표시(ReciMe·Samsung Food 모두 "원본과 대조" 권고) |
| 재료 매칭 오류 | 표준 키 + 사용자 수정 + 매칭 실패 시 "직접 연결" UI |
| iOS 백그라운드 타이머·알림 제약 | 쿡 모드 타이머는 화면 켜진 상태 전제(Wake Lock). 유통기한 알림은 앱 열 때 배지, 푸시는 Capacitor 전환 시 |
| API 키 도용 | Worker 프록시 + Firebase 토큰 검증 + 월 지출 한도 |
| 스키마 변경으로 데이터 깨짐 | 1단계에서 `packages/shared`에 스키마 확정, 이후 필드 추가만 허용 |

---

## 7. 앱 제작용 프롬프트 작성 플랜 (재정립)

> 진행 상태: 1단계 ✅ · 2단계 ✅ · 3단계 ✅ (쿡 모드) · 4단계부터 예정
> 비용 원칙(확정): **모든 API를 무료 등급으로만 쓴다.** Claude API는 무료 등급이 없어 AI는 Gemini API 무료 등급(Flash 모델)으로 통일했다. Cloudflare·Firebase·YouTube Data API·Gemini 모두 0원.

6단계 → **7단계**. 벤치마크에서 필수로 확인된 쿡 모드·스케일링을 앞당기고, 공유 진입·사진 등록을 추가했다. 각 단계는 동작하는 결과물을 남기고 한 커밋으로 마무리한다.

### 7-0. 공통 헤더 (모든 프롬프트 맨 앞)

```
[프로젝트 컨텍스트]
- 새 프로젝트다. 저장소 루트의 기존 index.html(실험물)은 무시하고 건드리지 않는다.
- 구조: pnpm 워크스페이스. apps/web(Vite + React 18 + TypeScript + Tailwind + vite-plugin-pwa), apps/worker(Cloudflare Worker, TypeScript, wrangler), packages/shared(zod로 정의한 Recipe/FridgeItem/ShoppingItem/FamilyProfile 스키마와 타입).
- DB/인증: Firebase(구글 로그인 + Firestore). 가족 데이터는 families/{familyId}/ 아래. 보안 규칙으로 자기 가족만 접근.
- 사용자는 나와 가족뿐. 한국어 UI. 모바일 세로 화면 기준, 하단 탭(레시피 / 냉장고 / 장보기 / 오늘 뭐 먹지).
- 벤치마크 UX: Samsung Food의 저장 흐름, Paprika의 스케일링·가족 공유, Crouton의 쿡 모드를 참고한다. 광고·영양정보·커뮤니티는 만들지 않는다.
- AI 호출은 반드시 apps/worker를 거친다. 브라우저 코드에 Gemini/YouTube 키를 절대 넣지 않는다.
- AI: Gemini API 무료 등급(gemini-2.5-flash, REST + fetch, SDK 없음). responseJsonSchema 구조화 출력으로 JSON 스키마 강제. 다른 제공자로 바꿀 수 있게 ai.ts 한 파일에 격리.
- 완료 기준: 실제로 동작해야 하고, 네트워크 오류·401·JSON 파싱 실패 처리와 로딩 UI를 포함하며, 마지막에 수동 테스트 절차를 적는다.
```

### 7-1. 1단계 — 뼈대 + 스키마 확정 + 냉장고
```
워크스페이스 3개(web/worker/shared)를 만들고, shared에 5장 데이터 모델을 zod 스키마로 확정하라.
apps/web: 구글 로그인, 첫 로그인 시 familyId 생성 또는 초대 코드 참여. 하단 탭 4개 중 "냉장고"만 완성.
냉장고: 추가/수정/삭제, 냉장·냉동·실온 그룹, 유통기한 D-day(3일 이내 빨강, 지난 것 회색), 검색, 누가 추가했는지 표시.
재료 key는 임시로 name 정규화 값(3단계에서 AI 정규화로 교체).
PWA: manifest, 아이콘, apple 메타태그. Firestore 보안 규칙 파일 포함.
```

### 7-2. 2단계 — Worker + 음식 이름 → 레시피 + 저장/폴더/스케일링
```
apps/worker: 환경변수 GEMINI_API_KEY(무료). Firebase ID 토큰 검증 미들웨어(실패 시 401).
POST /recipe {dish, servings, profile} → Gemini 구조화 출력(responseJsonSchema)으로 Recipe JSON. 시스템 프롬프트는 worker/src/prompts.ts 한 파일에 상수로 모은다. 규칙: 한국 가정에서 구하기 쉬운 재료, g/ml/개/큰술 단위, "약간"은 scalable:false, 재료 group(주재료/양념/고명), 각 step에 ingredientKeys와 minutes.
apps/web "레시피" 탭: 검색창 → 생성 → 편집 가능한 미리보기 → 저장. 목록/폴더/태그/즐겨찾기/검색. 상세 화면에 인분 스테퍼(스케일링, scalable:false는 고정). 원본 출처 링크 항상 표시.
```

### 7-3. 3단계 — 쿡 모드
```
레시피 상세에 "요리 시작" 버튼 → 쿡 모드 전체화면.
한 화면에 한 단계, 큰 글씨, 그 단계의 재료(스케일링 반영)만 아래에 표시, 좌우 스와이프/큰 버튼으로 이동.
Screen Wake Lock API로 화면 꺼짐 방지(미지원 시 안내). step.minutes가 있으면 한 번 탭으로 타이머 시작, 여러 타이머 동시 표시, 종료 시 소리+진동.
SpeechSynthesis로 현재 단계 읽어주기(켜기/끄기), 선택적으로 "다음/이전" 음성 명령(Web Speech API, 미지원 브라우저는 숨김).
```

### 7-4. 4단계 — 재료 정규화 + 냉장고 대조 + 요리 완료 차감 + 장보기
```
Worker POST /normalize {items} → Gemini Flash-Lite로 표준 key(영문 스네이크케이스)·표준 단위 환산. 냉장고 추가·레시피 저장 시 자동 호출, 사용자가 key 수정 가능.
레시피 상세 "냉장고 대조": 재료별 있음/부족(부족량)/없음. 매칭 실패 시 "직접 연결" 선택.
쿡 모드 마지막 화면 "요리 완료": 사용량 조정 모달 → 냉장고 차감 + cookedLog 기록.
장보기 탭: 부족 재료 한 번에 담기, 체크하면 냉장고로 이동(위치·유통기한 입력), 수동 추가, 냉장고에서 "떨어짐" 표시 시 자동 담기.
```

### 7-5. 5단계 — 링크 가져오기(유튜브·인스타) + 공유 진입
```
Worker POST /import/youtube {url}: YouTube Data API로 제목·설명·채널 → Gemini에 유튜브 URL 직접 입력해 조리 과정을 Recipe JSON으로 정리. 환경변수 YOUTUBE_API_KEY, GEMINI_API_KEY.
Worker POST /import/text {url?, text?, images?[]}: 캡션 텍스트·스크린샷·요리책 사진 → Gemini 비전으로 Recipe JSON.
apps/web "가져오기" 화면: URL 입력. 유튜브면 자동. 인스타면 즉시 "캡션 붙여넣기 / 스크린샷 올리기" 화면으로 전환하고 링크는 출처로 저장. 결과는 항상 편집 가능한 미리보기 후 저장.
공유 진입: (a) manifest에 share_target 등록(Android, 텍스트·링크·이미지 수신 → 가져오기 화면), (b) iOS 단축어 파일(.shortcut) 또는 만드는 방법 문서: 공유 시트에서 링크를 받아 앱 URL ?url= 로 열기.
```

### 7-6. 6단계 — 사진으로 재료 등록 + Use It Up
```
Worker POST /pantry/photo {images[], mode: "fridge"|"receipt"} → Gemini 비전으로 FridgeItem[] 후보(이름·수량·단위·추정 위치). 앱에서 체크박스로 골라 일괄 추가.
Worker POST /suggest {fridgeItems, expiringSoon, exclude[], profile, mood?} → 메뉴 5개(제목, 부족 재료, 시간). "오늘 뭐 먹지" 탭: 임박 재료 카드, 제외 재료 칩, 추천 → "레시피 만들기" → /recipe.
```

### 7-7. 7단계 — 식단 캘린더 + 오프라인 + 마무리
```
주간 식단 캘린더(선택 기능): 날짜·끼니에 레시피 배치 → 일주일치 부족 재료를 장보기로 한 번에.
서비스워커로 저장된 레시피·냉장고 목록 오프라인 열람(쓰기는 온라인 시 동기화).
홈(레시피 탭 상단)에 유통기한 임박 배지.
전체 수동 테스트 체크리스트, README(키 발급·배포·단축어 설치 안내) 최종 정리.
```

### 7-8. 프롬프트 작성 원칙
1. 한 단계 = 한 프롬프트 = 한 커밋. 단계마다 실제로 폰에서 써보고 다음으로.
2. 스키마는 1단계에서 확정, 이후 필드 추가만 허용.
3. AI에 보내는 시스템 프롬프트는 Worker의 파일 하나에 모아 취향 조정을 쉽게.
4. AI 결과는 반드시 "편집 가능한 미리보기 → 저장" 흐름을 거친다(정확도 편차 대응).
5. 각 프롬프트 끝에 오류 처리·로딩 UI·수동 테스트 절차 요구를 넣는다.

---

## 8. 시작 전 준비 (사람이 할 일)

| 항목 | 어디서 | 비용 |
|------|--------|------|
| Gemini API 키 | Google AI Studio (aistudio.google.com/apikey) | 무료, 카드 불필요 |
| Cloudflare 계정 + Wrangler | cloudflare.com | 무료 |
| YouTube Data API v3 키 | Google Cloud Console | 무료 |
| Firebase 프로젝트(신규) | Firebase 콘솔 | 무료 |
| (선택) Apple 개발자 계정 | Capacitor 전환 시 | 연 $99 |

## 9. 다음 행동

1. 3장 기능 범위(필수/프리미엄/제외)와 4-1 공유 진입 방식(단축어 + Android 공유 대상)에 동의하면 7-1 프롬프트 전문을 작성해 제작을 시작한다.
2. 1단계는 Firebase 프로젝트만 있으면 시작 가능하다.

---

## 참고 자료
- [Best Recipe Manager Apps (2026) – Forkee](https://www.getforkee.com/blog/best-recipe-manager-apps/)
- [Best recipe apps in 2026: 5 apps compared – RecipeCircle](https://recipecircle.nl/blog/top-5?lang=en)
- [Paprika Alternatives in 2026 – Recipe Shelf](https://recipeshelf.ai/blog/paprika-alternatives)
- [Paprika 4 Subscription: What Changes – CookBook](https://cookbookmanager.com/post/paprika-4-subscription)
- [Paprika Recipe Manager 4: Everything We Know – EatHealthy365](https://eathealthy365.com/paprika-recipe-manager-4-everything-we-know/)
- [Samsung Food: Meal Planner – App Store](https://apps.apple.com/us/app/samsung-food-meal-planner/id1133637674)
- [Samsung Food Review: Pros and Cons – Plan to Eat](https://www.plantoeat.com/blog/2026/01/samsung-food-review-pros-and-cons/)
- [What's Included in Your Samsung Food+ Subscription](https://support.samsungfood.com/hc/en-us/articles/32709269852052-What-s-Included-in-Your-Samsung-Food-Subscription)
- [Samsung Food App 2026: Vision AI Features – MealThinker](https://mealthinker.com/blog/samsung-food-alternative)
- [Crouton: Recipe Manager – App Store](https://apps.apple.com/us/app/crouton-recipe-manager/id1461650987)
- [Pestle recipe app can now save dishes from TikTok – TechCrunch](https://techcrunch.com/2024/11/25/pestle-recipe-app-can-now-save-dishes-from-tiktok)
- [Best App to Save TikTok Recipes: 2026 Comparison – RecetteClic](https://recetteclic.app/en/guides/best-app-to-save-tiktok-recipes)
- [I tried 4 viral recipe apps – Android Police](https://www.androidpolice.com/i-tried-viral-recipe-apps-clear-winner/)
- [SideChef Premium](https://www.sidechef.com/premium/)
- [NYT Cooking – App Store](https://apps.apple.com/np/app/nyt-cooking-recipes-tips/id911422904)
- [Best Meal Planning Apps with Pantry Tracking (2026) – MealThinker](https://mealthinker.com/blog/meal-planning-app-pantry-tracking)
- [Best Food Inventory App in 2026 – Eatvora](https://www.eatvora.app/best/best-food-inventory-app)
- [KitchenPal: Pantry Inventory – Google Play](https://play.google.com/store/apps/details?id=fr.icuisto.icuisto&hl=en_US)
- [요리백과 만개의레시피 – Google Play](https://play.google.com/store/apps/details?id=com.ezhld.recipe&hl=en_US)
- [우리의식탁 – Google Play](https://play.google.com/store/apps/details?id=com.culturehero.wifetable&hl=en_US)
- [냉장고를부탁해 – Google Play](https://play.google.com/store/apps/details?id=com.tcf.take_care_refrigerator&hl=en_US)
- [유통기한 언제지 – Google Play](https://play.google.com/store/apps/details?id=kr.co.ourneeds.app&hl=en_US)
- [냉장고 유통기한 관리 앱 10선【2025년판】 – BitFlap](https://bitflap.app/ko/otto/articles/refrigerator-expiration-management-apps/)
- [Cook Mode: How To Keep Your Screen Bright While Cooking – Bootstrapped Ventures](https://bootstrapped.ventures/cook-mode/)
- [Cook Mode: Follow Recipes Step by Step with Built-in Timers – Drizzle Lemons](https://www.drizzlelemons.com/blog/cook-mode-step-by-step-recipe-view)
