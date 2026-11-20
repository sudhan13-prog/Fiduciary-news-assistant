// Minimal client for any OpenAI-compatible /chat/completions endpoint
// (OpenRouter, Groq, Together, vLLM, Ollama, ...).

export async function chatJSON(agentCfg, messages, { temperature = 0.2, maxTokens = 2000 } = {}) {
  const body = {
    model: agentCfg.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
  };

  let res = await post(agentCfg, body);
  // Some providers/models reject response_format - retry once without it.
  if (res.status === 400) {
    const text = await res.text();
    if (/response_format|json/i.test(text)) {
      delete body.response_format;
      res = await post(agentCfg, body);
    } else {
      throw new Error(`${agentCfg.name} LLM error 400: ${text.slice(0, 500)}`);
    }
  }
  if (!res.ok) {
    throw new Error(`${agentCfg.name} LLM error ${res.status}: ${(await res.text()).slice(0, 500)}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  return parseJSONLoose(content, agentCfg.name);
}

async function post(agentCfg, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    return await fetch(`${agentCfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${agentCfg.apiKey}`,
        'X-Title': 'Fiduciary News Assistant',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Extract a JSON object from model output that may include <think> blocks or code fences. */
export function parseJSONLoose(text, who = 'model') {
  let t = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim();
  try {
    return JSON.parse(t);
  } catch {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(t.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
  }
  throw new Error(`${who} did not return valid JSON: ${t.slice(0, 300)}`);
}
