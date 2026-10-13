import { useAuth } from "../lib/auth";
import { authDomainMismatch } from "../lib/firebase";
import { Banner } from "../components/ui/Banner";
import { isDemo } from "../lib/api";

function GoogleG() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function SignInScreen() {
  const { signIn, error } = useAuth();
  const mismatch = authDomainMismatch();
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-canvas px-6" style={{ paddingTop: "var(--safe-top)" }}>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="size-[88px] rounded-[22px] shadow-raised" />
        <h1 className="mt-6 text-display text-ink">우리집 요리</h1>
        <p className="mt-2 text-body text-ink-2">레시피·냉장고·장보기를 가족과 함께</p>
        {isDemo && <p className="mt-4 max-w-[300px] text-caption text-ink-3">체험판이에요. 예시 데이터가 들어 있고, 고친 것은 이 기기에만 저장돼요. AI는 미리 준비한 예시로 답해요.</p>}
      </div>
      <div style={{ paddingBottom: "calc(var(--safe-bottom) + 24px)" }}>
        {error && <Banner kind="danger" className="mb-3">{error}</Banner>}
        <button type="button" onClick={signIn}
          className="flex h-14 w-full items-center justify-center gap-3 rounded-control border border-line-strong bg-surface text-headline text-ink transition-colors active:bg-surface-2">
          {isDemo ? "체험 시작하기" : <><GoogleG />Google로 시작하기</>}
        </button>
        {mismatch && (
          <p className="mt-3 text-caption text-warning" title={`이 주소(${location.host})와 로그인 주소(${mismatch})가 달라요`}>
            아이폰 홈 화면 앱에서는 로그인이 안 될 수 있어요 · README ‘아이폰 로그인’
          </p>
        )}
      </div>
    </div>
  );
}
