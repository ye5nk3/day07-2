const MODEL = "google/gemma-4-31b-it:free";
const MAX_INGREDIENTS = 40;
const DIFFICULTIES = ["쉬움", "보통", "어려움"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function buildPrompt(ingredients: string[]) {
  return (
    `다음 재료를 최대한 활용해 만들 수 있는, 서로 다른 한국어 레시피를 정확히 3개 추천하세요.\n` +
    `재료: ${ingredients.join(", ")}\n` +
    `기본 양념(소금, 설탕, 간장, 식용유, 후추, 물)은 있다고 가정합니다. ` +
    `재료 목록에 없는 재료는 "have": false 로 표시하세요. 난이도는 쉬움, 보통, 어려움 중 하나입니다.\n` +
    `반드시 아래 형태의 JSON만 출력하고 다른 설명은 쓰지 마세요.\n` +
    `{"recipes":[{"title":"계란볶음밥","summary":"한 줄 설명","cook_time_min":15,"difficulty":"쉬움",` +
    `"ingredients":[{"name":"계란","amount":"2개","have":true}],"steps":["첫 번째 단계","두 번째 단계"]}]}`
  );
}

class UpstreamError extends Error {
  constructor(public status: number) {
    super(`upstream ${status}`);
  }
}

async function askModel(apiKey: string, prompt: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.error("openrouter status", res.status);
    throw new UpstreamError(res.status);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

function normalizeRecipe(r: any) {
  const title = str(r?.title, 60);
  const summary = str(r?.summary, 200);
  const cook = Math.round(Number(r?.cook_time_min));
  const difficulty = DIFFICULTIES.includes(r?.difficulty) ? r.difficulty : null;
  if (!title || !summary || !Number.isFinite(cook) || cook < 1 || cook > 600 || !difficulty) return null;
  if (!Array.isArray(r.ingredients) || !Array.isArray(r.steps)) return null;

  const ingredients = [];
  for (const i of r.ingredients) {
    const name = str(i?.name, 30);
    if (!name) continue;
    ingredients.push({
      name,
      amount: typeof i.amount === "string" ? i.amount.trim().slice(0, 30) : "",
      have: i.have === true,
    });
  }
  const steps = r.steps.map((s: unknown) => str(s, 400)).filter((s: string | null): s is string => !!s);
  if (!ingredients.length || !steps.length) return null;
  return { title, summary, cook_time_min: cook, difficulty, ingredients, steps };
}

function parseRecipes(text: string) {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(obj.recipes)) return null;
    const recipes = obj.recipes.map(normalizeRecipe).filter(Boolean);
    return recipes.length >= 3 ? recipes.slice(0, 3) : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405);

  let body: { ingredients?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const raw = body.ingredients;
  if (
    !Array.isArray(raw) || raw.length < 1 || raw.length > MAX_INGREDIENTS ||
    !raw.every((x) => typeof x === "string" && x.trim().length >= 1 && x.trim().length <= 30)
  ) {
    return json({ error: `재료는 1~${MAX_INGREDIENTS}개, 각 1~30자의 문자열이어야 합니다.` }, 400);
  }
  const ingredients = [...new Set(raw.map((x: string) => x.trim().replace(/\s+/g, " ")))];

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return json({ error: "서버 설정에 문제가 있습니다." }, 500);

  try {
    const prompt = buildPrompt(ingredients);
    for (let attempt = 0; attempt < 2; attempt++) {
      const recipes = parseRecipes(await askModel(apiKey, prompt));
      if (recipes) return json({ recipes });
      console.error("parse failed, attempt", attempt + 1);
    }
    return json({ error: "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요." }, 502);
  } catch (e) {
    if (e instanceof UpstreamError && e.status === 429) {
      return json({ error: "무료 모델 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요." }, 429);
    }
    return json({ error: "AI 서버 호출에 실패했습니다. 잠시 후 다시 시도해 주세요." }, 502);
  }
});
