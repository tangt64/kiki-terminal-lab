import {createHash} from 'node:crypto';

export const sha256 = body => createHash('sha256').update(body).digest('hex');

export function parseRemote(value, kind, product) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Release remotes must use HTTPS URLs.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Release remotes must use HTTPS without embedded credentials.');
  }
  const parts = url.pathname.replace(/\/$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
  if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part)) || parts[1] !== product) {
    throw new Error('The remote must name this product in an owner/repository path.');
  }
  if ((kind === 'github') !== (url.hostname === 'github.com')) {
    throw new Error('Expected GitHub for the source remote and Gitea for the second remote.');
  }
  return {origin: url.origin, owner: parts[0], name: parts[1], fullName: parts.join('/'),
    gitUrl: `${url.origin}/${parts.join('/')}.git`, webUrl: `${url.origin}/${parts.join('/')}`};
}

export function parseChecksum(body, filename) {
  const match = Buffer.from(body).toString('utf8').trim().match(/^([a-fA-F0-9]{64})[ \t]+\*?([A-Za-z0-9._-]+)$/);
  if (!match || match[2] !== filename) throw new Error('The checksum must name exactly the selected ZIP.');
  return match[1].toLowerCase();
}

export function assertPrivateRepository(repo, location, {id, kind} = {}) {
  if (!repo || !Number.isSafeInteger(Number(repo.id)) || Number(repo.id) < 1 || (repo.private !== true && !(kind === 'github' && repo.private === false)) || repo.archived ||
      String(repo.full_name).toLowerCase() !== location.fullName.toLowerCase() ||
      (id !== undefined && String(repo.id) !== String(id))) {
    throw new Error('Repository identity, private visibility or active state does not match.');
  }
  if (kind === 'gitea' && repo.mirror) throw new Error('The Gitea target must be a regular repository, not a pull mirror.');
  if (!(repo.permissions?.push || repo.permissions?.admin)) throw new Error('The account needs push access.');
  return repo;
}

