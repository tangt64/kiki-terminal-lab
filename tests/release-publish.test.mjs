import test from 'node:test';
import assert from 'node:assert/strict';
import {ReleaseTarget, assertPrivateRepository, parseChecksum, parseRemote, publishBoth, sha256} from '../scripts/release-api.mjs';
import {parseArguments} from '../scripts/release-publish.mjs';

const product = 'kiki-terminal-lab';
const location = parseRemote('https://github.com/example/kiki-terminal-lab.git', 'github', product);
const files = [{name: 'kiki-terminal-lab-1.0.0.zip', body: Buffer.from('source archive')}];
files.push({name: files[0].name + '.sha256', body: Buffer.from(`${sha256(files[0].body)}  ${files[0].name}\n`)});
for (const file of files) file.sha256 = sha256(file.body);

function fixtures({publicSecond = false, collision = false, interrupted = false} = {}) {
  const events = [];
  const targets = ['origin', 'internal'].map((remote, index) => {
    const assets = new Map();
    if (collision && index === 1) assets.set(files[0].name, Buffer.from('another version'));
    if (interrupted && index === 0) for (const file of files) assets.set(file.name, file.body);
    const target = {remote, id: index + 1, location: {webUrl: `https://${remote}.example/kiki-terminal-lab`},
      exists: assets.size > 0, draft: !interrupted, uploads: 0,
      async inspect() { events.push(`${remote}:inspect`); if (index === 1 && publicSecond) throw new Error('not private'); },
      snapshot() { return {id: index + 1, tag_name: 'v1.0.0', draft: this.draft, assets: [...assets].map(([name, body]) => ({name, size: body.length}))}; },
      async release() { return this.exists ? this.snapshot() : null; },
      async download(asset) { return assets.get(asset.name); },
      async createRelease() { events.push(`${remote}:create`); this.exists = true; this.draft = true; return this.snapshot(); },
      async upload(release, file) { events.push(`${remote}:upload`); assert.equal(assets.has(file.name), false); assets.set(file.name, file.body); this.uploads++; },
      async finalize() { events.push(`${remote}:publish`); this.draft = false; return this.snapshot(); },
      async checkAnonymous() { events.push(`${remote}:anonymous`); }, assets};
    return target;
  });
  const settings = {targets, files, tag: 'v1.0.0', commit: 'a'.repeat(40),
    createTag: () => events.push('tag'), push: target => events.push(`${target.remote}:push`),
    verifyRefs: target => events.push(`${target.remote}:verify-refs`)};
  return {events, targets, settings};
}

test('remote selection rejects credentials, alternate push destinations and other products', () => {
  assert.equal(location.fullName, 'example/kiki-terminal-lab');
  for (const url of ['http://github.com/example/kiki-terminal-lab.git', 'https://user:secret@github.com/example/kiki-terminal-lab.git',
    'https://github.com/example/other.git', 'https://github.com/example/kiki-terminal-lab.git?token=secret', 'git@github.com:example/kiki-terminal-lab.git']) {
    assert.throws(() => parseRemote(url, 'github', product));
  }
  assert.throws(() => parseRemote('https://gitea.example/example/kiki-terminal-lab.git', 'github', product));
});

test('private repository check refuses public, replaced, archived, mirrored and read-only targets', () => {
  const repo = {id: 8, private: true, full_name: location.fullName, permissions: {push: true}};
  assert.equal(assertPrivateRepository(repo, location, {id: 8}).id, 8);
  for (const patch of [{private: false}, {id: 9}, {archived: true}, {permissions: {pull: true}}, {full_name: 'somebody/other'}]) {
    assert.throws(() => assertPrivateRepository({...repo, ...patch}, location, {id: 8}));
  }
  assert.throws(() => assertPrivateRepository({...repo, mirror: true}, location, {kind: 'gitea'}));
});

test('checksum must bind the digest to the exact ZIP filename', () => {
  assert.equal(parseChecksum(files[1].body, files[0].name), files[0].sha256);
  assert.equal(parseChecksum(Buffer.from(`${files[0].sha256} *${files[0].name}\r\n`), files[0].name), files[0].sha256);
  for (const body of ['bad', `${files[0].sha256}  ../other.zip`, `${files[0].sha256}  other.zip`, files[1].body + 'extra']) {
    assert.throws(() => parseChecksum(body, files[0].name));
  }
});

test('a public second repository stops before any tag, push or release write', async () => {
  const {settings, events} = fixtures({publicSecond: true});
  await assert.rejects(publishBoth(settings), /private/);
  assert.equal(events.some(event => /:push|:create|:upload|:publish|^tag$/.test(event)), false);
});

test('an immutable asset collision on the second server is detected before either push', async () => {
  const {settings, events} = fixtures({collision: true});
  await assert.rejects(publishBoth(settings), /new version/);
  assert.equal(events.some(event => /:push|:create|:upload|^tag$/.test(event)), false);
});

