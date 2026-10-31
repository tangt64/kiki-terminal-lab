export const LLM_API_TIMEOUT_MS = Number(process.env.LLM_API_TIMEOUT_MS || 15000);
export const LLM_PROBE_TIMEOUT_MS = Number(process.env.LLM_PROBE_TIMEOUT_MS || 8000);
export const LLM_MAX_TOKENS = Math.max(1, Number(process.env.LLM_MAX_TOKENS || 512) || 512);
export const LLM_ADMIN_TEST_MAX_TOKENS = Math.max(1, Number(process.env.LLM_ADMIN_TEST_MAX_TOKENS || 80) || 80);
export const LLM_HISTORY_MESSAGE_LIMIT = Math.max(0, Number(process.env.LLM_HISTORY_MESSAGE_LIMIT ?? 4) || 0);
export const LLM_COURSE_CONTEXT_MAX_CHARS = Math.max(0, Number(process.env.LLM_COURSE_CONTEXT_MAX_CHARS ?? 2400) || 0);
export const LLM_SYSTEM_PROMPT_ENABLED = String(process.env.LLM_SYSTEM_PROMPT_ENABLED || "true").toLowerCase() !== "false";
export const LLM_COURSE_CONTEXT_ENABLED = String(process.env.LLM_COURSE_CONTEXT_ENABLED || "true").toLowerCase() !== "false";
export const LLM_REQUEST_CONTEXT_ENABLED = String(process.env.LLM_REQUEST_CONTEXT_ENABLED || "true").toLowerCase() !== "false";
export const LLM_WEB_SEARCH_ENABLED = String(process.env.LLM_WEB_SEARCH_ENABLED || "true").toLowerCase() !== "false";
export const LLM_WEB_SEARCH_TIMEOUT_MS = Number(process.env.LLM_WEB_SEARCH_TIMEOUT_MS || 8000);
export const LLM_WEB_SEARCH_RESULT_LIMIT = Math.min(10, Math.max(1, Number(process.env.LLM_WEB_SEARCH_RESULT_LIMIT || 5) || 5));

const WEB_SEARCH_UNAVAILABLE_PATTERNS = [
  /정보(?:가)?\s*없/i,
  /알\s*수\s*없/i,
  /확인(?:할)?\s*수\s*없/i,
  /최신\s*정보(?:가)?\s*필요/i,
  /검색(?:이)?\s*필요/i,
  /제공(?:된)?\s*(?:자료|문맥|컨텍스트).{0,20}(?:없|부족)/i,
  /not enough information/i,
  /do not have (?:access|information)/i,
  /cannot (?:verify|determine|confirm)/i,
  /need (?:current|up-to-date|web)/i,
  /as an ai/i,
];

