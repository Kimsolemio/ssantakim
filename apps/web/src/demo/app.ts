/** 체험판 전용: firebase/app 흉내 */
export type FirebaseApp = { name: string };
export function initializeApp(..._args: unknown[]): FirebaseApp { return { name: "demo" }; }
