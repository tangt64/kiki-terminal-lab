import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Never read the parent project's .env, even when launched from its directory.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export function getConfig(env = process.env) {
  const publicUrl = new URL(env.PUBLIC_URL || 'http://localhost:4080');
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) throw new Error('PUBLIC_URL must be an HTTP(S) origin');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || /REPLACE|change-me/i.test(env.SESSION_SECRET)) throw new Error('SESSION_SECRET must be a unique random value of at least 32 characters');
  if (!/^[a-f\d]{64}$/i.test(env.CREDENTIAL_KEY || '')) throw new Error('CREDENTIAL_KEY must be 32 random bytes encoded as 64 hexadecimal characters');
  const port = Number(env.PORT || 4080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is invalid');
  if(env.HEAT_DRIVER&&env.HEAT_DRIVER!=='openstack')throw new Error('Community production uses HEAT_DRIVER=openstack. Test doubles are available only through the test harness.');
  if(env.PUBLIC_BASE_DOMAIN&&!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(env.PUBLIC_BASE_DOMAIN))throw new Error('PUBLIC_BASE_DOMAIN is invalid');
  const tcpPortStart=Number(env.TCP_PORT_START||22000),tcpPortEnd=Number(env.TCP_PORT_END||22099);
  if(!Number.isInteger(tcpPortStart)||!Number.isInteger(tcpPortEnd)||tcpPortStart<1024||tcpPortEnd>65535||tcpPortEnd<tcpPortStart||tcpPortEnd-tcpPortStart>999)throw new Error('TCP port range is invalid');
  if(env.TCP_FORWARDING_ENABLED==='1'&&!env.SSH_PUBLIC_HOST)throw new Error('SSH_PUBLIC_HOST is required for TCP forwarding');
  // Explicit infrastructure paths prevent ambient access to the original application.
  for (const key of ['OPENSTACK_CLOUDS_YAML', 'OPENSTACK_CA_CERT']) {
    if (env[key]) process.env[key] = path.resolve(ROOT, env[key]);
  }
  process.env.OPENSTACK_CLOUDS_YAML ||= path.join(ROOT,'secrets','clouds.yaml');
  process.env.DATA_ROOT_DIR = path.resolve(ROOT,env.DATA_ROOT_DIR||'data');
  return {
    host: env.HOST || '127.0.0.1', port, publicUrl: publicUrl.origin,
    databaseUrl: env.DATABASE_URL, sessionSecret: env.SESSION_SECRET,
    credentialKey: env.CREDENTIAL_KEY, secureCookie: publicUrl.protocol === 'https:',
    trustProxy: env.TRUST_PROXY === '1',
    initialAdmin: { username: env.INITIAL_ADMIN_USERNAME || 'admin', password: env.INITIAL_ADMIN_PASSWORD || '', name: env.INITIAL_ADMIN_NAME || 'Administrator' },
    fingerprints: (env.SSH_HOST_FINGERPRINTS || '').split(',').map(x => x.trim()).filter(Boolean),
    publicBaseDomain: (env.PUBLIC_BASE_DOMAIN||'').toLowerCase(),sshPublicHost:env.SSH_PUBLIC_HOST||'',
    tcpForwarding:env.TCP_FORWARDING_ENABLED==='1',tcpPortStart,tcpPortEnd,
  };
}

export const DEFAULT_SETTINGS = {
  selfServiceVmAutoProvisionEnabled: false,
  selfServiceVmProjectAutoApproveEnabled: false,
  selfServiceVmFloatingIpEnabled: false,
  publicDomainsEnabled: false,
  selfServiceVmAllowedFlavors: [],
  selfServiceVmAllowedImages: [],
  selfServiceVmProjectExternalNetworkName: '',
  selfServiceVmProjectQuotaProfiles: [
    { id: 'basic', label: '기본형', quota: { instances: 2, cores: 4, ram: 8192, volumes: 3, gigabytes: 100 } },
    { id: 'standard', label: '표준형', quota: { instances: 5, cores: 10, ram: 20480, volumes: 8, gigabytes: 250 } },
    { id: 'performance', label: '고성능형', quota: { instances: 10, cores: 20, ram: 40960, volumes: 15, gigabytes: 500 } },
  ],
};
