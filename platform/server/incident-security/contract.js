// Portable producer/consumer contract. No portal, SSH, database or LLM dependencies.
export const TOOL_IDS = ['trivy', 'grype', 'openscap'];
const severityKeys = ['critical', 'high', 'medium', 'low', 'negligible', 'unknown'];
const ruleKeys = ['pass', 'fail', 'error', 'unknown', 'notapplicable', 'notchecked', 'notselected'];
const fail = () => { throw new Error('Invalid security report'); };
const text = (v, max = 300) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u0008\u000b-\u001f]/.test(v) ? v : fail();
const choice = (v, allowed) => allowed.includes(v) ? v : fail();
const time = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : fail();
const array = (v, max) => Array.isArray(v) && v.length <= max ? v : fail();
const nodeId = v => typeof v === 'string' && /^node[1-6]$/.test(v) ? v : fail();
const unique = values => new Set(values).size === values.length || fail();
const count = v => Number.isSafeInteger(v) && v >= 0 && v <= 100000 ? v : fail();

function verificationFor(input, target, scans, observedAt, now) {
  if (!input) return null;
  const value = {
    observedAt: time(input.observedAt), note: text(input.note, 1000),
    diagnosedAt: input.diagnosedAt ? time(input.diagnosedAt) : null,
    explanations: array(input.explanations || [], 8).map(e => ({
      ruleId: text(e.ruleId), reason: choice(e.reason, ['explicit-setting-missing', 'conflicting-static-values']),
      title: text(e.title), evidence: text(e.evidence, 1000), recommendation: text(e.recommendation, 1000),
    })),
    ssh: Object.fromEntries(['permitrootlogin', 'permitemptypasswords', 'passwordauthentication', 'kbdinteractiveauthentication']
      .map(k => [k, choice(input.ssh?.[k], ['yes', 'no', 'prohibit-password', 'forced-commands-only', 'unknown'])])),
  };
  if (Date.parse(value.observedAt) > Date.parse(observedAt) || (value.diagnosedAt && Date.parse(value.diagnosedAt) > now + 300000)) fail();
  unique(value.explanations.map(e => e.ruleId));
  for (const e of value.explanations) {
    if (!scans.some(s => s.nodeId === target && s.tool === 'openscap' && s.findings.some(f => f.id === e.ruleId && f.result === 'fail'))) fail();
  }
  return value;
}

function nodeBaseline(input) {
  const states = value => {
    const entries = Object.entries(value || {});
    if (!entries.length || entries.length > 200) fail();
    return Object.fromEntries(entries.map(([name, state]) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(name)) fail();
      return [name, choice(state, ['healthy', 'running', 'unhealthy', 'stopped', 'missing', 'unknown', 'unverified'])];
    }));
  };
  const before = states(input?.before), after = states(input?.after);
  const continuity = choice(input?.continuity, ['verified', 'changed', 'unverified']);
  const sshConfigUnchanged = typeof input?.sshConfigUnchanged === 'boolean' ? input.sshConfigUnchanged : null;
  const names = Object.keys(before);
  const stable = names.length === Object.keys(after).length && names.every(n => ['healthy', 'running'].includes(before[n]) && before[n] === after[n])
    && continuity !== 'changed' && sshConfigUnchanged !== false;
  return { before, after, continuity, sshConfigUnchanged, stable };
}

