# Cloudflare Observability 비용 관리

2026-12-01 요금 개편에 대비해 `family-cook-api`와 임시 진단 Worker
`family-cook-ig-probe`의 보관형 로그·추적·Issues 수집을 Wrangler 설정에서 명시적으로 끈다.
설정은 **이 변경이 배포된 Worker에만** 적용된다. 저장소 수정만으로 운영 설정이 바뀌지는 않는다.

## 계정에서 먼저 확인할 것

- 안내 메일이 지정한 Cloudflare 계정과 실제 Worker가 속한 계정이 같은지 확인한다.
- Workers 요금제와 Observability 구독을 각각 확인한다. 안내 메일 수신이나 이 저장소의
  설정만으로 유료 계정 또는 초과 요금 발생을 판단하지 않는다.
- Observability Usage / Billable Usage에서 결제 주기, 수집 GB, 저장 GB-month,
  남은 제공량, 예상 요금, 데이터셋별 사용량을 확인한다. 이벤트 개수만으로 GB를 추정하지 않는다.
- `family-cook-api`의 활성 배포와 설정에서 Logs, Traces, Issues, 샘플링,
  로그 내보내기 설정을 확인한다. 진단용 Worker가 남아 있는지도 확인한다.
- 다른 Workers, Cloudflare Traces, Containers, R2 Data Access Logs, AI Gateway,
  Issues도 같은 계정의 포함량을 공유하므로 함께 확인한다.
  Legacy Log Explorer와 외부 로그 내보내기 서비스는 별도 과금 체계다.

로그인이 되지 않아 위 상태를 읽지 못했다면 **요금제·사용량·운영 수집 상태는 미확인**으로 기록한다.
이 PR 작성 시점에는 계정 인증이 완료되지 않아 실제 요금제와 사용량을 검증하지 못했다.

## 비용을 확실하게 제한하는 계정 설정

Cloudflare 안내 메일에 따르면 Workers Paid 계정은 Paid Observability 구독으로 자동 전환된다.
Workers를 유지하면서 **Observability 구독만 취소해 Free로 전환**할 수 있다.
취소/전환 가능 시점과 적용일은 대시보드에서 확인하고 완료 상태를 검증한다.
Workers Paid 자체를 해지하거나 결제 수단을 제거하는 방식으로 앱을 중단하지 않는다.

Free는 하루 0.5GB를 넘으면 추가 수집이 중단되며, 추가 Observability 요금은 청구되지 않는다.
초기화는 UTC 00:00(한국 시간 오전 9시)다. 중단되는 것은 관측 데이터 수집이며 앱의 요청 처리가 아니다.
Paid는 결제 주기당 수집 50GB와 저장 10GB-month를 각각 제공하며,
초과 수집은 $0.25/GB, 초과 저장은 $0.10/GB-month다.
샘플링이나 알림만으로는 지출 상한이 보장되지 않는다.

## 이 설정의 효과와 한계

두 Wrangler 파일에서 `observability.enabled`, `logs.enabled`, `traces.enabled`,
`issues.enabled`를 모두 `false`로 지정한다. 소스의 `console` 호출은 유지한다.
보관 로그 검색, 보관 추적, 새 Issues 감지는 중단되므로 과거 장애 분석 정보가 줄어든다.
실시간 진단은 필요할 때 다음처럼 실행한다.

```sh
pnpm --filter @cook/worker exec wrangler tail family-cook-api
```

인증·허용 목록·속도 제한·KV 기반 AI 사용량·API 응답·Firestore 기능은 수정하지 않는다.
로그 수집을 꺼도 Workers 실행, KV, AI API 등의 기존 요금은 별도다.
또한 다른 데이터셋이나 이미 보관 중인 데이터의 저장 비용까지 이 파일로 막을 수는 없다.
공식 요금 문서는 Paid 계정에서 12월 1일 보관 중인 데이터가 그날부터 저장 사용량에
포함된다고 설명하므로, 전환 직전의 잔존 데이터도 확인한다.

## 배포와 확인

1. 이 PR의 대상은 `claude/cooking-app-planning-9zxk62`다.
   이 브랜치와 `main`은 push 시 기존 Deploy 워크플로가 실행된다.
   이 PR의 별도 작업 브랜치에 push하는 것만으로는 운영 배포가 실행되지 않는다.
2. 적용할 때 기존 배포 워크플로를 사용한다. 빈 `[vars]`가 있는 원본 파일로
   바로 수동 배포하면 운영 변수를 덮을 수 있으므로 피한다.
   `scripts/ci-deploy-config.mjs`와 `scripts/ci-kv.mjs`가 운영 변수·KV를 채운다.
3. Worker 배포 성공 후 활성 배포의 Logs/Traces/Issues 비활성 상태를 다시 확인한다.
   앱의 로그인, 레시피/AI 호출, 냉장고 동기화와 `/health`를 점검한다.
4. 관측 정보가 필요해 다시 켜기 전에는 Observability Free 전환 또는 계정 예산을 확인한다.
   활성화 후 샘플링 비율을 낮추는 것은 사용량 절감 수단이며 무과금 보장은 아니다.

## 근거

- [Cloudflare Observability 요금](https://developers.cloudflare.com/observability/pricing/)
- [Wrangler Observability 설정](https://developers.cloudflare.com/workers/wrangler/configuration/#observability)
- [Workers Traces](https://developers.cloudflare.com/workers/observability/traces/)
- [Workers Issues](https://developers.cloudflare.com/workers/observability/issues/)
- [실시간 로그](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)

요금제 분리 및 Observability 구독만 취소하는 방법은 사용자 계정에 발송된
Cloudflare의 2026-10-29 안내 메일도 근거로 확인했다.
