import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectionView, normalizeReport } from './contract.js';

export function defaultReportPath() {
  return process.env.SECURITY_INSPECTION_REPORT_PATH || path.join(process.env.DATA_ROOT_DIR || fileURLToPath(new URL('../../data/', import.meta.url)), 'security-inspection', 'latest.json');
}
export async function readReport(file = defaultReportPath()) {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Invalid report file');
    const buffer = Buffer.alloc(2 * 1024 * 1024 + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 2 * 1024 * 1024) throw new Error('Report too large');
    return normalizeReport(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error('Security report unavailable');
  } finally { await handle?.close(); }
}
export async function readInspection(file) { return inspectionView(await readReport(file)); }