const WEB_SEARCH_INTENT_PATTERNS = [
  /검색해/i,
  /찾아\s*봐/i,
  /구글/i,
  /최신/i,
  /최근/i,
  /오늘/i,
  /현재/i,
  /요즘/i,
  /발표/i,
  /출시/i,
  /가격/i,
  /일정/i,
  /뉴스/i,
  /current/i,
  /latest/i,
  /recent/i,
  /today/i,
  /news/i,
  /price/i,
  /schedule/i,
];

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const upstreamSignal = options?.signal;
  const abortFromUpstream = () => {
    controller.abort(upstreamSignal?.reason || new Error("aborted"));
  };
  if (upstreamSignal?.aborted) {
    abortFromUpstream();
  } else if (upstreamSignal) {
    upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
  }
  const { signal: _ignoredSignal, ...fetchOptions } = options || {};
  try {
    return await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) {
      if (upstreamSignal?.aborted) {
        throw new Error("클라이언트 연결이 종료되어 LLM 요청을 중단했습니다.");
      }
      throw new Error(`외부 API 요청 시간이 ${timeoutMs}ms를 초과했습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (upstreamSignal) {
      upstreamSignal.removeEventListener("abort", abortFromUpstream);
    }
  }
}

async function readJsonSafely(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function resolveWebSearchSettings(settings = null) {
  const enabled = settings && Object.prototype.hasOwnProperty.call(settings, "llmWebSearchEnabled")
    ? settings.llmWebSearchEnabled !== false
    : LLM_WEB_SEARCH_ENABLED;
  const apiKey = String(settings?.googleSearchApiKey || process.env.GOOGLE_SEARCH_API_KEY || process.env.GOOGLE_CSE_API_KEY || "").trim();
  const cx = String(settings?.googleSearchCx || process.env.GOOGLE_SEARCH_CX || process.env.GOOGLE_CSE_ID || "").trim();
  const timeoutMs = Math.max(1000, Number(settings?.llmWebSearchTimeoutMs || LLM_WEB_SEARCH_TIMEOUT_MS) || LLM_WEB_SEARCH_TIMEOUT_MS);
  const resultLimit = Math.min(10, Math.max(1, Number(settings?.llmWebSearchResultLimit || LLM_WEB_SEARCH_RESULT_LIMIT) || LLM_WEB_SEARCH_RESULT_LIMIT));
  return { enabled, apiKey, cx, timeoutMs, resultLimit };
}

export function isWebSearchConfigured(settings = null) {
  const webSearchSettings = resolveWebSearchSettings(settings);
  return Boolean(webSearchSettings.enabled && webSearchSettings.apiKey && webSearchSettings.cx);
}

export function shouldUseWebSearchForQuestion(question) {
  const text = String(question || "").trim();
  if (!text) return false;
  return WEB_SEARCH_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function shouldFallbackToWebSearch(answer) {
  const text = String(answer || "").trim();
  if (!text) return false;
  return WEB_SEARCH_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(text));
}

function buildLlmRequestBody({ provider, model, messages, stream, maxTokenCount, extraBody }) {
  const normalizedExtra = extraBody && typeof extraBody === "object" && !Array.isArray(extraBody)
    ? extraBody
    : {};
  if (provider === "ollama-native") {
    const { options: extraOptions, ...extraRest } = normalizedExtra;
    return {
      model,
      messages,
      stream,
      options: {
        ...(extraOptions && typeof extraOptions === "object" && !Array.isArray(extraOptions) ? extraOptions : {}),
        num_predict: maxTokenCount,
      },
      ...extraRest,
    };
  }
  return {
    model,
    messages,
    max_tokens: maxTokenCount,
    ...(stream ? { stream: true } : {}),
    ...normalizedExtra,
  };
}

export async function searchWebForLlm(question, { settings = null, limit = null, timeoutMs = null } = {}) {
  const webSearchSettings = resolveWebSearchSettings(settings);
  const apiKey = webSearchSettings.apiKey;
  const cx = webSearchSettings.cx;
  const resolvedLimit = Math.min(10, Math.max(1, Number(limit || webSearchSettings.resultLimit) || webSearchSettings.resultLimit));
  const resolvedTimeoutMs = Math.max(1000, Number(timeoutMs || webSearchSettings.timeoutMs) || webSearchSettings.timeoutMs);
  if (!webSearchSettings.enabled) {
    return { configured: false, query: "", results: [], message: "웹 검색 보강이 비활성화되어 있습니다." };
  }
  if (!apiKey || !cx) {
    return { configured: false, query: "", results: [], message: "Google 검색 API 키 또는 검색 엔진 ID가 설정되지 않았습니다." };
  }

  const query = String(question || "").trim().slice(0, 240);
  if (!query) {
    return { configured: true, query: "", results: [], message: "검색어가 비어 있습니다." };
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(resolvedLimit));
  url.searchParams.set("hl", "ko");
  url.searchParams.set("safe", "active");

  const response = await fetchWithTimeout(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-store",
    },
  }, resolvedTimeoutMs);
  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || "Google 검색 API 호출에 실패했습니다.");
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  const results = (Array.isArray(payload?.items) ? payload.items : [])
    .map((item) => ({
      title: String(item?.title || "").trim(),
      link: String(item?.link || "").trim(),
      snippet: String(item?.snippet || "").replace(/\s+/g, " ").trim(),
      displayLink: String(item?.displayLink || "").trim(),
    }))
    .filter((item) => item.title && item.link)
    .slice(0, resolvedLimit);

  return {
    configured: true,
    query,
    results,
    searchedAt: new Date().toISOString(),
  };
}

export function buildWebSearchSummaryPrompt(searchResult) {
  const results = Array.isArray(searchResult?.results) ? searchResult.results : [];
  if (!results.length) return "";
  const sourceLines = results.map((item, index) => {
    const parts = [
      `[${index + 1}] ${item.title}`,
      item.displayLink ? `site: ${item.displayLink}` : "",
      `url: ${item.link}`,
      item.snippet ? `snippet: ${item.snippet}` : "",
    ].filter(Boolean);
    return parts.join("\n");
  });
  return [
    "웹 검색 결과를 근거로 답변합니다.",
    "규칙:",
    "- 검색 결과에 없는 내용은 추측하지 않습니다.",
    "- 핵심 요약을 먼저 쓰고, 마지막에 '출처' 목록을 번호와 URL로 포함합니다.",
    "- 서로 충돌하는 정보가 있으면 확인 가능한 범위와 불확실성을 밝힙니다.",
    `검색 시각: ${searchResult.searchedAt || new Date().toISOString()}`,
    `검색어: ${searchResult.query || ""}`,
    "",
    sourceLines.join("\n\n"),
  ].join("\n");
}

export function extractLlmAnswer(payload) {
  return extractLlmParts(payload).content;
}

export function extractLlmParts(payload) {
  const parts = { content: "", thinking: "" };
  if (!payload) return parts;
  if (typeof payload === "string") {
    parts.content = payload;
    return parts;
  }
  if (typeof payload.message?.thinking === "string") parts.thinking = payload.message.thinking;
  if (typeof payload.thinking === "string") parts.thinking = payload.thinking;
  if (typeof payload.answer === "string") parts.content = payload.answer;
  else if (typeof payload.message === "string") parts.content = payload.message;
  else if (typeof payload.message?.content === "string") parts.content = payload.message.content;
  else if (typeof payload.text === "string") parts.content = payload.text;
  else if (typeof payload.output === "string") parts.content = payload.output;
  else if (typeof payload.content === "string") parts.content = payload.content;
  else if (typeof payload.output_text === "string") parts.content = payload.output_text;
  const outputText = Array.isArray(payload.output)
    ? payload.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .map((item) => item?.text)
        .filter((item) => typeof item === "string" && item.trim())
        .join("\n")
    : "";
  if (!parts.content && outputText) parts.content = outputText;
  const choiceContent = payload.choices?.[0]?.message?.content;
  if (!parts.content && typeof choiceContent === "string") parts.content = choiceContent;
  if (!parts.content && !parts.thinking) parts.content = JSON.stringify(payload, null, 2);
  return parts;
}

export function normalizeLlmProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (["ollama", "ollama-native", "ollama_native", "native"].includes(normalized)) return "ollama-native";
  return "custom";
}

function resolveOllamaNativeChatUrl(apiUrl) {
  const normalized = String(apiUrl || "").trim();
  if (!normalized) return "";
  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "/") {
      url.pathname = "/api/chat";
    } else if (pathname === "/api") {
      url.pathname = "/api/chat";
    } else if (!pathname.endsWith("/api/chat")) {
      url.pathname = `${pathname}/api/chat`.replace(/\/+/g, "/");
    }
    url.search = "";
    return url.toString();
  } catch {
    return normalized.endsWith("/api/chat")
      ? normalized
      : `${normalized.replace(/\/+$/, "")}/api/chat`;
  }
}

function isOllamaNativeBaseUrl(apiUrl) {
  const normalized = String(apiUrl || "").trim();
  if (!normalized) return false;
  try {
    const url = new URL(normalized);
    const pathname = url.pathname.replace(/\/+$/, "");
    return Number(url.port || 0) === 11434 && (!pathname || pathname === "/");
  } catch {
    return /:11434\/?$/.test(normalized);
  }
}

export function resolveLlmConnectionSettings(settings = null) {
  const configuredProvider = normalizeLlmProvider(settings?.llmProvider);
  const configuredApiUrl = String(settings?.llmApiUrl || "").trim();
  const configuredModel = String(settings?.llmModel || "").trim();
  const configuredApiKey = String(settings?.llmApiKey || "").trim();
  const provider = configuredProvider === "custom" && isOllamaNativeBaseUrl(configuredApiUrl)
    ? "ollama-native"
    : configuredProvider;
  const apiUrl = String(
    (provider === "ollama-native"
      ? resolveOllamaNativeChatUrl(configuredApiUrl)
      : configuredApiUrl)
  ).trim();
  const model = String(configuredModel || "model").trim() || "model";
  const apiKey = configuredApiKey;
  return { provider, apiUrl, model, apiKey };
}

function resolveLlmThinkingMode(settings) {
  const normalized = String(settings?.llmThinkingMode || "").trim().toLowerCase();
  if (["enabled", "on", "true", "think"].includes(normalized)) return "enabled";
  if (["default", "auto", "model"].includes(normalized)) return "default";
  return "disabled";
}

function normalizeLlmModelFamily(model) {
  return String(model || "").trim().toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

function llmModelHasFamily(model, family) {
  const normalized = normalizeLlmModelFamily(model);
  const token = normalizeLlmModelFamily(family);
  if (!normalized || !token) return false;
  return normalized === token
    || normalized.startsWith(`${token}-`)
    || normalized.endsWith(`-${token}`)
    || normalized.includes(`-${token}-`);
}

function supportsOllamaThinkingOption(settings) {
  const model = settings?.llmModel || "";
  return llmModelHasFamily(model, "qwen3")
    || llmModelHasFamily(model, "deepseek-r1")
    || llmModelHasFamily(model, "qwq");
}

function buildLlmProbeExtraBody(settings, provider) {
  if (provider !== "ollama-native") return null;
  const thinkingMode = resolveLlmThinkingMode(settings);
  if (thinkingMode === "default") return null;
  if (!supportsOllamaThinkingOption(settings)) return null;
  return { think: thinkingMode === "enabled" };
}

function normalizeLlmHistory(history) {
  if (!Array.isArray(history)) return [];
  const limit = Math.max(0, Number(LLM_HISTORY_MESSAGE_LIMIT || 0) || 0);
  const items = history
    .map((item) => ({
      role: String(item?.role || "").trim().toLowerCase(),
      content: String(item?.text ?? item?.content ?? "").trim(),
    }))
    .filter((item) => ["user", "assistant"].includes(item.role) && item.content);
  return limit > 0 ? items.slice(-limit) : [];
}

function limitLlmText(value, maxChars = LLM_COURSE_CONTEXT_MAX_CHARS) {
  const text = String(value || "").trim();
  const limit = Math.max(0, Number(maxChars || 0) || 0);
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, limit).trimEnd()}\n...(context truncated for speed)`;
}

export function buildCourseLlmContext(course) {
  if (!course || !LLM_COURSE_CONTEXT_ENABLED) {
    return {
      systemPrompt: "",
      summary: course
        ? {
            id: course.id,
            slug: course.slug,
            type: course.courseType || "standard",
            title: course.title || "",
            summary: course.summary || "",
            level: course.level || "",
            duration: course.duration || "",
            labEnabled: Boolean(course.labEnabled),
          }
        : null,
    };
  }
  const summary = {
    id: course.id,
    slug: course.slug,
    type: course.courseType || "standard",
    title: course.title || "",
    summary: course.summary || "",
    level: course.level || "",
    duration: course.duration || "",
    labEnabled: Boolean(course.labEnabled),
  };
  const promptParts = [
    `현재 선택 과정: ${course.title || course.slug || "과정 미상"}`,
    course.summary ? `과정 요약: ${course.summary}` : "",
    course.body ? `과정 설명: ${limitLlmText(course.body, 700)}` : "",
    course.labGuideMarkdown ? `랩 가이드:\n${limitLlmText(course.labGuideMarkdown, 900)}` : "",
    course.commandsMarkdown ? `추천 명령어:\n${limitLlmText(course.commandsMarkdown, 500)}` : "",
    course.aiSystemPrompt ? `과정별 추가 지침:\n${course.aiSystemPrompt}` : "",
  ].filter(Boolean);
  return {
    systemPrompt: limitLlmText(promptParts.join("\n\n")),
    summary,
  };
}

export function buildLlmRequestContext(user, activeLab, selectedCourse) {
  return {
    user: {
      id: user?.id,
      name: user?.name,
      username: user?.username,
      role: user?.role,
    },
    activeLab: activeLab
      ? {
          id: activeLab.id,
          courseId: activeLab.courseId,
          status: activeLab.status,
          instanceIp: activeLab.instanceIp,
          nodeName: activeLab.nodeName,
        }
      : null,
    selectedCourse,
  };
}

export async function requestLlmChat({ provider = "custom", apiUrl, model = "model", apiKey = "", systemPrompt = "", question, history = null, context = null, timeoutMs = LLM_API_TIMEOUT_MS, maxTokens = LLM_MAX_TOKENS, extraBody = null, signal = null }) {
  const normalizedApiUrl = String(apiUrl || "").trim();
  if (!normalizedApiUrl) {
    throw new Error("LLM API URL이 설정되지 않았습니다.");
  }
  const normalizedProvider = normalizeLlmProvider(provider);
  const normalizedModel = String(model || "").trim() || "model";
  const normalizedApiKey = String(apiKey || "").trim();

  const systemParts = [];
  if (String(systemPrompt || "").trim()) {
    systemParts.push(String(systemPrompt || "").trim());
  }
  if (context) {
    try {
      systemParts.push(`context: ${JSON.stringify(context)}`);
    } catch {
      // ignore context serialization issues
    }
  }

  const messages = [];
  if (systemParts.length) {
    messages.push({ role: "system", content: systemParts.join("\n\n") });
  }
  messages.push(...normalizeLlmHistory(history).map((item) => ({ role: item.role, content: item.content })));
  messages.push({ role: "user", content: String(question || "").trim() });
  const maxTokenCount = Math.max(1, Number(maxTokens || LLM_MAX_TOKENS) || LLM_MAX_TOKENS);
  const requestBody = buildLlmRequestBody({
    provider: normalizedProvider,
    model: normalizedModel,
    messages,
    stream: false,
    maxTokenCount,
    extraBody,
  });

  const response = await fetchWithTimeout(normalizedApiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(normalizedApiKey ? { Authorization: `Bearer ${normalizedApiKey}` } : {}),
    },
    body: JSON.stringify(requestBody),
    signal,
  }, timeoutMs);

  const payload = await readJsonSafely(response);
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.message || "LLM API 호출에 실패했습니다.");
    error.status = response.status;
    error.payload = payload;
    error.apiUrl = normalizedApiUrl;
    error.provider = normalizedProvider;
    throw error;
  }

  return payload;
}

