import https from 'node:https';
import { parse } from 'yaml';

// CAPO embeds certificates. Never execute kubeconfig plugins or read file references.
export function workloadConnection(raw, expectedServer) {
  const config = parse(raw);
  const context = config?.contexts?.find(item => item.name === config['current-context'])?.context;
  const cluster = config?.clusters?.find(item => item.name === context?.cluster)?.cluster;
  const user = config?.users?.find(item => item.name === context?.user)?.user;
  if (!cluster || !user || user.exec || user['auth-provider'] || user.tokenFile
    || cluster['certificate-authority'] || user['client-certificate'] || user['client-key']
    || cluster['insecure-skip-tls-verify'] || cluster['proxy-url']) throw Error('Unsupported workload credentials');
  const server = new URL(cluster.server);
  const expected = new URL(expectedServer);
  if (server.protocol !== 'https:' || server.username || server.password || server.search || server.hash
    || server.origin !== expected.origin || server.pathname !== expected.pathname) throw Error('Workload endpoint mismatch');
  if (!cluster['certificate-authority-data'] || !user['client-certificate-data'] || !user['client-key-data']) throw Error('Embedded workload certificates required');
  return { server, ca: Buffer.from(cluster['certificate-authority-data'], 'base64'), cert: Buffer.from(user['client-certificate-data'], 'base64'), key: Buffer.from(user['client-key-data'], 'base64') };
}

export function requestJson(connection, pathname, { method = 'GET', body } = {}) {
  if (!['GET', 'DELETE'].includes(method) || typeof pathname !== 'string' || !pathname.startsWith('/')
    || pathname.startsWith('//') || new URL(pathname, connection.server).origin !== connection.server.origin) {
    return Promise.reject(Error('Invalid workload request'));
  }
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const request = https.request(new URL(pathname, connection.server), {
      ca: connection.ca, cert: connection.cert, key: connection.key,
      method, rejectUnauthorized: true, headers: { Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) {
          finish(Error('Inventory too large'));
          request.destroy();
        } else chunks.push(chunk);
      });
      response.on('error', () => finish(Error('Workload inventory unavailable')));
      response.on('end', () => {
        if (method === 'DELETE' && [204, 404].includes(response.statusCode)) return finish(null, {});
        if (response.statusCode !== 200 && !(method === 'DELETE' && response.statusCode === 202)) return finish(Error('Workload inventory unavailable'));
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(Error('Invalid workload inventory')); }
      });
    });
    const timer = setTimeout(() => request.destroy(Error('Workload inventory timeout')), 12000);
    request.on('error', () => finish(Error('Workload inventory unavailable')));
    request.end(payload);
  });
}

export async function readWorkloadInventory(connection, read = requestJson) {
  const paths = ['/api/v1/services', '/api/v1/nodes', '/apis/discovery.k8s.io/v1/endpointslices'];
  const lists = await Promise.all(paths.map(path => read(connection, path)));
  for (const list of lists) {
    if (!Array.isArray(list.items) || list.metadata?.continue) throw Error('Incomplete workload inventory');
  }
  return { services: lists[0].items, nodes: lists[1].items, endpointSlices: lists[2].items };
}

export function serviceCatalog(services) {
  return services.filter(service => ['NodePort', 'LoadBalancer'].includes(service.spec?.type) && !service.metadata?.deletionTimestamp)
    .map(service => ({ uid: service.metadata.uid, namespace: service.metadata.namespace, name: service.metadata.name,
      type: service.spec.type, externalTrafficPolicy: service.spec.externalTrafficPolicy || 'Cluster',
      ports: (service.spec.ports || []).map(port => ({ name: port.name || '', port: port.port, protocol: port.protocol || 'TCP', nodePort: port.nodePort || null })),
      loadBalancerPending: service.spec.type === 'LoadBalancer' && !(service.status?.loadBalancer?.ingress || []).some(item => item.ip),
    }));
}

export async function readStorageInventory(connection, read = requestJson) {
  const lists=await Promise.all(['/apis/storage.k8s.io/v1/csidrivers','/apis/storage.k8s.io/v1/storageclasses'].map(path=>read(connection,path)));
  if(lists.some(list=>!Array.isArray(list.items)||list.metadata?.continue)) throw Error('Incomplete storage inventory');
  const drivers=lists[0].items.map(item=>item.metadata?.name).filter(Boolean);
  const classes=lists[1].items.map(item=>({name:item.metadata?.name,provisioner:item.provisioner,allowVolumeExpansion:item.allowVolumeExpansion===true,reclaimPolicy:item.reclaimPolicy||'Delete'}));
  const matched=classes.some(item=>drivers.includes(item.provisioner));
  return {drivers,classes,checkedAt:new Date().toISOString(),configured:matched,message:matched?'CSI 드라이버와 연결된 StorageClass가 등록되어 있습니다. 실제 PVC·마운트 성공은 별도 확인하세요.':'CSI 드라이버와 연결된 StorageClass 구성을 확인하지 못했습니다. 관리자에게 드라이버·저장소 설정을 확인하세요.'};
}

export async function assertCinderStorageEmpty(connection, read = requestJson) {
  const [pvcs, pvs] = await Promise.all([
    read(connection, '/api/v1/persistentvolumeclaims'),
    read(connection, '/api/v1/persistentvolumes'),
  ]);
  if (![pvcs, pvs].every(list => Array.isArray(list?.items) && !list.metadata?.continue)) {
    throw Error('Cinder 볼륨 목록을 완전히 확인하지 못해 클러스터 삭제를 중단했습니다.');
  }
  const activePvcs = pvcs.items.filter(item => !item.metadata?.deletionTimestamp
    && (item.spec?.storageClassName === 'cinder-csi'
      || pvs.items.some(pv => pv.metadata?.name === item.spec?.volumeName
        && pv.spec?.csi?.driver === 'cinder.csi.openstack.org')));
  const activePvs = pvs.items.filter(item => item.spec?.csi?.driver === 'cinder.csi.openstack.org');
  if (activePvcs.length || activePvs.length) {
    throw Error(`Cinder CSI PVC ${activePvcs.length}개 또는 PV ${activePvs.length}개가 남아 있습니다. 볼륨 정리와 삭제 완료를 확인한 뒤 클러스터를 삭제해 주세요.`);
  }
}
