export interface Env {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGIN: string;
  ANTHROPIC_API_KEY?: string; // 2단계
}

function cors(env: Env, extra: HeadersInit = {}): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    ...extra,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(env) });
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, stage: 1 }, { headers: cors(env) });
    }
    // 2단계: /recipe, 4단계: /normalize, 5단계: /import/*, 6단계: /pantry/photo, /suggest
    return Response.json({ error: "not found" }, { status: 404, headers: cors(env) });
  },
} satisfies ExportedHandler<Env>;