export async function requestLlmChatStream({ provider = "custom", apiUrl, model = "model", apiKey = "", systemPrompt = "", question, history = null, context = null, timeoutMs = LLM_API_TIMEOUT_MS, maxTokens = LLM_MAX_TOKENS, extraBody = null, onDelta = null, signal = null }) {
  const normalizedApiUrl = String(apiUrl || "").trim();
  if (!normalizedApiUrl) {
    throw new Error("LLM API URL이 설정되지 않았습니다.");
  }
  const normalizedProvider = normalizeLlmProvider(provider);
  const normalizedModel = String(model || "").trim() || "model";
  const normalizedApiKey = String(apiKey || "").trim();

  const systemParts = [];
  if (String(systemPrompt || "").trim()) {
    systemParts.push(String(systemPrompt || "").trim());
  }
  if (context) {
    try {
      systemParts.push(`context: ${JSON.stringify(context)}`);
    } catch {
      // ignore context serialization issues
    }
  }

  const messages = [];
  if (systemParts.length) {
    messages.push({ role: "system", content: systemParts.join("\n\n") });
  }
  messages.push(...normalizeLlmHistory(history).map((item) => ({ role: item.role, content: item.content })));
  messages.push({ role: "user", content: String(question || "").trim() });

  const maxTokenCount = Math.max(1, Number(maxTokens || LLM_MAX_TOKENS) || LLM_MAX_TOKENS);
  const requestBody = buildLlmRequestBody({
    provider: normalizedProvider,
    model: normalizedModel,
    messages,
    stream: true,
    maxTokenCount,
    extraBody,
  });

  const response = await fetchWithTimeout(normalizedApiUrl, {
    method: "POST",
    headers: {
      Accept: "text/event-stream, application/json",
      "Content-Type": "application/json",
      ...(normalizedApiKey ? { Authorization: `Bearer ${normalizedApiKey}` } : {}),
    },
    body: JSON.stringify(requestBody),
    signal,
  }, timeoutMs);

  if (!response.ok) {
    const payload = await readJsonSafely(response);
    const error = new Error(payload?.error?.message || payload?.message || "LLM API 호출에 실패했습니다.");
    error.status = response.status;
    error.payload = payload;
    error.apiUrl = normalizedApiUrl;
    error.provider = normalizedProvider;
    throw error;
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const payload = await readJsonSafely(response);
    const fallbackParts = extractLlmParts(payload);
    if (fallbackParts.thinking && typeof onDelta === "function") onDelta(fallbackParts.thinking, "thinking");
    if (fallbackParts.content && typeof onDelta === "function") onDelta(fallbackParts.content, "content");
    return { ...fallbackParts, lastPayload: payload };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let thinking = "";
  let lastPayload = null;

  const handleLine = (rawLine) => {
    const line = String(rawLine || "").trim();
    if (!line || line.startsWith(":")) return false;
    const data = line.startsWith("data:") ? line.slice(5).trim() : line;
    if (!data || data === "[DONE]") return data === "[DONE]";
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return false;
    }
    lastPayload = payload;
    const delta = extractLlmStreamDelta(payload);
    if (delta.thinking) {
      thinking += delta.thinking;
      if (typeof onDelta === "function") onDelta(delta.thinking, "thinking");
    }
    if (delta.content) {
      answer += delta.content;
      if (typeof onDelta === "function") onDelta(delta.content, "content");
    }
    return Boolean(payload?.done);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    let shouldStop = false;
    for (const line of lines) {
      shouldStop = handleLine(line) || shouldStop;
    }
    if (shouldStop) break;
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    handleLine(buffer);
  }
  if (!answer.trim()) {
    const fallbackParts = extractLlmParts(lastPayload);
    if (fallbackParts.thinking && !thinking.includes(fallbackParts.thinking)) {
      thinking += fallbackParts.thinking;
      if (typeof onDelta === "function") onDelta(fallbackParts.thinking, "thinking");
    }
    if (fallbackParts.content && fallbackParts.content !== JSON.stringify(lastPayload, null, 2)) {
      if (typeof onDelta === "function") onDelta(fallbackParts.content, "content");
      return { content: fallbackParts.content, thinking, lastPayload };
    }
  }
  return { content: answer, thinking, lastPayload };
}

