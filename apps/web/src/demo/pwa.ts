/** 체험판에는 서비스워커가 없다 (링크로 여는 페이지에서는 쓸 수 없다) */
export function registerSW(..._args: unknown[]) { return () => {}; }
