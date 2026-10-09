export function SetupScreen() {
  return (
    <div className="mx-auto max-w-lg p-6">
      <h1 className="text-2xl font-bold">설정이 필요해요</h1>
      <p className="mt-2 text-gray-600">Firebase 설정값이 없습니다. <code>apps/web/.env</code> 파일을 만들고 <code>.env.example</code>의 항목을 채운 뒤 다시 실행하세요.</p>
      <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-gray-700">
        <li>Firebase 콘솔에서 프로젝트 생성</li>
        <li>Authentication → 로그인 방법 → Google 사용 설정</li>
        <li>Firestore Database 생성 → 규칙에 <code>firestore.rules</code> 내용 붙여넣기</li>
        <li>프로젝트 설정 → 웹 앱 추가 → 설정값을 .env에 복사</li>
      </ol>
    </div>
  );
}