function extractLlmStreamDelta(payload) {
  const delta = { content: "", thinking: "" };
  if (!payload || typeof payload !== "object") return delta;
  const choiceDelta = payload.choices?.[0]?.delta?.content;
  if (typeof choiceDelta === "string") {
    delta.content = choiceDelta;
    return delta;
  }
  const responseDelta = payload.type === "response.output_text.delta" ? payload.delta : "";
  if (typeof responseDelta === "string") delta.content = responseDelta;
  else if (typeof payload.delta === "string") delta.content = payload.delta;
  else if (typeof payload.response === "string") delta.content = payload.response;
  else if (typeof payload.message?.content === "string") delta.content = payload.message.content;
  else if (typeof payload.content === "string") delta.content = payload.content;
  if (typeof payload.message?.thinking === "string") delta.thinking = payload.message.thinking;
  else if (typeof payload.thinking === "string") delta.thinking = payload.thinking;
  return delta;
}

function buildLlmProbeCandidates(apiUrl, provider = "custom") {
  const normalized = String(apiUrl || "").trim();
  if (!normalized) return [];

  const candidates = [];
  const pushCandidate = (url, method, kind) => {
    if (!url || candidates.some((item) => item.url === url && item.method === method)) return;
    candidates.push({ url, method, kind });
  };

  if (normalizeLlmProvider(provider) === "ollama-native") {
    try {
      const source = new URL(normalized);
      const createUrl = (nextPath) => {
        const target = new URL(source.toString());
        target.pathname = nextPath;
        target.search = "";
        return target.toString();
      };
      pushCandidate(createUrl("/api/tags"), "GET", "ollama-tags");
      pushCandidate(createUrl("/api/version"), "GET", "ollama-version");
    } catch {
      const base = normalized.replace(/\/api\/chat\/?$/i, "").replace(/\/+$/, "");
      pushCandidate(`${base}/api/tags`, "GET", "ollama-tags");
      pushCandidate(`${base}/api/version`, "GET", "ollama-version");
    }
    return candidates;
  }

  try {
    const source = new URL(normalized);
    const pathname = source.pathname.replace(/\/+$/, "");
    const createUrl = (nextPath) => {
      const target = new URL(source.toString());
      target.pathname = nextPath;
      target.search = "";
      return target.toString();
    };

    pushCandidate(createUrl("/health"), "GET", "health");
    pushCandidate(createUrl("/v1/health"), "GET", "health");
    pushCandidate(createUrl("/v1/models"), "GET", "models");

    if (/\/chat\/completions$/i.test(pathname)) {
      pushCandidate(createUrl(pathname.replace(/\/chat\/completions$/i, "/models")), "GET", "models");
      pushCandidate(createUrl(pathname.replace(/\/chat\/completions$/i, "/health")), "GET", "health");
    }
  } catch {
    // ignore invalid URL parsing and fall back to the original endpoint
  }

  pushCandidate(normalized, "GET", "original");

  return candidates;
}

