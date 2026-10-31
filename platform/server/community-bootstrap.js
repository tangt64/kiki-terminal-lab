import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {getConfig} from '../../server/config.js';
import {migratePlatform} from './community-migration.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
// Anchor environment, storage and helper paths before importing the platform runtime.
// This prevents a launch from the parent checkout from adopting its operating files.
process.chdir(root);
const config=getConfig();
process.env.PORT=String(config.port);
process.env.HOST=config.host;
process.env.HEAT_DRIVER='openstack';
process.env.PUBLIC_BASE_URL=config.publicUrl;
process.env.SESSION_COOKIE_SECURE=config.secureCookie?'1':'0';
process.env.DEFAULT_ADMIN_USERNAME=process.env.INITIAL_ADMIN_USERNAME||'admin';
process.env.DEFAULT_ADMIN_PASSWORD=process.env.INITIAL_ADMIN_PASSWORD||'';
process.env.DATA_ROOT_DIR ||= path.join(root,'data');
process.env.RUNTIME_ROOT_DIR ||= path.join(process.env.DATA_ROOT_DIR,'runtime');
process.env.ALLOW_DEV_RECOVERY_LOGIN='0';
process.env.OPENSTACK_CLOUDS_YAML ||= path.join(root,'secrets/clouds.yaml');
process.env.OPENSTACK_PREFER_INTERNAL_ENDPOINTS ||= '0';
if(process.env.PUBLIC_BASE_DOMAIN)process.env.LAB_BASE_DOMAIN ||= process.env.PUBLIC_BASE_DOMAIN;
process.env.CONTAINER_REGISTRY_IMAGE_MIRROR_COMMAND ||= path.join(root,'platform/scripts/registry-image-mirror.sh');
await fsp.mkdir(process.env.DATA_ROOT_DIR,{recursive:true});
await migratePlatform(config);
await import('./index.js');
