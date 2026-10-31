import {isIP} from 'node:net';

// No former deployment host is trusted implicitly. Operators supply their CIDRs.
export function sshSourceCidrs(value = process.env.COMMUNITY_SSH_SOURCE_CIDRS || '') {
  const entries = [...new Set(String(value).split(',').map(item => item.trim()).filter(Boolean))];
  for (const cidr of entries) {
    const [address, prefix, extra] = cidr.split('/');
    const version = isIP(address);
    if (!version || extra !== undefined || !/^\d+$/.test(prefix || '') || Number(prefix) > (version === 4 ? 32 : 128)) {
      throw new Error('COMMUNITY_SSH_SOURCE_CIDRS must contain valid IPv4/IPv6 CIDRs separated by commas');
    }
  }
  return entries;
}
