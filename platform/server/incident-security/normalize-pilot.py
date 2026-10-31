"""Normalize the explicitly scoped node6 pilot; raw evidence stays on the node."""
import json
import subprocess
import datetime
import xml.etree.ElementTree as ET
from pathlib import Path

p = Path('/var/lib/terminal-lab-security/pilot-node6-20261031')
before = json.loads((p / 'baseline.json').read_text())
current = subprocess.check_output(['docker', 'ps', '--format', '{{.Names}} {{.Status}}'], text=True)
names = ['nova_compute', 'neutron_openvswitch_agent', 'openvswitch_vswitchd', 'openvswitch_db']

def states(text):
    return {n: next(('healthy' if '(healthy)' in line else 'unverified'
                     for line in text.splitlines() if line.startswith(n + ' ')), 'missing') for n in names}

started = (p / 'reports/started-at.txt').read_text().strip()
finished = (p / 'reports/completed-at.txt').read_text().strip()
trivy = json.loads((p / 'reports/trivy.json').read_text())
grype = json.loads((p / 'reports/grype.json').read_text())
dbt = json.loads((p / 'cache/trivy/db/metadata.json').read_text())
dbg = json.loads((p / 'reports/grype-db.json').read_text())
tf = [dict(id=v.get('VulnerabilityID', 'unknown'), title=v.get('Title') or v.get('VulnerabilityID', ''),
           severity=v.get('Severity', 'UNKNOWN').lower(), package=v.get('PkgName', ''),
           installedVersion=v.get('InstalledVersion', ''), fixedVersion=v.get('FixedVersion', ''))
      for result in trivy.get('Results', []) for v in result.get('Vulnerabilities', [])]
gf = [dict(id=m['vulnerability']['id'], title=m['vulnerability']['id'],
           severity=m['vulnerability'].get('severity', 'unknown').lower(), package=m['artifact']['name'],
           installedVersion=m['artifact']['version'], fixedVersion=', '.join(m['vulnerability'].get('fix', {}).get('versions', [])))
      for m in grype.get('matches', [])]
def deduplicate(rows):
    return list({(f['id'], f['package'], f['installedVersion']): f for f in rows}.values())

tf, gf = deduplicate(tf), deduplicate(gf)
for tool, findings in [('trivy', tf), ('grype', gf)]:
    if not any(f['package'] == 'minimist' and f['id'] in ['CVE-2021-44906', 'GHSA-xvch-5gv4-984h'] for f in findings):
        raise SystemExit(tool + ': expected positive control was not detected')
if not dbg.get('valid'):
    raise SystemExit('Grype database is not valid')
scans = []
for tool, rows, db in [('trivy', tf, {'builtAt': dbt.get('UpdatedAt'), 'updatedAt': dbt.get('DownloadedAt'), 'valid': True}),
                       ('grype', gf, {'builtAt': dbg.get('built'), 'updatedAt': dbg.get('built'), 'valid': bool(dbg.get('valid'))})]:
    counts = {s: sum(f['severity'] == s for f in rows) for s in ['critical', 'high', 'medium', 'low', 'negligible', 'unknown']}
    scans.append(dict(id='node6-' + tool + '-20261031', nodeId='node6', tool=tool, status='completed', scope='fixture',
                      targetLabel='격리된 minimist 1.2.5 시험 메타데이터', startedAt=started, completedAt=finished,
                      database=db, counts=counts, findings=rows))
ns = {'x': 'http://checklists.nist.gov/xccdf/1.2'}
root = ET.parse(p / 'reports/openscap.xml').getroot()
rules = [dict(id=r.get('idref'), title=r.get('idref').replace('xccdf_org.ssgproject.content_rule_', ''),
              severity='info', result=r.findtext('x:result', namespaces=ns)) for r in root.findall('.//x:rule-result', ns)]
if len([r for r in rules if r['result'] != 'notselected']) != 4:
    raise SystemExit('Expected exactly four evaluated OpenSCAP rules')
scans.append(dict(id='node6-openscap-20261031', nodeId='node6', tool='openscap', status='completed', scope='host-rules',
                  targetLabel='Rocky CIS L1 · SSH/계정 규칙 4개만', startedAt=started, completedAt=finished, database=None,
                  counts={s: sum(r['result'] == s for r in rules) for s in ['pass', 'fail', 'error', 'unknown', 'notapplicable', 'notchecked', 'notselected']},
                  findings=[r for r in rules if r['result'] != 'notselected']))
nodes = [dict(id='node' + str(i), observedAt=finished if i == 6 else '2026-10-31T13:29:16Z',
              tools=[dict(id=t, installation='installed' if i == 6 else 'not-installed', version=v if i == 6 else None,
                          signature='verified' if i == 6 else 'unknown')
                     for t, v in [('trivy', '0.76.1'), ('grype', '0.121.0'), ('openscap', '1.3.14')]]) for i in range(1, 7)]
pre, post = states(before['containers']), states(current)
ssh_keys = ['permitrootlogin', 'permitemptypasswords', 'passwordauthentication', 'kbdinteractiveauthentication']
effective = dict(line.split(' ', 1) for line in subprocess.check_output(['sshd', '-T'], text=True, timeout=8).splitlines() if ' ' in line)
verified_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
verification = dict(observedAt=verified_at, ssh={k: effective.get(k, 'unknown') for k in ssh_keys},
                    note='OpenSCAP의 SSH 규칙 2개 실패와 sshd -T 유효 설정이 불일치합니다. 프로필의 구성 기준·Include 처리와 적용 범위를 검토해야 하며, 실패를 자동으로 정상 처리하거나 설정을 변경하지 않았습니다.')
out = dict(schemaVersion=2, reportId='node6-pilot-20261031', observedAt=verified_at, pilotNode='node6', nodes=nodes, scans=scans,
           baseline=dict(before=pre, after=post, stable=pre == post and all(v == 'healthy' for v in post.values())),
           verification=verification,
           limits=dict(cpuQuotaPercent=50, memoryMaxMiB=2048, runtimeMaxSeconds=900),
           scopeNote='Trivy·Grype는 의도적으로 취약한 시험 메타데이터 탐지 검증입니다. 노드의 실제 CVE가 아닙니다. OpenSCAP은 선택한 4개 규칙만 평가하며 전체 CIS 준수 판정이 아닙니다.')
(p / 'pilot-report.json').write_text(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'completedAt': finished, 'scans': [{'tool': s['tool'], 'counts': s['counts']} for s in scans], 'baseline': out['baseline']}, ensure_ascii=False))