async function limitedBody(response, limit = 256 * 1024 * 1024) {
  if (Number(response.headers.get('content-length') || 0) > limit) throw new Error('Release asset exceeds the supported size.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body || []) {
    size += chunk.length;
    if (size > limit) throw new Error('Release asset exceeds the supported size.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class ReleaseTarget {
  constructor({kind, remote, location, token, fetchImpl = fetch, expectedId}) {
    this.kind = kind;
    this.remote = remote;
    this.location = location;
    this.token = token;
    this.fetch = fetchImpl;
    this.id = expectedId;
    this.apiOrigin = kind === 'github' ? 'https://api.github.com' : location.origin;
    this.apiBase = this.apiOrigin + (kind === 'gitea' ? '/api/v1' : '');
    this.repoPath = `/repos/${location.fullName}`;
  }

  async request(path, {method = 'GET', json, body, headers = {}, optional = false, absolute = false} = {}) {
    const url = new URL(absolute ? path : this.apiBase + path);
    const upload = this.kind === 'github' && url.origin === 'https://uploads.github.com' &&
      url.pathname.startsWith(`${this.repoPath}/releases/`);
    if (url.username || url.password || !(url.origin === this.apiOrigin || upload)) throw new Error('Unexpected authenticated API origin.');
    const requestHeaders = {Authorization: `Bearer ${this.token}`, Accept: 'application/json',
      'User-Agent': 'kiki-terminal-lab-release', ...headers};
    if (this.kind === 'github') requestHeaders['X-GitHub-Api-Version'] = '2022-11-28';
    if (json !== undefined) requestHeaders['Content-Type'] = 'application/json';
    let response;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        response = await this.fetch(url.href, {method, headers: requestHeaders,
          body: json === undefined ? body : JSON.stringify(json), redirect: 'manual', signal: AbortSignal.timeout(120000)});
      } catch { throw new Error(`${this.remote}: ${method} API request failed.`); }
      if (!(method === 'GET' && response.status >= 500 && attempt < 3)) break;
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
    if (optional && response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) throw new Error(`${this.remote}: ${method} API returned HTTP ${response.status}.`);
    if (response.status === 204) return null;
    return response.json();
  }

  async inspect() {
    const repo = await this.request(this.repoPath);
    assertPrivateRepository(repo, this.location, {id: this.id, kind: this.kind});
    if (this.private !== undefined && this.private !== repo.private) throw new Error('Repository visibility changed during release.');
    this.id = repo.id;
    this.private = repo.private;
    return repo;
  }

  async assets(release) {
    const result = [];
    for (let page = 1; page <= 100; page++) {
      const query = this.kind === 'github' ? `per_page=100&page=${page}` : `limit=100&page=${page}`;
      const batch = await this.request(`${this.repoPath}/releases/${release.id}/assets?${query}`);
      if (!Array.isArray(batch)) throw new Error('Unexpected release asset listing.');
      result.push(...batch);
      if (batch.length < 100) return result;
    }
    throw new Error('Release asset listing exceeded the supported limit.');
  }

  async release(tag) {
    let release = await this.request(`${this.repoPath}/releases/tags/${encodeURIComponent(tag)}`, {optional: true});
    // GitHub's by-tag endpoint can omit drafts. Authenticated listing makes an
    // interrupted draft discoverable without creating or overwriting another one.
    if (!release) {
      for (let page = 1; page <= 100; page++) {
        const query = this.kind === 'github' ? `per_page=100&page=${page}` : `limit=100&page=${page}`;
        const batch = await this.request(`${this.repoPath}/releases?${query}`);
        if (!Array.isArray(batch)) throw new Error('Unexpected release listing.');
        const matches = batch.filter(item => item.tag_name === tag);
        if (matches.length > 1) throw new Error('Multiple releases use the selected tag.');
        if (matches.length) { release = matches[0]; break; }
        if (batch.length < 100) break;
        if (page === 100) throw new Error('Release listing exceeded the supported limit.');
      }
    }
    if (!release) return null;
    if (release.tag_name !== tag) throw new Error('Unexpected release tag.');
    return {...release, assets: await this.assets(release)};
  }

  async download(asset) {
    let url;
    if (this.kind === 'github') {
      url = new URL(asset.url);
      if (url.origin !== this.apiOrigin || !url.pathname.startsWith(`${this.repoPath}/releases/assets/`)) {
        throw new Error('Unexpected GitHub asset API URL.');
      }
    } else {
      url = new URL(asset.browser_download_url);
      if (url.origin !== this.location.origin ||
          !(url.pathname.startsWith('/attachments/') || url.pathname.startsWith(`/${this.location.fullName}/releases/download/`))) {
        throw new Error('Unexpected Gitea asset URL.');
      }
    }
    let authenticated = true;
    for (let hop = 0; hop < 6; hop++) {
      let response;
      try {
        response = await this.fetch(url.href, {headers: {Accept: 'application/octet-stream',
          ...(authenticated ? {Authorization: `Bearer ${this.token}`} : {})},
          redirect: 'manual', signal: AbortSignal.timeout(120000)});
      } catch { throw new Error(`${this.remote}: asset download failed.`); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = new URL(response.headers.get('location'), url);
        await response.body?.cancel();
        if (next.protocol !== 'https:' || next.username || next.password) throw new Error('Unsafe asset redirect.');
        if (next.origin !== url.origin) {
          const allowed = this.kind === 'github' &&
            ['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com'].includes(next.hostname);
          if (!allowed) throw new Error('Unexpected asset redirect origin.');
          authenticated = false; // Never forward a repository credential to the asset CDN.
        }
        url = next;
        continue;
      }
      if (!response.ok) throw new Error(`${this.remote}: asset download returned HTTP ${response.status}.`);
      const body = await limitedBody(response);
      if (body.length !== Number(asset.size) || (asset.digest && asset.digest !== `sha256:${sha256(body)}`)) {
        throw new Error(`${this.remote}: downloaded asset size or API digest differs.`);
      }
      return body;
    }
    throw new Error('Too many asset redirects.');
  }

  async createRelease(tag, commit, notes, prerelease) {
    await this.inspect();
    return this.request(`${this.repoPath}/releases`, {method: 'POST', json: {
      tag_name: tag, target_commitish: commit, name: `KIKI OS TERMINAL-LAB ${tag.replace(/^v/, '')}${prerelease ? ' Preview' : ''}`,
      body: notes, prerelease, draft: true}});
  }

  async upload(release, file) {
    await this.inspect();
    if (this.kind === 'github') {
      const url = new URL(release.upload_url.replace(/\{.*\}$/, ''));
      url.searchParams.set('name', file.name);
      return this.request(url.href, {absolute: true, method: 'POST', body: file.body,
        headers: {'Content-Type': file.name.endsWith('.zip') ? 'application/zip' : 'text/plain'}});
    }
    const form = new FormData();
    form.append('attachment', new Blob([file.body]), file.name);
    return this.request(`${this.repoPath}/releases/${release.id}/assets?name=${encodeURIComponent(file.name)}`,
      {method: 'POST', body: form});
  }

  async finalize(release) {
    if (release.draft) {
      await this.inspect();
      await this.request(`${this.repoPath}/releases/${release.id}`, {method: 'PATCH', json: {draft: false}});
    }
    return this.release(release.tag_name);
  }

  async checkAnonymous(release) {
    for (const value of [this.location.webUrl, ...release.assets.map(asset => asset.browser_download_url)]) {
      const url = new URL(value);
      if (url.origin !== this.location.origin) throw new Error('Unexpected public verification URL.');
      let response;
      try { response = await this.fetch(url.href, {redirect: 'manual', signal: AbortSignal.timeout(30000)}); }
      catch { throw new Error(`${this.remote}: anonymous verification failed.`); }
      const location = response.headers.get('location');
      if (this.kind === 'github' && this.private === false) {
        const redirect = location ? new URL(location, url) : null;
        const downloadable = [301,302,303,307,308].includes(response.status) && redirect?.protocol === 'https:' && (redirect.hostname === 'github.com' && !/^\/(?:login|session|sessions)(?:\/|$)/.test(redirect.pathname) || redirect.hostname.endsWith('.githubusercontent.com'));
        if (response.status !== 200 && !downloadable) throw new Error('Public GitHub download verification failed.');
        await response.body?.cancel();
        continue;
      }
      const login = location ? new URL(location, url) : null;
      const denied = [401, 403, 404].includes(response.status) ||
        ([301, 302, 303, 307, 308].includes(response.status) && login?.origin === url.origin && login.pathname.startsWith('/user/login'));
      await response.body?.cancel();
      if (!denied) throw new Error(`${this.remote}: repository or release file is reachable without authentication.`);
    }
  }
}

export async function verifyAssets(target, release, files) {
  for (const file of files) {
    const matches = release.assets.filter(asset => asset.name === file.name);
    if (matches.length !== 1) throw new Error(`${target.remote}: expected exactly one ${file.name}.`);
    const body = await target.download(matches[0]);
    if (sha256(body) !== file.sha256) throw new Error(`${target.remote}: asset content differs; this version will not be overwritten.`);
  }
}

// All known collisions are checked on both servers before any Git or release write.
export async function publishBoth({targets, files, tag, commit, notes, prerelease = true,
  push, verifyRefs, createTag = () => {}, verifyOnly = false, log = () => {}}) {
  const existing = [];
  for (const target of targets) {
    await target.inspect();
    const release = await target.release(tag);
    if (release) {
      for (const file of files) {
        const matches = release.assets.filter(asset => asset.name === file.name);
        if (matches.length > 1) throw new Error('Duplicate release asset names.');
        if (matches.length) {
          const body = await target.download(matches[0]);
          if (sha256(body) !== file.sha256) throw new Error(`${target.remote}: existing asset differs; use a new version.`);
        }
      }
    } else if (verifyOnly) throw new Error(`${target.remote}: the release is missing.`);
    existing.push(release);
  }
  if (!verifyOnly) {
    await createTag();
    for (const target of targets) {
      await target.inspect();
      await push(target);
      await verifyRefs(target);
      log(`${target.remote}: code and tag verified`);
    }
  }
  const drafts = [];
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    let release = existing[index];
    if (!verifyOnly) {
      release ||= await target.createRelease(tag, commit, notes, prerelease);
      for (const file of files) {
        if (!release.assets?.some(asset => asset.name === file.name)) await target.upload(release, file);
      }
      release = await target.release(tag);
    }
    if (!release) throw new Error(`${target.remote}: release was not created.`);
    await verifyAssets(target, release, files);
    drafts.push(release);
  }
  const results = [];
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index];
    const release = verifyOnly ? drafts[index] : await target.finalize(drafts[index]);
    if (!release || release.draft) throw new Error(`${target.remote}: release is still a draft.`);
    await target.inspect();
    await verifyRefs(target);
    await verifyAssets(target, release, files);
    const managed = {...release, assets: release.assets.filter(asset => files.some(file => file.name === asset.name))};
    await target.checkAnonymous(managed);
    results.push({remote: target.remote, repository: target.location.webUrl, id: target.id, private: target.private ?? true,
      release: release.html_url || `${target.location.webUrl}/releases/tag/${tag}`, commit,
      assets: managed.assets.map(asset => ({name: asset.name, size: asset.size, sha256: files.find(file => file.name === asset.name).sha256}))});
    log(`${target.remote}: release visibility and SHA-256 verified`);
  }
  return results;
}
