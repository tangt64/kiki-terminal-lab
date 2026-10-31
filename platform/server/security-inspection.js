import { readInspection } from './incident-security/reader.js';

// Results only. Installing, scheduling and scanning belong to the isolated runner.
export function registerSecurityInspectionRoutes(app, requireAdmin, { read = readInspection, hasPermission } = {}) {
  app.get('/api/admin/security-inspection', requireAdmin, async (req, res) => {
    if (!hasPermission?.(req.user)) return res.sendStatus(403);
    res.set('Cache-Control', 'no-store');
    try { res.json(await read()); }
    catch { res.status(503).json({ error: '보안점검 기록을 확인할 수 없습니다.' }); }
  });
}
