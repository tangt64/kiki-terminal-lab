import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {ReleaseTarget, parseRemote, parseChecksum, publishBoth, sha256} from './release-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE_ENV = {...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never',
  GIT_TRACE: '0', GIT_TRACE_CURL: '0', GIT_CURL_VERBOSE: '0'};

function run(command, args, {input, env = REMOTE_ENV, label = 'Command', check = true} = {}) {
  const result = spawnSync(command, args, {cwd: ROOT, input, env, encoding: 'utf8', windowsHide: true,
    maxBuffer: 32 * 1024 * 1024});
  if (check && (result.error || result.status !== 0)) throw new Error(`${label} failed${result.status === null ? '' : ` (exit ${result.status})`}.`);
  return result;
}

function git(args, {target, input, check = true} = {}) {
  let env = REMOTE_ENV;
  if (target) {
    env = {...REMOTE_ENV};
    const index = Number(env.GIT_CONFIG_COUNT || 0);
    env.GIT_CONFIG_COUNT = String(index + 1);
    env[`GIT_CONFIG_KEY_${index}`] = `http.${target.location.gitUrl}.extraHeader`;
    env[`GIT_CONFIG_VALUE_${index}`] = 'Authorization: Basic ' +
      Buffer.from(`${target.credential.username}:${target.credential.password}`).toString('base64');
    args = ['-c', 'credential.helper=', ...args];
  }
  return run('git', args, {env, input, check, label: `Git ${args.includes('push') ? 'push' : 'operation'}`});
}

function textGit(args, options) { return git(args, options).stdout.trim(); }

function giteaCredentialConfig(location) {
  const prefix = `credential.${location.origin}.`;
  return ['provider=generic', 'oauthClientId=e90ee53c-94e2-48ac-9358-a874fb9e0662',
    'oauthAuthorizeEndpoint=/login/oauth/authorize', 'oauthTokenEndpoint=/login/oauth/access_token',
    'oauthUseClientAuthHeader=false', 'oauthDefaultUserName=OAUTH_USER'].flatMap(value => ['-c', prefix + value]);
}

function credential(kind, location) {
  const provided = process.env[kind === 'github' ? 'RELEASE_GITHUB_TOKEN' : 'RELEASE_GITEA_TOKEN'];
  const username = process.env[kind === 'github' ? 'RELEASE_GITHUB_USERNAME' : 'RELEASE_GITEA_USERNAME'] ||
    (kind === 'github' ? location.owner : 'OAUTH_USER');
  if (provided) return {username, password: provided, fromHelper: false};
  const input = `protocol=https\nhost=${new URL(location.origin).host}\n${kind === 'github' ? `username=${username}\n` : ''}\n`;
  const result = git([...(kind === 'gitea' ? giteaCredentialConfig(location) : []), 'credential', 'fill'], {input, check: false});
  if (result.status !== 0) throw new Error(`${kind}: no saved Git credential. Sign in through Git Credential Manager or set the release token environment variable.`);
  const values = Object.fromEntries(result.stdout.trim().split(/\r?\n/).map(line => {
    const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
  }));
  if (!values.username || !values.password) throw new Error(`${kind}: Git returned an incomplete credential.`);
  return {...values, fromHelper: true};
}

function saveRefreshedCredential(target) {
  if (!target.credential.fromHelper) return;
  const c = target.credential;
  // Refresh the existing OS credential store only; no token is written to the project.
  git([...(target.kind === 'gitea' ? giteaCredentialConfig(target.location) : []), 'credential', 'approve'], {
    input: `protocol=https\nhost=${new URL(target.location.origin).host}\nusername=${c.username}\npassword=${c.password}\n\n`});
}