export function normalizeReport(input, now = Date.now()) {
  if (input?.schemaVersion !== 2) fail();
  const observedAt = time(input.observedAt);
  if (Date.parse(observedAt) > now + 300000) fail();
  const nodes = array(input.nodes, 6).map(n => {
    const tools = array(n.tools, 3).map(t => ({ id: choice(t.id, TOOL_IDS),
      installation: choice(t.installation, ['installed', 'not-installed', 'unknown']),
      version: t.version === null ? null : text(t.version, 100),
      signature: choice(t.signature, ['verified', 'unknown']) }));
    unique(tools.map(t => t.id));
    if (tools.length !== TOOL_IDS.length) fail();
    if (tools.some(t => t.installation === 'installed' ? !t.version : t.version !== null || t.signature !== 'unknown')) fail();
    const checked = time(n.observedAt);
    if (Date.parse(checked) > Date.parse(observedAt)) fail();
    return { id: nodeId(n.id), observedAt: checked, tools };
  });
  unique(nodes.map(n => n.id));
  const pilotNode = nodeId(input.pilotNode);
  if (!nodes.some(n => n.id === pilotNode)) fail();
  const scans = array(input.scans, 30).map(s => {
    const tool = choice(s.tool, TOOL_IDS);
    const scope = choice(s.scope, tool === 'openscap' ? ['host-rules'] : ['fixture']);
    const keys = tool === 'openscap' ? ruleKeys : severityKeys;
    const counts = Object.fromEntries(keys.map(k => [k, count(s.counts?.[k] ?? 0)]));
    const findings = array(s.findings, 5000).map(f => {
      const base = { id: text(f.id), title: text(f.title, 1000), severity: choice(f.severity, tool === 'openscap' ? ['info'] : severityKeys) };
      if (tool === 'openscap') return { ...base, result: choice(f.result, ruleKeys.filter(k => k !== 'notselected')) };
      return { ...base, package: text(f.package), installedVersion: text(f.installedVersion, 100), fixedVersion: typeof f.fixedVersion === 'string' ? f.fixedVersion.slice(0, 300) : '' };
    });
    unique(findings.map(f => JSON.stringify([f.id, f.package || '', f.installedVersion || ''])));
    for (const k of keys.filter(k => k !== 'notselected')) {
      if (counts[k] !== findings.filter(f => (tool === 'openscap' ? f.result : f.severity) === k).length) fail();
    }
    const startedAt = time(s.startedAt), completedAt = time(s.completedAt);
    if (Date.parse(startedAt) > Date.parse(completedAt) || Date.parse(completedAt) > Date.parse(observedAt)) fail();
    const node = nodes.find(n => n.id === nodeId(s.nodeId));
    if (!node) fail();
    const status = choice(s.status, ['completed', 'failed']);
    if (status === 'completed' && !node.tools.some(t => t.id === tool && t.installation === 'installed' && t.signature === 'verified')) fail();
    const database = tool === 'openscap' || !s.database ? null : {
      builtAt: time(s.database.builtAt), updatedAt: time(s.database.updatedAt), valid: s.database.valid === true,
    };
    if (database && (Date.parse(database.builtAt) > now + 300000 || Date.parse(database.updatedAt) > now + 300000)) fail();
    return { id: text(s.id, 100), nodeId: node.id, tool, status, scope, targetLabel: text(s.targetLabel),
      startedAt, completedAt, database, counts, findings };
  });
  unique(scans.map(s => s.id));
  const serviceStates = value => Object.fromEntries(['nova_compute', 'neutron_openvswitch_agent', 'openvswitch_vswitchd', 'openvswitch_db']
    .map(k => [k, choice(value?.[k], ['healthy', 'unverified', 'missing'])]));
  const before = serviceStates(input.baseline?.before), after = serviceStates(input.baseline?.after);
  const stable = Object.keys(before).every(k => before[k] === 'healthy' && after[k] === 'healthy');
  const verification = verificationFor(input.verification, pilotNode, scans, observedAt, now);
  const assessments = array(input.assessments || [], 6).map(a => {
    const target = nodeId(a.nodeId), checked = time(a.observedAt);
    if (!nodes.some(n => n.id === target) || Date.parse(checked) > Date.parse(observedAt)
      || scans.some(s => s.nodeId === target && Date.parse(s.completedAt) > Date.parse(checked))) fail();
    return { nodeId: target, observedAt: checked, baseline: nodeBaseline(a.baseline),
      verification: verificationFor(a.verification, target, scans, checked, now) };
  });
  unique(assessments.map(a => a.nodeId));
  if (assessments.length && scans.some(s => !assessments.some(a => a.nodeId === s.nodeId))) {
    fail();
  }
  return { schemaVersion: 2, reportId: text(input.reportId, 100), observedAt, pilotNode, nodes, scans,
    baseline: { before, after, stable }, verification, assessments, scopeNote: text(input.scopeNote, 1000),
    limits: { cpuQuotaPercent: count(input.limits?.cpuQuotaPercent), memoryMaxMiB: count(input.limits?.memoryMaxMiB), runtimeMaxSeconds: count(input.limits?.runtimeMaxSeconds) } };
}

export function inspectionView(report, now = Date.now()) {
  const normalized = report ? normalizeReport(report, now) : null;
  const scanObservedAt = normalized ? Math.min(Date.parse(normalized.observedAt), ...normalized.scans.map(s => Date.parse(s.completedAt))) : 0;
  return { schemaVersion: 2, mode: normalized ? 'pilot-report' : 'unavailable', executionEnabled: false,
    stale: !normalized || now - scanObservedAt > 86400000,
    source: 'incident-security', report: normalized && { ...normalized, scans: normalized.scans.map(s => ({ ...s,
      database: s.database && { ...s.database, stale: now - Date.parse(s.database.builtAt) > 7 * 86400000 },
      findingCount: s.findings.length, findings: s.findings.slice(0, 100), truncated: s.findings.length > 100 })) } };
}