test('both asset sets are complete and verified before either draft is published', async () => {
  const {settings, events, targets} = fixtures();
  const result = await publishBoth(settings);
  assert.equal(result.length, 2);
  assert.ok(events.indexOf('internal:upload') < events.indexOf('origin:publish'));
  assert.deepEqual(targets.map(target => target.uploads), [2, 2]);
  assert.ok(result.every(target => target.assets[0].sha256 === files[0].sha256 && target.private));
});

test('a partial upload can be resumed without replacing the completed release', async () => {
  const {settings, targets} = fixtures({interrupted: true});
  const original = targets[1].upload;
  let fail = true;
  targets[1].upload = async (...args) => {
    if (fail && args[1].name.endsWith('.sha256')) { fail = false; throw new Error('temporary outage'); }
    return original.call(targets[1], ...args);
  };
  await assert.rejects(publishBoth(settings), /temporary outage/);
  await publishBoth(settings);
  assert.deepEqual(targets.map(target => target.uploads), [0, 2]);
});

test('verification-only compares bytes and refs without modifying either server', async () => {
  const {settings, events, targets} = fixtures({interrupted: true});
  targets[1].exists = true; targets[1].draft = false;
  for (const file of files) targets[1].assets.set(file.name, file.body);
  await publishBoth({...settings, verifyOnly: true});
  assert.equal(events.some(event => /:push|:create|:upload|:publish|^tag$/.test(event)), false);
  assert.equal(events.filter(event => event.endsWith(':anonymous')).length, 2);
});

test('privacy changes after the preflight prevent the affected push', async () => {
  const {settings, targets, events} = fixtures();
  let calls = 0;
  targets[0].inspect = async () => { if (++calls > 1) throw new Error('now public'); };
  await assert.rejects(publishBoth(settings), /now public/);
  assert.equal(events.some(event => event.endsWith(':push')), false);
});

test('GitHub asset redirects strip the repository credential before reaching the CDN', async () => {
  const requests = [];
  const target = new ReleaseTarget({kind: 'github', remote: 'origin', location, token: 'test-token', fetchImpl: async (url, options) => {
    requests.push({url, headers: options.headers});
    if (requests.length === 1) return new Response(null, {status: 302, headers: {location: 'https://release-assets.githubusercontent.com/demo.zip?signature=example'}});
    return new Response(files[0].body);
  }});
  const body = await target.download({url: 'https://api.github.com/repos/example/kiki-terminal-lab/releases/assets/1', size: files[0].body.length});
  assert.equal(sha256(body), files[0].sha256);
  assert.equal(requests[0].headers.Authorization, 'Bearer test-token');
  assert.equal(requests[1].headers.Authorization, undefined);
});

test('an interrupted GitHub draft is found even when the by-tag endpoint returns 404', async () => {
  const target = new ReleaseTarget({kind: 'github', remote: 'origin', location, token: 'test-token', fetchImpl: async url => {
    if (url.includes('/releases/tags/')) return new Response('{}', {status: 404});
    if (url.includes('/releases/7/assets')) return Response.json([]);
    return Response.json([{id: 7, tag_name: 'v1.0.0', draft: true}]);
  }});
  const release = await target.release('v1.0.0');
  assert.equal(release.id, 7);
  assert.equal(release.draft, true);
});

test('unexpected asset hosts and tampered bytes fail closed', async () => {
  const target = new ReleaseTarget({kind: 'github', remote: 'origin', location, token: 'test-token',
    fetchImpl: async () => new Response(null, {status: 302, headers: {location: 'https://unexpected.example/file'}})});
  await assert.rejects(target.download({url: 'https://api.github.com/repos/example/kiki-terminal-lab/releases/assets/1', size: 1}), /redirect origin/);
  await assert.rejects(target.download({url: 'https://unexpected.example/steal', size: 1}), /API URL/);
  const broken = new ReleaseTarget({kind: 'github', remote: 'origin', location, token: 'test-token',
    fetchImpl: async () => new Response('changed')});
  await assert.rejects(broken.download({url: 'https://api.github.com/repos/example/kiki-terminal-lab/releases/assets/1', size: 1}), /size/);
});

test('anonymous checks reject an asset that has become public', async () => {
  const target = new ReleaseTarget({kind: 'github', remote: 'origin', location, token: 'test-token', fetchImpl: async (url, options) => {
    assert.equal(options.headers, undefined);
    return new Response('public', {status: url.includes('/download/') ? 200 : 404});
  }});
  await assert.rejects(target.checkAnonymous({assets: [{browser_download_url: `${location.webUrl}/releases/download/v1/a.zip`}]}), /without authentication/);
});

test('CLI rejects force-like flags, incomplete arguments and reused remote names', () => {
  assert.equal(parseArguments([]).githubRemote, 'origin');
  assert.equal(parseArguments(['--verify-only']).verifyOnly, true);
  for (const args of [['--force'], ['--python'], ['--tag', 'refs/heads/main'], ['--github-remote', 'internal'], ['--dry-run', '--verify-only']]) {
    assert.throws(() => parseArguments(args));
  }
});
