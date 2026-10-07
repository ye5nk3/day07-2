const MODEL = "google/gemma-4-31b-it:free";
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
const MAX_INGREDIENTS = 40;

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

const PROMPT =
  "이 사진은 냉장고 또는 식재료 사진입니다. 사진에서 눈에 보이는 식재료만 한국어 일반 명사로 나열하세요. " +
  "브랜드명이나 용기 이름은 쓰지 말고, 보이지 않는 것은 추측하지 마세요. " +
  '반드시 {"ingredients":["계란","우유"]} 형태의 JSON만 출력하고 다른 설명은 쓰지 마세요.';

class UpstreamError extends Error {
  constructor(public status: number) {
    super(`upstream ${status}`);
  }
}

async function askModel(apiKey: string, image: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            { type: "image_url", image_url: { url: image } },
          ],
        },
      ],
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

function parseIngredients(text: string): string[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(obj.ingredients)) return null;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of obj.ingredients) {
      if (typeof item !== "string") continue;
      const name = item.trim().replace(/\s+/g, " ");
      if (name.length < 1 || name.length > 30 || seen.has(name)) continue;
      seen.add(name);
      out.push(name);
      if (out.length >= MAX_INGREDIENTS) break;
    }
    return out;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405);

  let body: { image?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }

  const image = body.image;
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image)) {
    return json({ error: "이미지 형식이 올바르지 않습니다. JPEG, PNG, WebP만 지원합니다." }, 400);
  }
  if (image.length > MAX_IMAGE_CHARS) {
    return json({ error: "이미지가 너무 큽니다. 더 작은 사진을 사용해 주세요." }, 413);
  }

  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return json({ error: "서버 설정에 문제가 있습니다." }, 500);

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await askModel(apiKey, image);
      const ingredients = parseIngredients(text);
      if (ingredients) return json({ ingredients });
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
