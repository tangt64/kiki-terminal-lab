const PLACEHOLDER_NAMES = new Set([
  "branch",
  "command",
  "container",
  "endpoint",
  "file",
  "host",
  "id",
  "image",
  "ip",
  "key",
  "name",
  "namespace",
  "password",
  "path",
  "port",
  "project",
  "repo",
  "tag",
  "token",
  "url",
  "username",
  "vm",
]);

const HTML_TAG_NAMES = new Set([
  "a",
  "abbr",
  "address",
  "area",
  "article",
  "aside",
  "b",
  "blockquote",
  "br",
  "button",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "i",
  "img",
  "input",
  "kbd",
  "label",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "option",
  "p",
  "pre",
  "s",
  "section",
  "select",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const INLINE_CODE_SEGMENT_PATTERN = /(`+)([\s\S]*?)\1/g;
const ANGLE_PLACEHOLDER_PATTERN = /(^|[^\\])<([A-Za-z][A-Za-z0-9_.-]{0,80})>/g;
const FENCED_CODE_BLOCK_PATTERN = /^\s*```/gm;

function isLikelyPlaceholderName(name) {
  const value = String(name || "");
  const normalized = value.toLowerCase();
  if (HTML_TAG_NAMES.has(normalized)) return false;
  if (value !== normalized) return false;
  return PLACEHOLDER_NAMES.has(normalized) || /^[a-z][a-z0-9_.-]{0,80}$/.test(value);
}

function escapeAnglePlaceholdersInText(text) {
  return String(text || "").replace(ANGLE_PLACEHOLDER_PATTERN, (match, prefix, name) => {
    if (!isLikelyPlaceholderName(name)) return match;
    return `${prefix}\\<${name}\\>`;
  });
}

function escapeAnglePlaceholdersOutsideInlineCode(line) {
  const parts = [];
  let lastIndex = 0;

  for (const match of String(line || "").matchAll(INLINE_CODE_SEGMENT_PATTERN)) {
    parts.push(escapeAnglePlaceholdersInText(line.slice(lastIndex, match.index)));
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  parts.push(escapeAnglePlaceholdersInText(line.slice(lastIndex)));
  return parts.join("");
}

export function normalizeMarkdownForMdxEditor(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  let inCodeFence = false;

  return lines
    .map((line) => {
      if (line.trim().startsWith("```")) {
        inCodeFence = !inCodeFence;
        return line;
      }

      if (inCodeFence) return line;
      return escapeAnglePlaceholdersOutsideInlineCode(line);
    })
    .join("\n");
}

export function countMarkdownCodeFences(markdown) {
  return (String(markdown || "").match(FENCED_CODE_BLOCK_PATTERN) || []).length;
}

export function hasUnclosedMarkdownFence(markdown) {
  return countMarkdownCodeFences(markdown) % 2 === 1;
}

export function summarizeMarkdownQuality(markdown) {
  const text = String(markdown || "");
  const trimmed = text.trim();
  const lines = trimmed ? text.split(/\r?\n/).length : 0;
  const headingCount = (text.match(/^#{1,6}\s+\S+/gm) || []).length;
  const fenceCount = countMarkdownCodeFences(text);
  const codeBlockCount = Math.floor(fenceCount / 2);
  const warnings = [];

  if (trimmed && headingCount === 0) warnings.push("제목 없음");
  if (fenceCount % 2 === 1) warnings.push("코드 블록 닫힘 확인");

  return {
    codeBlockCount,
    headingCount,
    lines,
    status: !trimmed ? "입력 대기" : warnings.length ? "확인 필요" : "저장 가능",
    warnings,
  };
}

export function getMarkdownBlockingWarnings(markdown, label = "Markdown") {
  if (!hasUnclosedMarkdownFence(markdown)) return [];
  return [`${label}: 코드 블록이 닫히지 않았습니다.`];
}