export function parseArguments(args) {
  const result = {githubRemote: 'origin', giteaRemote: 'internal', branch: 'main', prerelease: true};
  const values = {'--github-remote': 'githubRemote', '--gitea-remote': 'giteaRemote', '--branch': 'branch',
    '--tag': 'tag', '--python': 'python', '--notes-file': 'notesFile'};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (values[flag]) {
      if (!args[index + 1] || args[index + 1].startsWith('-')) throw new Error(`Missing value for ${flag}.`);
      result[values[flag]] = args[++index];
    } else if (flag === '--stable') result.prerelease = false;
    else if (flag === '--verify-only') result.verifyOnly = true;
    else if (flag === '--dry-run') result.dryRun = true;
    else if (flag === '--help') result.help = true;
    else throw new Error(`Unknown option: ${flag}.`);
  }
  for (const key of ['githubRemote', 'giteaRemote']) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(result[key])) throw new Error('Invalid remote name.');
  }
  if (result.githubRemote === result.giteaRemote) throw new Error('Use two different remotes.');
  if (result.verifyOnly && result.dryRun) throw new Error('Choose --verify-only or --dry-run.');
  if (result.tag && !/^v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(result.tag)) throw new Error('Use a version tag such as v0.3.2.');
  return result;
}

function pythonCommand(preferred) {
  const candidates = preferred || process.env.RELEASE_PYTHON
    ? [[preferred || process.env.RELEASE_PYTHON]]
    : process.platform === 'win32' ? [['python'], ['py', '-3'], ['python3']] : [['python3'], ['python']];
  for (const candidate of candidates) {
    const tested = run(candidate[0], [...candidate.slice(1), '-c', 'import sys;sys.exit(0 if sys.version_info >= (3,9) else 1)'], {check: false});
    if (tested.status === 0) return candidate;
  }
  throw new Error('Python 3.9+ is required. Set RELEASE_PYTHON to its executable path.');
}

function python(python, args) { return run(python[0], [...python.slice(1), ...args], {label: 'Source package verification'}).stdout; }

function localRefs(target, branch, tag) {
  const output = textGit(['ls-remote', '--refs', target.location.gitUrl, `refs/heads/${branch}`, `refs/tags/${tag}`], {target});
  return new Map(output.split(/\r?\n/).filter(Boolean).map(line => {
    const [oid, name] = line.split(/\s+/); return [name, oid];
  }));
}

function build() {
  const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!fs.existsSync(npm)) throw new Error('Run the deployment through npm run release:publish.');
  const env = {...REMOTE_ENV};
  for (const name of ['RELEASE_GITHUB_TOKEN', 'RELEASE_GITEA_TOKEN']) delete env[name];
  run(process.execPath, ['scripts/check.mjs'], {env, label: 'JavaScript syntax check'});
  run(process.execPath, [npm, 'run', 'build'], {env, label: 'Application build'});
}

