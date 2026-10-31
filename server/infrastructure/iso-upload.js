import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import { isoError } from "./iso-vm.js";

export async function receiveIso(stream, { directory, expectedSha256, maxBytes = 8 * 1024 ** 3 }) {
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256 || "")) throw isoError("빌드 결과의 ISO SHA-256을 입력하세요.");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const folder = await fs.mkdtemp(path.join(directory, "iso-upload-"));
  const filename = path.join(folder, "image.iso");
  const hash = createHash("sha256"); let size = 0; let prefix = Buffer.alloc(0);
  try {
    const file = await fs.open(filename, "wx", 0o600);
    try {
      for await (const value of stream) {
        const chunk = Buffer.from(value); size += chunk.length;
        if (size > maxBytes) throw isoError("ISO 업로드는 8GB까지 지원합니다.", 413);
        hash.update(chunk);
        if (prefix.length < 32774) prefix = Buffer.concat([prefix, chunk.subarray(0, 32774 - prefix.length)]);
        let offset = 0;
        while (offset < chunk.length) { const written = await file.write(chunk, offset, chunk.length - offset); offset += written.bytesWritten; }
      }
    } finally { await file.close(); }
    const sha256 = hash.digest("hex");
    if (sha256 !== expectedSha256.toLowerCase()) throw isoError("ISO SHA-256이 빌드 결과와 일치하지 않습니다.");
    if (prefix.subarray(32769, 32774).toString("ascii") !== "CD001") throw isoError("ISO9660 설치 이미지가 아닙니다.");
    return { filename, size, sha256, cleanup: () => fs.rm(folder, { recursive: true, force: true }) };
  } catch (error) { await fs.rm(folder, { recursive: true, force: true }); throw error; }
}

// Stream the already verified file; do not route a multi-GB body through the
// JSON OpenStack fetch wrapper or disable TLS certificate verification.
export async function streamIsoToGlance(url, { filename, size, token, ca }) {
  const endpoint = new URL(url); const client = endpoint.protocol === "https:" ? https : http;
  if (!["http:", "https:"].includes(endpoint.protocol)) throw isoError("잘못된 Glance 주소입니다.");
  return new Promise((resolve, reject) => {
    const request = client.request(endpoint, { method: "PUT", ca, headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size), "X-Auth-Token": token } }, (response) => {
      response.resume();
      response.once("end", () => response.statusCode >= 200 && response.statusCode < 300 ? resolve() : reject(isoError(`Glance ISO 전송 실패 (HTTP ${response.statusCode})`, 502)));
      response.once("error", reject);
    });
    request.once("error", reject); request.setTimeout(60000, () => request.destroy(new Error("Glance ISO 전송 시간이 초과됐습니다.")));
    pipeline(createReadStream(filename), request).catch(reject);
  });
}
