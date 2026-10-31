// Entry point for the separate localhost preview server; not imported by App.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SecurityInspectionPanel } from './admin-security-inspection.jsx';
const loaders = {
  normal: async () => { const r = await fetch('/api/preview/security-inspection'); if (!r.ok) throw Error('read failed'); return r.json(); },
  empty: async () => ({ schemaVersion: 2, executionEnabled: false, mode: 'unavailable', report: null, stale: true }),
  error: async () => { throw Error('preview failure'); },
};
function Preview() {
  const [scenario, setScenario] = useState('normal');
  return <main style={{ background: '#f4f7fc', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
    <div style={{ padding: 16 }}>로컬 검증 · <label>화면 상태 <select value={scenario} onChange={e => setScenario(e.target.value)}><option value="normal">실제 파일럿 결과</option><option value="empty">미수집</option><option value="error">조회 실패</option></select></label></div>
    <SecurityInspectionPanel key={scenario} loadSnapshot={loaders[scenario]} />
  </main>;
}
document.title = '보안점검 관리자 미리보기';
createRoot(document.getElementById('root')).render(<Preview />);
