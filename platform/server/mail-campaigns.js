import { createHash } from "node:crypto";

export const MAIL_CAMPAIGN_MAX_CSV_BYTES = 2 * 1024 * 1024;
export const MAIL_CAMPAIGN_MAX_RECIPIENTS = Math.max(
  1,
  Math.min(5000, Number(process.env.MAIL_CAMPAIGN_MAX_RECIPIENTS || 1500) || 1500),
);

const EMAIL_HEADERS = new Set(["email", "email_address", "이메일", "메일", "메일주소", "전자우편"]);
const COMPANY_HEADERS = new Set(["company", "company_name", "organization", "organization_name", "회사", "회사명", "기업명", "기관명"]);
const NAME_HEADERS = new Set(["name", "recipient_name", "contact_name", "담당자", "담당자명", "이름", "수신자"]);

export function normalizeMailCampaignEmail(value) {
  return String(value || "").trim().replace(/^mailto:/i, "").toLowerCase();
}

export function isValidMailCampaignEmail(value) {
  const email = normalizeMailCampaignEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeHeader(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function parseCsvRows(input) {
  const text = String(input || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  row.push(cell);
  if (row.some((value) => String(value || "").trim())) rows.push(row);
  return rows;
}

function findHeaderIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.has(header));
}

export function parseMailRecipientCsv(input, { maxRecipients = MAIL_CAMPAIGN_MAX_RECIPIENTS } = {}) {
  const csvText = String(input || "");
  if (Buffer.byteLength(csvText, "utf8") > MAIL_CAMPAIGN_MAX_CSV_BYTES) {
    throw new Error("CSV 파일은 2MB 이하만 업로드할 수 있습니다.");
  }
  const rows = parseCsvRows(csvText);
  if (!rows.length) return { recipients: [], invalidRows: [], duplicateCount: 0, sourceHash: createHash("sha256").update(csvText).digest("hex") };
  const headers = rows[0].map(normalizeHeader);
  let emailIndex = findHeaderIndex(headers, EMAIL_HEADERS);
  let companyIndex = findHeaderIndex(headers, COMPANY_HEADERS);
  let nameIndex = findHeaderIndex(headers, NAME_HEADERS);
  let dataRows = rows.slice(1);
  if (emailIndex < 0 && rows[0].length >= 2 && isValidMailCampaignEmail(rows[0][1])) {
    emailIndex = 1;
    companyIndex = 0;
    nameIndex = -1;
    dataRows = rows;
  }
  if (emailIndex < 0) throw new Error("CSV에서 email 또는 이메일 열을 찾지 못했습니다.");
  if (dataRows.length > maxRecipients) throw new Error(`CSV 수신자는 최대 ${maxRecipients.toLocaleString("ko-KR")}명까지 처리할 수 있습니다.`);

  const recipients = [];
  const invalidRows = [];
  const seen = new Set();
  let duplicateCount = 0;
  dataRows.forEach((cells, rowIndex) => {
    const email = normalizeMailCampaignEmail(cells[emailIndex]);
    const companyName = companyIndex >= 0 ? String(cells[companyIndex] || "").trim() : "";
    const recipientName = nameIndex >= 0 ? String(cells[nameIndex] || "").trim() : "";
    if (!email && !companyName && !recipientName) return;
    if (!isValidMailCampaignEmail(email)) {
      invalidRows.push({ rowNumber: rowIndex + (dataRows === rows ? 1 : 2), email, companyName, reason: "invalid-email" });
      return;
    }
    if (seen.has(email)) {
      duplicateCount += 1;
      return;
    }
    seen.add(email);
    recipients.push({
      email,
      companyName,
      recipientName,
      source: "csv",
      sourceRowNumber: rowIndex + (dataRows === rows ? 1 : 2),
    });
  });
  return {
    recipients,
    invalidRows,
    duplicateCount,
    sourceHash: createHash("sha256").update(csvText).digest("hex"),
  };
}

export function mergeMailCampaignRecipients(...sources) {
  const merged = new Map();
  let duplicateCount = 0;
  for (const source of sources.flat()) {
    const email = normalizeMailCampaignEmail(source?.email);
    if (!isValidMailCampaignEmail(email)) continue;
    const existing = merged.get(email);
    if (existing) {
      duplicateCount += 1;
      existing.sources = Array.from(new Set([...(existing.sources || [existing.source]), source.source || "manual"]));
      if (!existing.companyName && source.companyName) existing.companyName = String(source.companyName).trim();
      if (!existing.recipientName && source.recipientName) existing.recipientName = String(source.recipientName).trim();
      if (!existing.userId && source.userId) existing.userId = Number(source.userId);
      continue;
    }
    merged.set(email, {
      email,
      companyName: String(source?.companyName || "").trim(),
      recipientName: String(source?.recipientName || "").trim(),
      userId: source?.userId ? Number(source.userId) : null,
      source: String(source?.source || "manual").trim() || "manual",
      sources: [String(source?.source || "manual").trim() || "manual"],
      metadata: source?.metadata && typeof source.metadata === "object" ? source.metadata : {},
    });
  }
  return { recipients: Array.from(merged.values()), duplicateCount };
}