function notesFor(version, commit, options) {
  if (options.notesFile) return fs.readFileSync(path.resolve(options.notesFile), 'utf8');
  const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const section = changelog.match(new RegExp(`^## ${escaped}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))?.[1]?.trim() || '';
  return `${section}\n\nSource commit: \`${commit}\`.\n\nInstall with the attached source ZIP or clone the matching tag. Verify the ZIP using its SHA-256 file.`.trim();
}

async function artifactFiles({releasePackage, commit, targets, python: interpreter, verifyOnly}) {
  const filename = `${releasePackage.name}-${releasePackage.version}.zip`;
  const names = [filename, filename + '.sha256'];
  const folder = path.join(ROOT, 'releases');
  const bodies = new Map();
  for (const name of names) {
    const file = path.join(folder, name);
    if (fs.existsSync(file)) bodies.set(name, fs.readFileSync(file));
  }
  // A retry or a fresh checkout reuses published bytes instead of repacking a version.
  for (const target of targets) {
    const release = await target.release(`v${releasePackage.version}`);
    if (!release) continue;
    for (const name of names) {
      const matches = release.assets.filter(asset => asset.name === name);
      if (matches.length > 1) throw new Error('Duplicate release asset names.');
      if (!matches.length) continue;
      const body = await target.download(matches[0]);
      if (bodies.has(name) && sha256(bodies.get(name)) !== sha256(body)) {
        throw new Error(`${target.remote}: the existing version differs from local or other-server assets. Use a new version.`);
      }
      bodies.set(name, body);
    }
  }
  if (!bodies.has(filename)) {
    if (verifyOnly) throw new Error('The ZIP is missing locally and on both servers.');
    python(interpreter, ['installer/package.py', '--ref', commit]);
    for (const name of names) bodies.set(name, fs.readFileSync(path.join(folder, name)));
  }
  const digest = sha256(bodies.get(filename));
  if (!bodies.has(names[1])) {
    if (verifyOnly) throw new Error('The checksum is missing locally and on both servers.');
    bodies.set(names[1], Buffer.from(`${digest}  ${filename}\n`));
  }
  if (parseChecksum(bodies.get(names[1]), filename) !== digest) throw new Error('ZIP checksum mismatch.');
  fs.mkdirSync(folder, {recursive: true});
  for (const name of names) {
    const file = path.join(folder, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bodies.get(name), {flag: 'wx'});
  }
  const verification = JSON.parse(python(interpreter, ['installer/package.py', '--verify-archive', path.join(folder, filename), '--ref', commit]));
  if (verification.sha256 !== digest) throw new Error('The verified package digest changed.');
  return names.map(name => ({name, body: bodies.get(name), sha256: sha256(bodies.get(name))}));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(`Usage: npm run release:publish -- [--dry-run | --verify-only] [--tag vX.Y.Z] [--stable]
  --github-remote NAME  GitHub remote (default: origin)
  --gitea-remote NAME   Gitea remote (default: internal)
  --branch NAME        Clean checked-out branch (default: main)
  --python PATH        Python 3.9+ executable
  --notes-file PATH    Optional UTF-8 release notes
Credentials: existing Git Credential Manager, or RELEASE_GITHUB_TOKEN / RELEASE_GITEA_TOKEN.
Published versions are never overwritten. GitHub may be public; Gitea must remain private.`);
    return;
  }
  if (path.resolve(textGit(['rev-parse', '--show-toplevel'])) !== ROOT) throw new Error('Expected the independent repository root.');
  git(['check-ref-format', '--branch', options.branch]);
  if (textGit(['branch', '--show-current']) !== options.branch) throw new Error(`Check out ${options.branch} before deployment.`);
  if (!options.verifyOnly && textGit(['status', '--porcelain'])) throw new Error('Commit or remove source changes before deployment.');
  const head = textGit(['rev-parse', 'HEAD']);
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(current.version)) throw new Error('Use a semantic package version.');
  const tag = options.tag || `v${current.version}`;
  git(['check-ref-format', `refs/tags/${tag}`]);
  const tagExists = git(['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], {check: false}).status === 0;
  const commit = tagExists ? textGit(['rev-parse', `${tag}^{commit}`]) : head;
  if (options.verifyOnly && !tagExists) throw new Error('The selected local tag does not exist.');
  if (!options.verifyOnly && (tag !== `v${current.version}` || commit !== head)) {
    throw new Error('This version tag already identifies a different commit. Prepare and commit a new package version.');
  }
  const releasePackage = JSON.parse(textGit(['show', `${commit}:package.json`]));
  if (releasePackage.private !== true || !/^[a-z0-9][a-z0-9.-]*$/.test(releasePackage.name) ||
      tag !== `v${releasePackage.version}`) throw new Error('Package identity or version tag does not match.');
  const stateDirectory = path.join(ROOT, 'runtime', 'release-publish');
  const successPath = path.join(stateDirectory, 'last-success.json');
  const previous = fs.existsSync(successPath) ? JSON.parse(fs.readFileSync(successPath, 'utf8')) : null;
  const targets = [];
  for (const [kind, remote] of [['github', options.githubRemote], ['gitea', options.giteaRemote]]) {
    const fetchUrls = textGit(['remote', 'get-url', '--all', remote]).split(/\r?\n/);
    const pushUrls = textGit(['remote', 'get-url', '--push', '--all', remote]).split(/\r?\n/);
    if (fetchUrls.length !== 1 || pushUrls.length !== 1) throw new Error('Each release remote must have one fetch URL and one push URL.');
    const location = parseRemote(fetchUrls[0], kind, releasePackage.name);
    if (parseRemote(pushUrls[0], kind, releasePackage.name).gitUrl !== location.gitUrl ||
        parseRemote(textGit(['ls-remote', '--get-url', location.gitUrl]), kind, releasePackage.name).gitUrl !== location.gitUrl) {
      throw new Error('Fetch, push and rewritten remote identities must agree.');
    }
    const pin = previous?.targets.find(target => target.remote === remote);
    if (pin && pin.repository !== location.webUrl) throw new Error('The remote changed since the last successful deployment.');
    const secret = credential(kind, location);
    const target = new ReleaseTarget({kind, remote, location, token: secret.password, expectedId: pin?.id});
    target.credential = secret;
    await target.inspect();
    if (!options.dryRun) saveRefreshedCredential(target);
    targets.push(target);
  }
  const tagOid = tagExists ? textGit(['rev-parse', `refs/tags/${tag}`]) : head;
  for (const target of targets) {
    const refs = localRefs(target, options.branch, tag);
    const remoteTag = refs.get(`refs/tags/${tag}`);
    if (remoteTag && remoteTag !== tagOid) throw new Error(`${target.remote}: tag collision; use a new version.`);
    const remoteHead = refs.get(`refs/heads/${options.branch}`);
    if (!options.verifyOnly && remoteHead && remoteHead !== head) {
      if (git(['cat-file', '-e', `${remoteHead}^{commit}`], {check: false}).status !== 0) {
        git(['fetch', '--no-tags', target.location.gitUrl, `refs/heads/${options.branch}`], {target});
      }
      if (git(['merge-base', '--is-ancestor', remoteHead, head], {check: false}).status !== 0) {
        throw new Error(`${target.remote}: remote branch diverged. No force push will be attempted.`);
      }
    }
  }
  if (options.dryRun) {
    console.log(JSON.stringify({mode: 'dry-run', tag, commit, branch: options.branch,
      targets: targets.map(target => ({remote: target.remote, repository: target.location.webUrl, id: target.id, private: target.private ?? true})),
      actions: ['build', 'package committed sources', 'push branch and tag', 'upload immutable assets', 'verify remote bytes and per-repository access']}, null, 2));
    return;
  }
  fs.mkdirSync(stateDirectory, {recursive: true});
  const lock = path.join(stateDirectory, 'deployment.lock');
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(descriptor, String(process.pid));
  fs.closeSync(descriptor);
  try {
    const interpreter = pythonCommand(options.python);
    if (!options.verifyOnly) {
      console.log('Checking and building committed sources...');
      build();
      if (textGit(['status', '--porcelain'])) throw new Error('Build changed source files. Commit them before deployment.');
    }
    const files = await artifactFiles({releasePackage, commit, targets, python: interpreter, verifyOnly: options.verifyOnly});
    const verifyRefs = async target => {
      const refs = localRefs(target, options.branch, tag);
      if (refs.get(`refs/heads/${options.branch}`) !== head || refs.get(`refs/tags/${tag}`) !== tagOid) {
        throw new Error(`${target.remote}: branch or tag does not match.`);
      }
    };
    const results = await publishBoth({targets, files, tag, commit, notes: notesFor(releasePackage.version, commit, options),
      prerelease: options.prerelease, verifyOnly: options.verifyOnly,
      createTag: () => { if (!tagExists) git(['tag', tag, head]); },
      push: target => git(['push', '--atomic', target.location.gitUrl,
        `HEAD:refs/heads/${options.branch}`, `refs/tags/${tag}:refs/tags/${tag}`], {target}),
      verifyRefs, log: message => console.log(message)});
    const report = {result: 'PASS', mode: options.verifyOnly ? 'verify-only' : 'publish', product: releasePackage.name,
      version: releasePackage.version, tag, commit, branchCommit: head, branch: options.branch, targets: results};
    fs.writeFileSync(path.join(stateDirectory, 'last-result.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
    fs.writeFileSync(successPath, JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
    console.log(JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    fs.writeFileSync(path.join(stateDirectory, 'last-result.json'), JSON.stringify({result: 'FAIL', tag, commit,
      message: error.message, recovery: 'Fix the cause, then run the same command again. Existing releases are never overwritten.'}, null, 2) + '\n', {mode: 0o600});
    throw error;
  } finally { fs.unlinkSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`Release deployment stopped: ${error.message}`); process.exitCode = 1; });
}
