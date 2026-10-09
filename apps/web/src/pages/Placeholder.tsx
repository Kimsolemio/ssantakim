export function Placeholder({ title, stage }: { title: string; stage: string }) {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-4 rounded-2xl bg-white p-6 text-center text-gray-500">{stage}에서 만들어집니다.</div>
    </div>
  );
}
