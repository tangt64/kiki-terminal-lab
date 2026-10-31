const JENKINS_TIMEOUT_MS = Math.max(1000, Number(process.env.JENKINS_TIMEOUT_MS || 15000) || 15000);
const JENKINS_QUEUE_POLL_ATTEMPTS = Math.max(0, Math.min(10, Number(process.env.JENKINS_QUEUE_POLL_ATTEMPTS || 5) || 5));
const JENKINS_QUEUE_POLL_INTERVAL_MS = Math.max(100, Math.min(5000, Number(process.env.JENKINS_QUEUE_POLL_INTERVAL_MS || 600) || 600));

function trimText(value) {
  return String(value || "").trim();
}

function ensureTrailingSlash(value) {
  const text = trimText(value);
  return text.endsWith("/") ? text : `${text}/`;
}

function xmlEscape(value) {
  return trimText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value) {
  return String(value || "").replace(/\]\]>/g, "]]]]><![CDATA[>");
}

function normalizeJenkinsFolder(value) {
  return trimText(value)
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
}

function encodeJenkinsJobPath(segments = []) {
  return segments.map((segment) => `/job/${encodeURIComponent(segment)}`).join("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUrl(baseUrl, pathname = "", searchParams = null) {
  const url = new URL(String(pathname || "").replace(/^\/+/, ""), ensureTrailingSlash(baseUrl));
  if (searchParams) {
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
  }
  return url;
}

function resolveJenkinsSettings(settings = {}) {
  const baseUrl = trimText(settings.jenkinsBaseUrl || settings.baseUrl || process.env.JENKINS_BASE_URL);
  const username = trimText(settings.jenkinsUsername || settings.username || process.env.JENKINS_USERNAME);
  const apiToken = trimText(settings.jenkinsApiToken || settings.apiToken || process.env.JENKINS_API_TOKEN);
  const defaultFolder = trimText(settings.jenkinsDefaultFolder || settings.defaultFolder || process.env.JENKINS_DEFAULT_FOLDER || "terminal-lab");
  const jobPrefix = trimText(settings.jenkinsJobPrefix || settings.jobPrefix || process.env.JENKINS_JOB_PREFIX || "tlab-");
  const autoCreateJobs = Object.prototype.hasOwnProperty.call(settings, "jenkinsAutoCreateJobs")
    ? settings.jenkinsAutoCreateJobs !== false
    : settings.autoCreateJobs !== false;
  return {
    baseUrl,
    username,
    apiToken,
    defaultFolder,
    jobPrefix,
    autoCreateJobs,
    timeoutMs: Math.max(1000, Number(settings.jenkinsTimeoutMs || settings.timeoutMs || JENKINS_TIMEOUT_MS) || JENKINS_TIMEOUT_MS),
  };
}

export function isJenkinsConfigured(settings = {}) {
  const resolved = resolveJenkinsSettings(settings);
  return Boolean(resolved.baseUrl && resolved.username && resolved.apiToken);
}

function buildAuthHeader(settings) {
  const resolved = resolveJenkinsSettings(settings);
  return `Basic ${Buffer.from(`${resolved.username}:${resolved.apiToken}`).toString("base64")}`;
}

async function readResponseBody(response) {
  const text = await response.text().catch(() => "");
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

async function jenkinsFetch(settings, pathname, options = {}) {
  const resolved = resolveJenkinsSettings(settings);
  if (!resolved.baseUrl) throw new Error("Jenkins URL이 설정되어 있지 않습니다.");
  if (!resolved.username || !resolved.apiToken) throw new Error("Jenkins 사용자명과 API Token이 필요합니다.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.timeoutMs);
  try {
    const response = await fetch(buildUrl(resolved.baseUrl, pathname, options.searchParams), {
      method: options.method || "GET",
      headers: {
        Authorization: buildAuthHeader(resolved),
        ...(options.headers || {}),
      },
      body: options.body,
      signal: controller.signal,
      redirect: "manual",
    });
    const body = options.skipBody ? null : await readResponseBody(response);
    if (response.status >= 400) {
      const detail = typeof body === "string" ? body.slice(0, 300) : body?.message || "";
      const error = new Error(`Jenkins API 오류(${response.status})${detail ? `: ${detail}` : ""}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return { response, body };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Jenkins API 응답 시간이 ${resolved.timeoutMs}ms를 초과했습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getJenkinsCrumb(settings) {
  try {
    const { body } = await jenkinsFetch(settings, "/crumbIssuer/api/json");
    const field = trimText(body?.crumbRequestField);
    const crumb = trimText(body?.crumb);
    return field && crumb ? { field, crumb } : null;
  } catch (error) {
    if (error.status === 404) return null;
    return null;
  }
}

async function jenkinsPost(settings, pathname, options = {}) {
  const crumb = await getJenkinsCrumb(settings);
  const headers = { ...(options.headers || {}) };
  if (crumb) headers[crumb.field] = crumb.crumb;
  return jenkinsFetch(settings, pathname, {
    ...options,
    method: "POST",
    headers,
  });
}

function getProjectJobName(settings, project = {}) {
  const resolved = resolveJenkinsSettings(settings);
  const raw = trimText(project.slug || project.name || project.id || "pipeline")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${resolved.jobPrefix || ""}${raw || "pipeline"}`;
}

function getProjectJobSegments(settings, project = {}) {
  const resolved = resolveJenkinsSettings(settings);
  return [...normalizeJenkinsFolder(resolved.defaultFolder), getProjectJobName(settings, project)];
}

function getNamedJobSegments(settings, project = {}, jobFullName = "") {
  const explicit = normalizeJenkinsFolder(jobFullName);
  return explicit.length ? explicit : getProjectJobSegments(settings, project);
}

export function getJenkinsProjectJobName(settings, project = {}) {
  return getProjectJobSegments(settings, project).join("/");
}

function normalizeJenkinsfilePath(value) {
  const normalized = trimText(value || "Jenkinsfile")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  return normalized || "Jenkinsfile";
}

function groovySingleQuote(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildPipelineScript(project = {}) {
  const repositoryUrl = trimText(project.repositoryUrl);
  const branch = trimText(project.branch || "main") || "main";
  const jenkinsfilePath = normalizeJenkinsfilePath(project.jenkinsfilePath);
  return `
pipeline {
  agent any
  options {
    timestamps()
    disableConcurrentBuilds()
  }
  parameters {
    string(name: 'GIT_URL', defaultValue: '${groovySingleQuote(repositoryUrl)}', description: 'Git repository URL')
    string(name: 'SOURCE_BRANCH', defaultValue: '${groovySingleQuote(branch)}', description: 'Branch or ref to build')
    string(name: 'JENKINSFILE_PATH', defaultValue: '${groovySingleQuote(jenkinsfilePath)}', description: 'Jenkinsfile path in the repository')
    string(name: 'COMMIT_REF', defaultValue: '', description: 'Optional commit/ref label')
    string(name: 'COMMIT_SHA', defaultValue: '', description: 'Optional commit SHA')
  }
  stages {
    stage('Source') {
      steps {
        script {
          if (params.GIT_URL?.trim()) {
            git branch: params.SOURCE_BRANCH, url: params.GIT_URL
          } else {
            echo 'No Git repository URL configured. Skipping checkout.'
          }
        }
      }
    }
    stage('Build') {
      steps {
        sh '''
          set -eu
          echo "Terminal Lab CI/CD build started"
          if [ -f package.json ]; then npm ci || npm install; npm run build --if-present; fi
          if [ -f pom.xml ]; then mvn -B -DskipTests package; fi
          if [ -f Makefile ]; then make; fi
        '''
      }
    }
    stage('Test') {
      steps {
        sh '''
          set -eu
          if [ -f package.json ]; then npm test --if-present; fi
          if [ -f pom.xml ]; then mvn -B test; fi
          if [ -f pytest.ini ] || [ -d tests ]; then python3 -m pytest; fi
        '''
      }
    }
    stage('Package') {
      steps {
        sh '''
          set -eu
          mkdir -p artifacts
          tar --exclude=.git --exclude=artifacts -czf artifacts/source.tgz . || true
        '''
        archiveArtifacts artifacts: 'artifacts/**', allowEmptyArchive: true
      }
    }
    stage('Deploy VM') {
      steps {
        sh '''
          set -eu
          if [ -x ./deploy.sh ]; then ./deploy.sh; else echo 'deploy.sh가 있으면 Stage VM 배포 예제로 실행됩니다.'; fi
        '''
      }
    }
    stage('Deploy K8s') {
      steps {
        sh '''
          set -eu
          if [ -f k8s/deployment.yaml ]; then kubectl apply -f k8s/deployment.yaml; else echo 'k8s/deployment.yaml이 있으면 Kubernetes 배포 예제로 적용됩니다.'; fi
        '''
      }
    }
  }
}
`.trim();
}

function buildStringParameterXml(name, defaultValue, description) {
  return `<hudson.model.StringParameterDefinition>
      <name>${xmlEscape(name)}</name>
      <description>${xmlEscape(description)}</description>
      <defaultValue>${xmlEscape(defaultValue)}</defaultValue>
      <trim>true</trim>
    </hudson.model.StringParameterDefinition>`;
}

function buildPipelineParametersXml(project = {}) {
  return `<hudson.model.ParametersDefinitionProperty>
    <parameterDefinitions>
      ${buildStringParameterXml("GIT_URL", trimText(project.repositoryUrl), "Git repository URL")}
      ${buildStringParameterXml("SOURCE_BRANCH", trimText(project.branch || "main") || "main", "Branch or ref to build")}
      ${buildStringParameterXml("JENKINSFILE_PATH", normalizeJenkinsfilePath(project.jenkinsfilePath), "Jenkinsfile path in the repository")}
      ${buildStringParameterXml("COMMIT_REF", "", "Optional commit/ref label")}
      ${buildStringParameterXml("COMMIT_SHA", "", "Optional commit SHA")}
    </parameterDefinitions>
  </hudson.model.ParametersDefinitionProperty>`;
}

function buildPipelineDefinitionXml(project = {}) {
  const repositoryUrl = trimText(project.repositoryUrl);
  const branch = trimText(project.branch || "main") || "main";
  const jenkinsfilePath = normalizeJenkinsfilePath(project.jenkinsfilePath);
  if (repositoryUrl) {
    return `<definition class="org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition" plugin="workflow-cps">
    <scm class="hudson.plugins.git.GitSCM" plugin="git">
      <configVersion>2</configVersion>
      <userRemoteConfigs>
        <hudson.plugins.git.UserRemoteConfig>
          <url>${xmlEscape(repositoryUrl)}</url>
        </hudson.plugins.git.UserRemoteConfig>
      </userRemoteConfigs>
      <branches>
        <hudson.plugins.git.BranchSpec>
          <name>${xmlEscape(branch.startsWith("*/") ? branch : `*/${branch}`)}</name>
        </hudson.plugins.git.BranchSpec>
      </branches>
      <doGenerateSubmoduleConfigurations>false</doGenerateSubmoduleConfigurations>
      <submoduleCfg class="empty-list"/>
      <extensions/>
    </scm>
    <scriptPath>${xmlEscape(jenkinsfilePath)}</scriptPath>
    <lightweight>true</lightweight>
  </definition>`;
  }
  return `<definition class="org.jenkinsci.plugins.workflow.cps.CpsFlowDefinition" plugin="workflow-cps">
    <script><![CDATA[${cdata(buildPipelineScript(project))}]]></script>
    <sandbox>true</sandbox>
  </definition>`;
}

function buildPipelineConfigXml(project = {}) {
  const description = [
    "Managed by Terminal Lab CI/CD.",
    trimText(project.description),
    trimText(project.repositoryUrl) ? `Repository: ${trimText(project.repositoryUrl)}` : "",
    `Jenkinsfile: ${normalizeJenkinsfilePath(project.jenkinsfilePath)}`,
  ].filter(Boolean).join("\n");
  return `<?xml version='1.1' encoding='UTF-8'?>
<flow-definition plugin="workflow-job">
  <actions/>
  <description>${xmlEscape(description)}</description>
  <keepDependencies>false</keepDependencies>
  <properties>
    ${buildPipelineParametersXml(project)}
  </properties>
  ${buildPipelineDefinitionXml(project)}
  <triggers/>
  <disabled>false</disabled>
</flow-definition>`;
}

function buildJenkinsCredentialXml(input = {}) {
  const id = trimText(input.id);
  const description = trimText(input.description);
  const type = trimText(input.type).toLowerCase();
  if (type === "ssh_private_key") {
    return `<com.cloudbees.jenkins.plugins.sshcredentials.impl.BasicSSHUserPrivateKey>
  <scope>GLOBAL</scope>
  <id>${xmlEscape(id)}</id>
  <description>${xmlEscape(description)}</description>
  <username>${xmlEscape(input.username)}</username>
  <usernameSecret>false</usernameSecret>
  <privateKeySource class="com.cloudbees.jenkins.plugins.sshcredentials.impl.BasicSSHUserPrivateKey_-DirectEntryPrivateKeySource">
    <privateKey>${xmlEscape(input.secret)}</privateKey>
  </privateKeySource>
  <passphrase>${xmlEscape(input.passphrase)}</passphrase>
</com.cloudbees.jenkins.plugins.sshcredentials.impl.BasicSSHUserPrivateKey>`;
  }
  if (type === "username_password") {
    return `<com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl>
  <scope>GLOBAL</scope>
  <id>${xmlEscape(id)}</id>
  <description>${xmlEscape(description)}</description>
  <username>${xmlEscape(input.username)}</username>
  <password>${xmlEscape(input.secret)}</password>
  <usernameSecret>false</usernameSecret>
</com.cloudbees.plugins.credentials.impl.UsernamePasswordCredentialsImpl>`;
  }
  if (type === "secret_text") {
    return `<org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl>
  <scope>GLOBAL</scope>
  <id>${xmlEscape(id)}</id>
  <description>${xmlEscape(description)}</description>
  <secret>${xmlEscape(input.secret)}</secret>
</org.jenkinsci.plugins.plaincredentials.impl.StringCredentialsImpl>`;
  }
  throw new Error("지원하지 않는 Jenkins Credential 종류입니다.");
}

async function getJenkinsJson(settings, path) {
  const { body } = await jenkinsFetch(settings, `${path}/api/json`);
  return body && typeof body === "object" ? body : {};
}

async function resolveJenkinsQueueBuild(settings, queueId = "") {
  const normalizedQueueId = trimText(queueId);
  if (!normalizedQueueId || !JENKINS_QUEUE_POLL_ATTEMPTS) return {};
  for (let attempt = 0; attempt < JENKINS_QUEUE_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(JENKINS_QUEUE_POLL_INTERVAL_MS);
    try {
      const item = await getJenkinsJson(settings, `/queue/item/${encodeURIComponent(normalizedQueueId)}`);
      const executable = item?.executable && typeof item.executable === "object" ? item.executable : null;
      if (executable?.number != null || executable?.url) {
        return {
          buildNumber: trimText(executable.number),
          buildUrl: trimText(executable.url),
          queueReason: trimText(item.why),
          queueCancelled: Boolean(item.cancelled),
        };
      }
      if (item?.cancelled) {
        return {
          queueReason: trimText(item.why) || "Jenkins 대기 작업이 취소되었습니다.",
          queueCancelled: true,
        };
      }
    } catch (error) {
      return {
        queueReason: error.message || "Jenkins queue lookup failed.",
      };
    }
  }
  return {};
}

export async function getJenkinsPipelineBuildStatus(settings = {}, project = {}, reference = {}) {
  const resolved = resolveJenkinsSettings(settings);
  const segments = getNamedJobSegments(resolved, project, reference.jobFullName);
  const queueId = trimText(reference.queueId);
  let buildNumber = trimText(reference.buildNumber);
  let buildUrl = trimText(reference.buildUrl);
  let queueReason = "";
  if (!buildNumber && queueId) {
    const queuedBuild = await resolveJenkinsQueueBuild(resolved, queueId);
    if (queuedBuild.queueCancelled) return { status: "cancelled", building: false, queueId, queueReason: queuedBuild.queueReason || "Jenkins 대기 작업이 취소되었습니다.", jobFullName: segments.join("/"), buildNumber: "", buildUrl: queuedBuild.buildUrl || buildUrl };
    buildNumber = trimText(queuedBuild.buildNumber);
    buildUrl = trimText(queuedBuild.buildUrl) || buildUrl;
    queueReason = trimText(queuedBuild.queueReason);
  }
  if (!buildNumber) return { status: "queued", building: false, queueId, queueReason, jobFullName: segments.join("/"), buildNumber: "", buildUrl };
  const jobPath = encodeJenkinsJobPath(segments);
  const build = await getJenkinsJson(resolved, jobPath + "/" + encodeURIComponent(buildNumber));
  const result = trimText(build?.result).toUpperCase();
  const building = Boolean(build?.building) || !result;
  const status = building ? "running" : result === "SUCCESS" ? "success" : result === "ABORTED" || result === "NOT_BUILT" ? "cancelled" : "failed";
  return { status, building, result, queueId, queueReason, jobFullName: segments.join("/"), buildNumber: trimText(build?.number) || buildNumber, buildUrl: trimText(build?.url) || buildUrl, displayName: trimText(build?.fullDisplayName || build?.displayName), timestamp: Number(build?.timestamp || 0) || 0, duration: Number(build?.duration || 0) || 0 };
}

async function pathExists(settings, path) {
  try {
    await getJenkinsJson(settings, path);
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

async function ensureJenkinsFolder(settings) {
  const resolved = resolveJenkinsSettings(settings);
  const folders = normalizeJenkinsFolder(resolved.defaultFolder);
  let currentPath = "";
  for (const folder of folders) {
    const folderPath = `${currentPath}/job/${encodeURIComponent(folder)}`;
    if (!(await pathExists(settings, folderPath))) {
      await jenkinsPost(settings, `${currentPath || ""}/createItem`, {
        searchParams: {
          name: folder,
          mode: "com.cloudbees.hudson.plugins.folder.Folder",
          from: "",
          json: JSON.stringify({ name: folder, mode: "com.cloudbees.hudson.plugins.folder.Folder", from: "" }),
        },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        skipBody: true,
      });
    }
    currentPath = folderPath;
  }
}

export async function testJenkinsConnection(settings = {}) {
  const resolved = resolveJenkinsSettings(settings);
  const { body, response } = await jenkinsFetch(resolved, "/api/json");
  return {
    ok: true,
    baseUrl: resolved.baseUrl,
    user: resolved.username,
    nodeDescription: trimText(body?.nodeDescription),
    mode: trimText(body?.mode),
    version: trimText(body?.version || response.headers.get("x-jenkins")),
  };
}

export async function createJenkinsCredential(settings = {}, input = {}) {
  const id = trimText(input.id);
  if (!id) throw new Error("Jenkins Credential ID가 필요합니다.");
  await jenkinsPost(settings, "/credentials/store/system/domain/_/createCredentials", {
    headers: { "Content-Type": "application/xml" },
    body: buildJenkinsCredentialXml(input),
    skipBody: true,
  });
  return { id, type: trimText(input.type), created: true };
}

export async function deleteJenkinsCredential(settings = {}, credentialId = "") {
  const id = trimText(credentialId);
  if (!id) throw new Error("Jenkins Credential ID가 필요합니다.");
  await jenkinsPost(settings, `/credentials/store/system/domain/_/credential/${encodeURIComponent(id)}/doDelete`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    skipBody: true,
  });
  return { id, deleted: true };
}

export async function ensureJenkinsPipelineJob(settings = {}, project = {}) {
  const resolved = resolveJenkinsSettings(settings);
  const segments = getProjectJobSegments(resolved, project);
  const jobName = segments.at(-1);
  const folderSegments = segments.slice(0, -1);
  const folderPath = encodeJenkinsJobPath(folderSegments);
  const jobPath = encodeJenkinsJobPath(segments);
  if (resolved.autoCreateJobs) {
    await ensureJenkinsFolder(resolved);
  }
  if (await pathExists(resolved, jobPath)) {
    if (resolved.autoCreateJobs) {
      await jenkinsPost(resolved, `${jobPath}/config.xml`, {
        headers: { "Content-Type": "application/xml" },
        body: buildPipelineConfigXml(project),
        skipBody: true,
      });
    }
    const info = await getJenkinsJson(resolved, jobPath);
    return { created: false, updated: Boolean(resolved.autoCreateJobs), jobName, fullName: trimText(info.fullName) || segments.join("/"), url: trimText(info.url), path: jobPath };
  }
  if (!resolved.autoCreateJobs) {
    throw new Error(`Jenkins Job이 없습니다: ${segments.join("/")}`);
  }
  await jenkinsPost(resolved, `${folderPath}/createItem`, {
    searchParams: { name: jobName },
    headers: { "Content-Type": "application/xml" },
    body: buildPipelineConfigXml(project),
    skipBody: true,
  });
  const info = await getJenkinsJson(resolved, jobPath);
  return { created: true, jobName, fullName: trimText(info.fullName) || segments.join("/"), url: trimText(info.url), path: jobPath };
}

export async function triggerJenkinsPipelineBuild(settings = {}, project = {}, runInput = {}) {
  const resolved = resolveJenkinsSettings(settings);
  const segments = getProjectJobSegments(resolved, project);
  const jobPath = encodeJenkinsJobPath(segments);
  const params = new URLSearchParams({
    GIT_URL: trimText(project.repositoryUrl),
    SOURCE_BRANCH: trimText(runInput.sourceBranch || project.branch || "main") || "main",
    JENKINSFILE_PATH: normalizeJenkinsfilePath(project.jenkinsfilePath),
    COMMIT_REF: trimText(runInput.commitRef),
    COMMIT_SHA: trimText(runInput.commitSha),
  });
  const { response } = await jenkinsPost(resolved, `${jobPath}/buildWithParameters`, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    skipBody: true,
  });
  const queueUrl = trimText(response.headers.get("location"));
  const queueIdMatch = queueUrl.match(/\/queue\/item\/(\d+)\/?$/);
  const queueId = queueIdMatch ? queueIdMatch[1] : "";
  const queuedBuild = await resolveJenkinsQueueBuild(resolved, queueId);
  return {
    ok: true,
    jobFullName: segments.join("/"),
    queueUrl,
    queueId,
    buildNumber: queuedBuild.buildNumber || "",
    buildUrl: queuedBuild.buildUrl || "",
    queueReason: queuedBuild.queueReason || "",
    queueCancelled: Boolean(queuedBuild.queueCancelled),
  };
}
