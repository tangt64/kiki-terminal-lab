import hashlib,json,os,re,subprocess,ssl,time,urllib.request
from pathlib import Path
expected=json.loads(Path('/tmp/catalog-expected.json').read_text())
installed=json.loads(Path('/var/lib/ki2/installed.json').read_text())['packages']
actual={n:p['sha256'] for n,p in installed.items()}
def run(*args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=60)
    return {'exit':p.returncode,'out':p.stdout.strip(),'err':p.stderr.strip()[-1000:]}
checks={
    'all_expected_package_hashes':all(actual.get(n)==h for n,h in expected['packages'].items()),
    'exact_package_set':set(actual)==set(expected['packages']),
    'catalog_hash':hashlib.sha256(Path('/usr/share/ki2/package-groups.json').read_bytes()).hexdigest()==expected['catalog_sha256'],
    'uefi_disk_boot':Path('/sys/firmware/efi').is_dir() and 'root=' in Path('/proc/cmdline').read_text() and 'kiki.boot=installer' not in Path('/proc/cmdline').read_text(),
    'install_plan':Path('/var/lib/ki2/install-plan.yaml').is_file(),
    'security_group_installed':all(n in actual for n in ['openscap','kiki-security-content','libxslt','xmlsec']),
    'native_gnome_apps':all(n in actual for n in ['gnome-shell','gnome-control-center','nautilus','gnome-console','kiki-admin']),
}
file_mismatches=[p for p,h in expected['critical_files'].items() if not Path(p).is_file() or hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h]
checks['critical_payload_file_hashes']=not file_mismatches
services={n:run('systemctl','is-active',n) for n in ['gdm.service','NetworkManager.service','dbus.service','systemd-logind.service','kiki-desktop-firewall.service','systemd-timesyncd.service']}
checks['services_active']=all(r['out']=='active' for r in services.values())
default=run('systemctl','get-default');checks['graphical_target']=default['out']=='graphical.target'
failed=run('systemctl','--failed','--plain','--no-legend');checks['no_failed_units']=not failed['out']
oscap=run('/usr/bin/oscap','--version');checks['openscap_runs']=oscap['exit']==0
cache_rebuilds=[run('/sbin/ldconfig') for _ in range(2)]
checks['library_cache_rebuilds']=all(r['exit']==0 for r in cache_rebuilds)
checks['no_readline_preload_workaround']=not os.environ.get('LD_PRELOAD') and (not Path('/etc/ld.so.preload').exists() or not Path('/etc/ld.so.preload').read_text().strip())
kernel_config=Path('/boot/config-6.1.187-kiki-vm').read_text().splitlines()
checks['kernel_nftables_families_builtin']=all('CONFIG_'+n+'=y' in kernel_config for n in ['NF_TABLES','NF_TABLES_INET','NF_TABLES_IPV4','NF_TABLES_IPV6','NFT_CT'])
nmcli=run('/usr/bin/nmcli','--version')
checks['nmcli_runs']=nmcli['exit']==0
devices=run('/usr/bin/nmcli','-t','-f','DEVICE,STATE','device')
checks['nmcli_connected_device']=devices['exit']==0 and any('connected' in line and not line.startswith('lo:') for line in devices['out'].splitlines())
checks['readline_cache_stable']=(Path('/usr/lib/libreadline.so.8').readlink()==Path('libreadline.so.8.3') and not list(Path('/usr/lib').glob('libreadline*.old')))
ssh=run('/usr/sbin/sshd','-T','-C','user=root,host=localhost,addr=127.0.0.1')
checks['ssh_root_login_denied']=ssh['exit']==0 and 'permitrootlogin no' in ssh['out'].splitlines() and 'permitemptypasswords no' in ssh['out'].splitlines()
nft=run('/usr/sbin/nft','-j','list','table','inet','kiki_desktop')
try:nft_data=json.loads(nft['out'])
except Exception:nft_data={}
checks['inet_input_drop_policy']=nft['exit']==0 and any(row.get('chain',{}).get('name')=='input' and row['chain'].get('policy')=='drop' for row in nft_data.get('nftables',[]))
synchronized=run('timedatectl','show','-p','NTPSynchronized','--value')
deadline=time.monotonic()+60
while synchronized['out']!='yes' and time.monotonic()<deadline:
    time.sleep(3);synchronized=run('timedatectl','show','-p','NTPSynchronized','--value')
checks['clock_synchronized']=synchronized['exit']==0 and synchronized['out']=='yes'
group_info=run('/usr/bin/ki2ctl','group','info','security-audit');checks['installed_catalog_cli']=group_info['exit']==0 and 'openscap' in group_info['out']
plan=Path('/var/lib/ki2/install-plan.yaml').read_text() if checks['install_plan'] else ''
# Native stage-1 serializes the resolved package closure, not frontend group IDs.
# Compare the complete stored closure to independently resolved signed inputs.
block=re.search(r'(?ms)^  packages:\n(.*?)(?=^  [a-z_]+:|\Z)',plan)
profile=re.search(r'^    profile:\s*(.+)$',block[1],re.M) if block else None
plan_profile=json.loads(profile[1]) if profile else None
plan_packages=[json.loads(s) for s in re.findall(r'^      - (.+)$',block[1],re.M)] if block else []
checks['installed_plan_package_selection']=plan_profile==expected['profile'] and set(plan_packages)==set(expected['packages']) and len(plan_packages)==len(set(plan_packages))
scap=run('/usr/libexec/kiki-security-scan')
try:scap_report=json.loads(scap['out'])
except Exception:scap_report={}
checks['openscap_configuration_scan']=scap['exit']==0 and scap_report.get('status')=='completed' and len(scap_report.get('rules',[]))>0
checks['unchanged_security_policy']=scap_report.get('policy_sha256')==expected['security_policy_sha256']
checks['all_nine_security_rules_pass']=len(scap_report.get('rules',[]))==9 and all(row['result']=='pass' for row in scap_report.get('rules',[]))
root=run('findmnt','-no','SOURCE,FSTYPE','/');checks['installed_virtual_disk']=root['out'].startswith('/dev/sda')
tls=run('curl','-I','--max-time','25','https://example.com');checks['tls']=tls['exit']==0
try:
    with urllib.request.urlopen('https://example.com',timeout=25) as response:checks['python_https']=response.status==200
except Exception:checks['python_https']=False
result={'checks':checks,'status':'passed' if all(checks.values()) else 'failed','services':services,'root':root,'default_target':default,'failed':failed,
    'vm_id':expected['vm_id'],'iso_sha256':expected['iso_sha256'],'catalog_sha256':expected['catalog_sha256'],
    'install_plan_representation':'expanded package closure','install_plan_profile':plan_profile,'install_plan_package_count':len(plan_packages),
    'oscap':oscap,'scap':scap_report,'group_info':group_info,'tls':tls,'additional_probes':{'nmcli':nmcli,'devices':devices,'ssh_effective':ssh,'nft_ruleset':nft_data,'ntp_synchronized':synchronized},'known_issues':(['nmcli/readline terminal-library linkage'] if nmcli['exit'] else []),'boot_id':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'installed_count':len(actual),
    'missing':sorted(set(expected['packages'])-set(actual)),'extra':sorted(set(actual)-set(expected['packages'])),'critical_files_checked':len(expected['critical_files']),'file_mismatches':file_mismatches,
    'package_versions':{n:{k:installed[n][k] for k in ['version','release','sha256']} for n in ['linux','readline','openssh','kiki-desktop-defaults','ki2ctl','kiki-admin','openscap','kiki-security-content'] if n in actual}}
Path('/tmp/catalog-guest-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