async function probeLlmEndpoint(candidate) {
  const response = await fetchWithTimeout(candidate.url, {
    method: candidate.method,
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-store",
    },
  }, LLM_PROBE_TIMEOUT_MS);

  if (response.ok) {
    const payload = await readJsonSafely(response).catch(() => null);
    return { reachable: true, endpoint: candidate.url, payload };
  }
  if (candidate.kind === "original" && [400, 401, 403, 405].includes(response.status)) {
    return { reachable: true, endpoint: candidate.url };
  }
  return { reachable: false, endpoint: candidate.url };
}

export async function probeLlmStatus(settings) {
  const llmConnection = resolveLlmConnectionSettings(settings);
  if (!llmConnection.apiUrl) {
    return {
      ok: false,
      configured: false,
      configuredEndpoint: "",
      probeEndpoint: "",
      provider: llmConnection.provider,
      model: llmConnection.model,
      message: "LLM 연결 정보가 설정되지 않았습니다.",
    };
  }

  const startedAt = Date.now();
  try {
    const candidates = buildLlmProbeCandidates(llmConnection.apiUrl, llmConnection.provider);
    let reachable = null;
    for (const candidate of candidates) {
      try {
        const result = await probeLlmEndpoint(candidate);
        if (result.reachable) {
          if (candidate.kind === "ollama-tags" && Array.isArray(result.payload?.models)) {
            const availableModels = result.payload.models
              .map((item) => String(item?.name || item?.model || "").trim())
              .filter(Boolean);
            if (!availableModels.includes(llmConnection.model)) {
              return {
                ok: false,
                configured: true,
                latencyMs: Date.now() - startedAt,
                endpoint: result.endpoint,
                configuredEndpoint: llmConnection.apiUrl,
                probeEndpoint: result.endpoint,
                provider: llmConnection.provider,
                model: llmConnection.model,
                availableModels,
                message: `Ollama 모델을 찾지 못했습니다: ${llmConnection.model}`,
              };
            }
          }
          reachable = result;
          break;
        }
      } catch {
        // try the next candidate
      }
    }

    if (!reachable) {
      await requestLlmChat({
        provider: llmConnection.provider,
        apiUrl: llmConnection.apiUrl,
        model: llmConnection.model,
        apiKey: llmConnection.apiKey,
        systemPrompt: settings.llmSystemPrompt || "",
        question: "ping",
        timeoutMs: LLM_PROBE_TIMEOUT_MS,
        maxTokens: 1,
        extraBody: {
          max_tokens: 1,
          temperature: 0,
          ...(buildLlmProbeExtraBody(settings, llmConnection.provider) || {}),
        },
      });
    }

    return {
      ok: true,
      configured: true,
      latencyMs: Date.now() - startedAt,
      endpoint: reachable?.endpoint || llmConnection.apiUrl,
      configuredEndpoint: llmConnection.apiUrl,
      probeEndpoint: reachable?.endpoint || llmConnection.apiUrl,
      provider: llmConnection.provider,
      model: llmConnection.model,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      latencyMs: Date.now() - startedAt,
      endpoint: llmConnection.apiUrl,
      configuredEndpoint: llmConnection.apiUrl,
      probeEndpoint: llmConnection.apiUrl,
      provider: llmConnection.provider,
      model: llmConnection.model,
      message: error.message,
    };
  }
}
