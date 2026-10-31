import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {sshSourceCidrs} from './ssh-source-policy.js';

const CAPO_DEFAULT_PROFILE_ID = "capo-default";
const CAPO_DEFAULT_NAMESPACE = "terminal-lab-capo";

let capoCloudTarget = {
  cloudsYamlPath: "",
  cloudName: "openstack",
  authUrl: "",
  managementEndpoint: "",
  clusterProfiles: [],
};

export function configureMagnumOpenstackCloud(settings = {}) {
  capoCloudTarget = {
    cloudsYamlPath: String(settings.serviceCloudsYaml || process.env.OPENSTACK_SERVICE_CLOUDS_YAML || process.env.OPENSTACK_CLOUDS_YAML || "").trim(),
    cloudName: String(settings.serviceCloudName || process.env.OPENSTACK_SERVICE_CLOUD_NAME || process.env.OPENSTACK_CLOUD_NAME || "openstack").trim() || "openstack",
    authUrl: String(settings.serviceAuthUrl || "").trim(),
    managementEndpoint: String(settings.magnumApiUrl || process.env.CAPO_MANAGEMENT_ENDPOINT || "").trim(),
    clusterProfiles: Array.isArray(settings.magnumClusterProfiles) ? settings.magnumClusterProfiles : [],
  };
}

function envFlag(name) {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());
}

function parseCapoProfilesFromEnv() {
  const raw = String(process.env.CAPO_CLUSTER_PROFILES_JSON || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeCapoProfile(item = {}, index = 0) {
  const id = String(item.id || item.name || `capo-profile-${index + 1}`).trim();
  const name = String(item.name || item.label || id).trim();
  const masterFlavorId = String(item.controlPlaneFlavor || item.masterFlavorId || item.flavor || process.env.CAPO_DEFAULT_CONTROL_PLANE_FLAVOR || process.env.CAPO_DEFAULT_FLAVOR || "").trim();
  const flavorId = String(item.workerFlavor || item.flavorId || item.flavor || process.env.CAPO_DEFAULT_WORKER_FLAVOR || process.env.CAPO_DEFAULT_FLAVOR || "").trim();
  const normalizeFlavorList = (value, fallback) => [...new Set([
    ...(Array.isArray(value) ? value : String(value || "").split(",")),
    fallback,
  ].map((entry) => String(entry || "").trim()).filter(Boolean))];
  const defaultImageId = String(item.image || item.imageId || item.openstackImage || process.env.CAPO_DEFAULT_IMAGE || "").trim();
  const configuredVersions = item.kubernetesVersions && typeof item.kubernetesVersions === "object"
    ? Object.entries(item.kubernetesVersions).map(([minor, value]) => {
      const entry = typeof value === "string" ? { version: value } : (value || {});
      const version = String(entry.version || entry.kubernetesVersion || minor).trim().replace(/^([^v])/, "v$1");
      return {
        minor: String(entry.minor || minor).trim().replace(/^v/, ""),
        version,
        imageId: String(entry.image || entry.imageId || entry.openstackImage || defaultImageId).trim(),
      };
    }).filter((entry) => entry.minor && entry.version && entry.imageId)
    : [];
  const fallbackVersion = String(item.kubernetesVersion || process.env.CAPO_KUBERNETES_VERSION || "v1.30.0").trim().replace(/^([^v])/, "v$1");
  const kubernetesVersions = configuredVersions.length ? configuredVersions : [{
    minor: fallbackVersion.replace(/^v/, "").split(".").slice(0, 2).join("."),
    version: fallbackVersion,
    imageId: defaultImageId,
  }].filter((entry) => entry.imageId);
  const requestedDefault = String(item.defaultKubernetesVersion || "").trim().replace(/^v/, "");
  const defaultVersion = kubernetesVersions.find((entry) => entry.minor === requestedDefault || entry.version.replace(/^v/, "") === requestedDefault)
    || kubernetesVersions[0];
  const loadBalancer = item.apiServerLoadBalancer && typeof item.apiServerLoadBalancer === "object"
    ? item.apiServerLoadBalancer
    : {};
  const normalizePortList = (value) => [...new Set((Array.isArray(value) ? value : String(value || "").split(","))
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry > 0 && entry <= 65535))];
  const normalizeCidrList = (value) => [...new Set((Array.isArray(value) ? value : String(value || "").split(","))
    .map((entry) => String(entry || "").trim())
    .filter(Boolean))];
  const apiServerLoadBalancerEnabled = loadBalancer.enabled != null
    ? Boolean(loadBalancer.enabled)
    : item.apiServerLoadBalancerEnabled !== false;
  return {
    id: id || `${CAPO_DEFAULT_PROFILE_ID}-${index + 1}`,
    name: name || `CAPO Profile ${index + 1}`,
    coe: "kubernetes",
    imageId: defaultVersion?.imageId || defaultImageId,
    kubernetesVersion: defaultVersion?.version || fallbackVersion,
    defaultKubernetesVersion: defaultVersion?.minor || fallbackVersion.replace(/^v/, "").split(".").slice(0, 2).join("."),
    kubernetesVersions,
    public: item.public != null ? Boolean(item.public) : true,
    networkDriver: String(item.cni || item.networkDriver || process.env.CAPO_DEFAULT_CNI || "calico").trim(),
    serverType: "vm",
    masterFlavorId,
    flavorId,
    allowedControlPlaneFlavors: normalizeFlavorList(item.allowedControlPlaneFlavors || item.controlPlaneFlavors, masterFlavorId),
    allowedWorkerFlavors: normalizeFlavorList(item.allowedWorkerFlavors || item.workerFlavors, flavorId),
    externalNetworkId: String(item.externalNetworkId || item.externalNetwork || process.env.CAPO_EXTERNAL_NETWORK_ID || "").trim(),
    disableAPIServerFloatingIP: item.disableAPIServerFloatingIP != null
      ? Boolean(item.disableAPIServerFloatingIP)
      : envFlag("CAPO_DISABLE_API_SERVER_FLOATING_IP"),
    apiServerLoadBalancer: {
      enabled: apiServerLoadBalancerEnabled,
      minControlPlaneCount: Math.max(1, Math.min(9, Number(loadBalancer.minControlPlaneCount || item.apiServerLoadBalancerMinControlPlaneCount || 3) || 3)),
      provider: String(loadBalancer.provider || item.apiServerLoadBalancerProvider || "").trim(),
      flavor: String(loadBalancer.flavor || item.apiServerLoadBalancerFlavor || "").trim(),
      availabilityZone: String(loadBalancer.availabilityZone || item.apiServerLoadBalancerAvailabilityZone || "").trim(),
      additionalPorts: normalizePortList(loadBalancer.additionalPorts || item.apiServerLoadBalancerAdditionalPorts),
      allowedCIDRs: normalizeCidrList(loadBalancer.allowedCIDRs || item.apiServerLoadBalancerAllowedCIDRs),
      monitor: {
        delay: Math.max(0, Number(loadBalancer.monitor?.delay || 0) || 0),
        timeout: Math.max(0, Number(loadBalancer.monitor?.timeout || 0) || 0),
        maxRetries: Math.max(0, Number(loadBalancer.monitor?.maxRetries || 0) || 0),
        maxRetriesDown: Math.max(0, Number(loadBalancer.monitor?.maxRetriesDown || 0) || 0),
      },
    },
    networkName: String(item.networkName || item.network || process.env.CAPO_NETWORK_NAME || "").trim(),
    sshKeyName: String(item.sshKeyName || item.keyName || process.env.CAPO_SSH_KEY_NAME || "").trim(),
    templatePath: String(item.templatePath || item.clusterTemplatePath || process.env.CAPO_CLUSTER_TEMPLATE_PATH || "").trim(),
    clusterctl: item.clusterctl != null ? Boolean(item.clusterctl) : envFlag("CAPO_CLUSTERCTL_ENABLED"),
    clusterctlFlavor: String(item.clusterctlFlavor || item.flavorName || process.env.CAPO_CLUSTERCTL_FLAVOR || "").trim(),
    description: String(item.description || "Cluster API Provider OpenStack profile").trim(),
  };
}

function getCapoProfiles() {
  const configured = capoCloudTarget.clusterProfiles.length
    ? capoCloudTarget.clusterProfiles
    : parseCapoProfilesFromEnv();
  const profiles = configured.map(normalizeCapoProfile);
  if (profiles.length) return profiles;
  return [
    normalizeCapoProfile({
      id: CAPO_DEFAULT_PROFILE_ID,
      name: "CAPO default profile",
      description: "Default Kubernetes profile reconciled by clusterctl/CAPO on the management cluster.",
    }),
  ];
}

function buildCapoClusterUuid(name) {
  const suffix = randomUUID().slice(0, 8);
  const normalizedName = String(name || "cluster")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 49)
    .replace(/-+$/g, "") || "cluster";
  return `capo-${normalizedName}-${suffix}`;
}

function normalizeReplicaCount(value, fallback, { min, max, label }) {
  const numeric = Number(value ?? fallback);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return numeric;
}

function capoNamespace() {
  return String(process.env.CAPO_NAMESPACE || CAPO_DEFAULT_NAMESPACE).trim() || CAPO_DEFAULT_NAMESPACE;
}

function capoManifestDir() {
  return String(process.env.CAPO_MANIFEST_DIR || path.join(process.cwd(), "runtime", "capo-requests")).trim();
}

function yamlString(value) {
  const text = String(value ?? "");
  if (!text) return "''";
  return JSON.stringify(text);
}

function yamlOptional(indent, key, value) {
  const text = String(value || "").trim();
  return text ? `${" ".repeat(indent)}${key}: ${yamlString(text)}\n` : "";
}

function yamlOpenstackRef(indent, key, value, { id = false } = {}) {
  const text = String(value || "").trim();
  if (!text) return "";
  const spacing = " ".repeat(indent);
  if (id || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(text)) {
    return `${spacing}${key}:\n${spacing}  id: ${yamlString(text)}\n`;
  }
  return `${spacing}${key}:\n${spacing}  filter:\n${spacing}    name: ${yamlString(text)}\n`;
}

function capoCniPostKubeadmCommands(cni) {
  const normalized = String(cni || "").trim().toLowerCase();
  if (normalized !== "calico") {
    throw new Error(`Unsupported built-in CAPO CNI: ${cni || "(empty)"}`);
  }
  const manifestUrl = String(
    process.env.CAPO_CALICO_MANIFEST_URL
      || "https://raw.githubusercontent.com/projectcalico/calico/v3.28.2/manifests/calico.yaml",
  ).trim();
  const command = `kubectl --kubeconfig=/etc/kubernetes/admin.conf apply -f ${manifestUrl}`;
  return `    postKubeadmCommands:
      - ${yamlString(command)}
`;
}

function capoProviderIdPreKubeadmCommands(indent, kubernetesVersion = "") {
  const spacing = " ".repeat(indent);
  const minor = String(kubernetesVersion).replace(/^v/, "").split(".").slice(0, 2).join(".");
  const pauseVersion = minor === "1.30" ? "3.9" : "3.10";
  const containerdCommand = `sed -ri 's#sandbox_image = "[^"]+"#sandbox_image = "registry.k8s.io/pause:${pauseVersion}"#' /etc/containerd/config.toml; systemctl restart containerd`;
  const imageImportCommand = "for archive in /opt/capo/*-images/*.tar; do [ -e \"$archive\" ] || break; ctr -n k8s.io images import \"$archive\"; done";
  const command = "instance_id=$(curl -fsS http://169.254.169.254/openstack/latest/meta_data.json | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"uuid\"])'); printf 'KUBELET_EXTRA_ARGS=--provider-id=openstack:///%s\\n' \"$instance_id\" > /etc/sysconfig/kubelet";
  return `${spacing}preKubeadmCommands:
${spacing}  - ${yamlString(containerdCommand)}
${spacing}  - ${yamlString(imageImportCommand)}
${spacing}  - ${yamlString(command)}
`;
}

function buildCapoTemplateVariables({ clusterUuid, projectName, name, profile, nodeCount, masterCount }) {
  const controlPlaneCount = Math.max(1, Number(masterCount || 1));
  const workerCount = Math.max(0, Number(nodeCount || 1));
  const controlPlaneFlavor = profile.masterFlavorId || profile.flavorId || "";
  const workerFlavor = profile.flavorId || profile.masterFlavorId || "";
  return {
    cni: profile.networkDriver || "calico",
    cloudName: capoCloudTarget.cloudName || "openstack",
    clusterName: clusterUuid,
    clusterUuid,
    controlPlaneCount,
    controlPlaneFlavor,
    controlPlaneMachineFlavor: controlPlaneFlavor,
    controlPlaneRootGb: String(Math.max(20, Number(process.env.CAPO_CONTROL_PLANE_ROOT_GB || 30))),
    externalNetworkId: profile.externalNetworkId || "",
    disableAPIServerFloatingIP: Boolean(profile.disableAPIServerFloatingIP),
    apiServerLoadBalancer: profile.apiServerLoadBalancer || { enabled: true },
    image: profile.imageId || "",
    imageId: profile.imageId || "",
    kubernetesVersion: String(profile.kubernetesVersion || process.env.CAPO_KUBERNETES_VERSION || "v1.30.0").trim(),
    name: String(name || ""),
    namespace: capoNamespace(),
    networkName: profile.networkName || "",
    nodeCount: workerCount,
    openstackProject: String(projectName || ""),
    podCidr: String(process.env.CAPO_POD_CIDR || "192.168.0.0/16"),
    projectName: String(projectName || ""),
    serviceCidr: String(process.env.CAPO_SERVICE_CIDR || "10.96.0.0/12"),
    sshKeyName: profile.sshKeyName || "",
    workerCount,
    workerFlavor,
    workerMachineFlavor: workerFlavor,
    workerRootGb: String(Math.max(20, Number(process.env.CAPO_WORKER_ROOT_GB || 30))),
  };
}

function renderTemplateString(template, variables) {
  return String(template || "").replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key) => {
    const value = variables[key];
    return value == null ? match : String(value);
  });
}

function quoteWindowsShellArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { env: optionEnv, ...spawnOptions } = options;
    const mergedEnv = {
      ...process.env,
      ...(process.env.CAPO_KUBECONFIG || process.env.KUBECONFIG ? { KUBECONFIG: process.env.CAPO_KUBECONFIG || process.env.KUBECONFIG } : {}),
      ...(optionEnv || {}),
    };
    const isWindowsBatch = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const child = isWindowsBatch
      ? spawn(
        [quoteWindowsShellArg(command), ...args.map(quoteWindowsShellArg)].join(" "),
        [],
        { env: mergedEnv, shell: true, ...spawnOptions },
      )
      : spawn(command, args, {
        env: mergedEnv,
        ...spawnOptions,
      });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || `${command} exited with ${code}`).trim()));
      }
    });
  });
}

function resolveClusterctlCommand() {
  return String(process.env.CAPO_CLUSTERCTL || "clusterctl").trim() || "clusterctl";
}

function resolveKubectlCommand(apiUrl) {
  const endpoint = String(apiUrl || capoCloudTarget.managementEndpoint || "").trim();
  if (endpoint.startsWith("kubectl:")) return endpoint.replace(/^kubectl:\/*/i, "") || "kubectl";
  return String(process.env.CAPO_KUBECTL || "kubectl").trim() || "kubectl";
}

function parseJsonArrayEnv(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

async function buildCapoManifestFromTemplate(templatePath, variables) {
  if (!templatePath) return "";
  const resolvedPath = path.isAbsolute(templatePath) ? templatePath : path.resolve(process.cwd(), templatePath);
  const template = await fs.readFile(resolvedPath, "utf8");
  return renderTemplateString(template, variables);
}

async function buildCapoManifestWithClusterctl(profile, variables) {
  const args = [
    "generate",
    "cluster",
    variables.clusterName,
    "--kubernetes-version",
    variables.kubernetesVersion,
    "--control-plane-machine-count",
    String(variables.controlPlaneCount),
    "--worker-machine-count",
    String(variables.workerCount),
  ];
  if (variables.namespace) args.push("--target-namespace", variables.namespace);
  if (profile.clusterctlFlavor) args.push("--flavor", profile.clusterctlFlavor);
  if (profile.templatePath) args.push("--from", path.isAbsolute(profile.templatePath) ? profile.templatePath : path.resolve(process.cwd(), profile.templatePath));
  args.push(...parseJsonArrayEnv("CAPO_CLUSTERCTL_EXTRA_ARGS_JSON"));

  const { stdout } = await runCommand(resolveClusterctlCommand(), args, {
    env: {
      CLUSTER_NAME: variables.clusterName,
      KUBERNETES_VERSION: variables.kubernetesVersion,
      CONTROL_PLANE_MACHINE_COUNT: String(variables.controlPlaneCount),
      WORKER_MACHINE_COUNT: String(variables.workerCount),
      OPENSTACK_CLOUD: variables.cloudName,
      OPENSTACK_CLOUD_YAML_B64: process.env.CAPO_OPENSTACK_CLOUD_YAML_B64 || "",
      OPENSTACK_CONTROL_PLANE_MACHINE_FLAVOR: variables.controlPlaneFlavor,
      OPENSTACK_NODE_MACHINE_FLAVOR: variables.workerFlavor,
      OPENSTACK_IMAGE_NAME: variables.image,
      OPENSTACK_EXTERNAL_NETWORK_ID: variables.externalNetworkId,
      OPENSTACK_NETWORK_NAME: variables.networkName,
      OPENSTACK_SSH_KEY_NAME: variables.sshKeyName,
    },
  });
  return renderTemplateString(stdout, variables);
}

export async function buildCapoManifest({ clusterUuid, projectName, name, profile, nodeCount, masterCount }) {
  const variables = buildCapoTemplateVariables({ clusterUuid, projectName, name, profile, nodeCount, masterCount });
  if (profile.clusterctl) {
    return buildCapoManifestWithClusterctl(profile, variables);
  }
  if (profile.templatePath) {
    return buildCapoManifestFromTemplate(profile.templatePath, variables);
  }

  const {
    cni,
    cloudName,
    clusterName,
    controlPlaneCount,
    controlPlaneFlavor,
    disableAPIServerFloatingIP,
    apiServerLoadBalancer,
    externalNetworkId,
    imageId,
    kubernetesVersion,
    namespace,
    networkName,
    podCidr,
    serviceCidr,
    sshKeyName,
    workerCount,
    workerFlavor,
  } = variables;
  const imageRepository = String(process.env.CAPO_IMAGE_REPOSITORY || "registry.k8s.io").trim();
  const sshRules = sshSourceCidrs().map((cidr, index) => [
    `      - name: community-ssh-${index + 1}`,
    '        description: Allow SSH from the configured operator network',
    '        direction: ingress',
    `        etherType: ${cidr.includes(':') ? 'IPv6' : 'IPv4'}`,
    '        protocol: tcp',
    '        portRangeMin: 22',
    '        portRangeMax: 22',
    `        remoteIPPrefix: ${yamlString(cidr)}`,
  ].join('\n')).join('\n');
  const loadBalancer = apiServerLoadBalancer && typeof apiServerLoadBalancer === "object" ? apiServerLoadBalancer : { enabled: true, minControlPlaneCount: 3 };
  const loadBalancerEnabled = loadBalancer.enabled !== false
    && controlPlaneCount >= Math.max(1, Number(loadBalancer.minControlPlaneCount || 3) || 3);
  const loadBalancerLines = [];
  if (loadBalancerEnabled) {
    loadBalancerLines.push("  apiServerLoadBalancer:", "    enabled: true");
    if (loadBalancer.provider) loadBalancerLines.push(`    provider: ${yamlString(loadBalancer.provider)}`);
    if (loadBalancer.flavor) loadBalancerLines.push(`    flavor: ${yamlString(loadBalancer.flavor)}`);
    if (loadBalancer.availabilityZone) loadBalancerLines.push(`    availabilityZone: ${yamlString(loadBalancer.availabilityZone)}`);
    if (loadBalancer.additionalPorts?.length) {
      loadBalancerLines.push("    additionalPorts:", ...loadBalancer.additionalPorts.map((port) => `      - ${Number(port)}`));
    }
    if (loadBalancer.allowedCIDRs?.length) {
      loadBalancerLines.push("    allowedCIDRs:", ...loadBalancer.allowedCIDRs.map((cidr) => `      - ${yamlString(cidr)}`));
    }
    const monitor = loadBalancer.monitor || {};
    const monitorEntries = ["delay", "timeout", "maxRetries", "maxRetriesDown"].filter((key) => Number(monitor[key]) > 0);
    if (monitorEntries.length) {
      loadBalancerLines.push("    monitor:", ...monitorEntries.map((key) => `      ${key}: ${Math.floor(Number(monitor[key]))}`));
    }
  }
  const loadBalancerYaml = loadBalancerLines.length ? `${loadBalancerLines.join("\n")}\n` : "";

  return `# Generated by Terminal Lab CAPO bridge.
# Request: ${yamlString(name)} / OpenStack project: ${yamlString(projectName)}
apiVersion: cluster.x-k8s.io/v1beta1
kind: Cluster
metadata:
  name: ${yamlString(clusterName)}
  namespace: ${yamlString(namespace)}
  labels:
    example.com/provider: capo
  annotations:
    example.com/request-name: ${yamlString(name)}
    example.com/openstack-project: ${yamlString(projectName)}
spec:
  clusterNetwork:
    pods:
      cidrBlocks:
        - ${yamlString(podCidr)}
    services:
      cidrBlocks:
        - ${yamlString(serviceCidr)}
  infrastructureRef:
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
    kind: OpenStackCluster
    name: ${yamlString(clusterName)}
  controlPlaneRef:
    apiVersion: controlplane.cluster.x-k8s.io/v1beta1
    kind: KubeadmControlPlane
    name: ${yamlString(`${clusterName}-control-plane`)}
---
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: OpenStackCluster
metadata:
  name: ${yamlString(clusterName)}
  namespace: ${yamlString(namespace)}
spec:
${disableAPIServerFloatingIP && loadBalancerEnabled ? "  disableAPIServerFloatingIP: true\n" : ""}${loadBalancerYaml}${yamlOpenstackRef(2, "externalNetwork", externalNetworkId, { id: true })}${yamlOpenstackRef(2, "network", networkName)}  identityRef:
    name: ${yamlString(process.env.CAPO_CLOUD_SECRET_NAME || "cloud-config")}
    cloudName: ${yamlString(cloudName)}
    type: Secret
  managedSecurityGroups:
    allowAllInClusterTraffic: true
${sshRules ? '    allNodesSecurityGroupRules:\n' + sshRules + '\n' : ''}\
---
apiVersion: controlplane.cluster.x-k8s.io/v1beta1
kind: KubeadmControlPlane
metadata:
  name: ${yamlString(`${clusterName}-control-plane`)}
  namespace: ${yamlString(namespace)}
spec:
  replicas: ${controlPlaneCount}
  version: ${yamlString(kubernetesVersion)}
  machineTemplate:
    infrastructureRef:
      apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
      kind: OpenStackMachineTemplate
      name: ${yamlString(`${clusterName}-control-plane`)}
  kubeadmConfigSpec:
    clusterConfiguration:
      imageRepository: ${yamlString(imageRepository)}
${capoProviderIdPreKubeadmCommands(4, kubernetesVersion)}${capoCniPostKubeadmCommands(cni)}---
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: OpenStackMachineTemplate
metadata:
  name: ${yamlString(`${clusterName}-control-plane`)}
  namespace: ${yamlString(namespace)}
spec:
  template:
    spec:
${yamlOpenstackRef(6, "image", imageId)}${yamlOptional(6, "flavor", controlPlaneFlavor)}${yamlOptional(6, "sshKeyName", sshKeyName)}      rootVolume:
        sizeGiB: ${Math.max(20, Number(process.env.CAPO_CONTROL_PLANE_ROOT_GB || 30))}
---
apiVersion: cluster.x-k8s.io/v1beta1
kind: MachineDeployment
metadata:
  name: ${yamlString(`${clusterName}-md-0`)}
  namespace: ${yamlString(namespace)}
spec:
  clusterName: ${yamlString(clusterName)}
  replicas: ${workerCount}
  template:
    spec:
      clusterName: ${yamlString(clusterName)}
      version: ${yamlString(kubernetesVersion)}
      bootstrap:
        configRef:
          apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
          kind: KubeadmConfigTemplate
          name: ${yamlString(`${clusterName}-md-0`)}
      infrastructureRef:
        apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
        kind: OpenStackMachineTemplate
        name: ${yamlString(`${clusterName}-md-0`)}
---
apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
kind: KubeadmConfigTemplate
metadata:
  name: ${yamlString(`${clusterName}-md-0`)}
  namespace: ${yamlString(namespace)}
spec:
  template:
    spec:
${capoProviderIdPreKubeadmCommands(6, kubernetesVersion)}      files:
        - path: /etc/terminal-lab-cni
          permissions: "0644"
          content: ${yamlString(cni)}
---
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: OpenStackMachineTemplate
metadata:
  name: ${yamlString(`${clusterName}-md-0`)}
  namespace: ${yamlString(namespace)}
spec:
  template:
    spec:
${yamlOpenstackRef(6, "image", imageId)}${yamlOptional(6, "flavor", workerFlavor)}${yamlOptional(6, "sshKeyName", sshKeyName)}      rootVolume:
        sizeGiB: ${Math.max(20, Number(process.env.CAPO_WORKER_ROOT_GB || 30))}
`;
}

async function writeCapoManifest(clusterUuid, manifest) {
  const dir = capoManifestDir();
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${clusterUuid}.yaml`);
  await fs.writeFile(filePath, manifest, "utf8");
  return filePath;
}

async function removeCapoManifest(clusterUuid) {
  if (!clusterUuid) return false;
  const filePath = path.join(capoManifestDir(), `${clusterUuid}.yaml`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function capoApplyEnabled() {
  return envFlag("CAPO_APPLY_ENABLED");
}

async function ensureCapoNamespace(apiUrl) {
  const namespace = capoNamespace();
  try {
    await runCommand(resolveKubectlCommand(apiUrl), ["get", "namespace", namespace]);
    return false;
  } catch {
    await runCommand(resolveKubectlCommand(apiUrl), ["create", "namespace", namespace]);
    return true;
  }
}

async function kubectlJson(args, apiUrl) {
  const { stdout } = await runCommand(resolveKubectlCommand(apiUrl), args);
  try {
    return JSON.parse(stdout || "{}");
  } catch (error) {
    throw new Error(`Unable to parse CAPO status JSON. ${error.message}`);
  }
}

function normalizeCapoStatus(json = {}) {
  const phase = String(json.status?.phase || "").toLowerCase();
  const readyCondition = Array.isArray(json.status?.conditions)
    ? json.status.conditions.find((condition) => ["ready", "available"].includes(String(condition.type || "").toLowerCase()))
    : null;
  const ready = String(readyCondition?.status || "").toLowerCase() === "true";
  if (ready || ["provisioned", "running", "available"].includes(phase)) return "create_complete";
  if (["failed", "error"].includes(phase)) return "failed";
  if (phase === "deleting") return "delete_in_progress";
  return "provisioning";
}

function buildStatusReasonFromCluster(json = {}) {
  const conditions = Array.isArray(json.status?.conditions) ? json.status.conditions : [];
  const recent = conditions.find((condition) => String(condition.message || condition.reason || "").trim());
  return String(recent?.message || recent?.reason || json.status?.phase || "CAPO reconciliation in progress").trim();
}

export async function listMagnumClusterTemplates() {
  return getCapoProfiles();
}

function normalizeCapoReplicaCount(...values) {
  for (const value of values) {
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) return Math.floor(count);
  }
  return 0;
}

function resolveCapoEndpoint(cluster = {}, infrastructure = {}) {
  const endpoint = cluster.status?.controlPlaneEndpoint
    || cluster.spec?.controlPlaneEndpoint
    || infrastructure.status?.controlPlaneEndpoint
    || infrastructure.spec?.controlPlaneEndpoint
    || {};
  return {
    apiAddress: String(endpoint.host || "").trim(),
    apiPort: Math.max(1, Math.min(65535, Number(endpoint.port || 6443) || 6443)),
  };
}

function normalizeRemoteCapoCluster(cluster = {}, infrastructure = {}, machines = []) {
  const clusterUuid = String(cluster.metadata?.name || "").trim();
  const controlPlane = cluster.status?.controlPlane || {};
  const workers = cluster.status?.workers || {};
  const topology = cluster.spec?.topology || {};
  const machineItems = Array.isArray(machines) ? machines : [];
  const controlPlaneMachines = machineItems.filter((machine) => Object.prototype.hasOwnProperty.call(machine.metadata?.labels || {}, "cluster.x-k8s.io/control-plane"));
  const workerMachines = machineItems.filter((machine) => !Object.prototype.hasOwnProperty.call(machine.metadata?.labels || {}, "cluster.x-k8s.io/control-plane"));
  const version = String(
    topology.version
      || cluster.metadata?.labels?.["cluster.x-k8s.io/kubernetes-version"]
      || machineItems.find((machine) => String(machine.spec?.version || "").trim())?.spec?.version
      || "",
  ).trim();
  return {
    clusterUuid,
    name: String(cluster.metadata?.annotations?.["example.com/display-name"] || clusterUuid).trim(),
    status: normalizeCapoStatus(cluster),
    statusReason: buildStatusReasonFromCluster(cluster),
    ...resolveCapoEndpoint(cluster, infrastructure),
    kubernetesVersion: version,
    masterCount: normalizeCapoReplicaCount(
      controlPlaneMachines.length || undefined,
      controlPlane.replicas,
      controlPlane.desiredReplicas,
      topology.controlPlane?.replicas,
      1,
    ),
    nodeCount: normalizeCapoReplicaCount(
      workerMachines.length || undefined,
      workers.replicas,
      workers.desiredReplicas,
      topology.workers?.machineDeployments?.reduce((sum, deployment) => sum + Number(deployment?.replicas || 0), 0),
      0,
    ),
    createdAt: String(cluster.metadata?.creationTimestamp || "").trim(),
  };
}

export async function listMagnumRemoteClusters({ apiUrl } = {}) {
  if (!capoApplyEnabled()) return [];
  const response = await kubectlJson(["get", "clusters", "-n", capoNamespace(), "-o", "json"], apiUrl);
  const clusters = Array.isArray(response?.items) ? response.items : [];
  const results = [];
  for (const cluster of clusters) {
    const clusterUuid = String(cluster.metadata?.name || "").trim();
    if (!clusterUuid) continue;
    let infrastructure = {};
    if (!String(cluster.status?.controlPlaneEndpoint?.host || cluster.spec?.controlPlaneEndpoint?.host || "").trim()) {
      infrastructure = await kubectlJson([
        "get", "openstackcluster", clusterUuid, "-n", capoNamespace(), "-o", "json",
      ], apiUrl).catch(() => ({}));
    }
    const machineResponse = await kubectlJson([
      "get", "machines", "-n", capoNamespace(),
      "-l", `cluster.x-k8s.io/cluster-name=${clusterUuid}`, "-o", "json",
    ], apiUrl).catch(() => ({ items: [] }));
    results.push(normalizeRemoteCapoCluster(cluster, infrastructure, machineResponse.items));
  }
  return results;
}

export async function createMagnumCluster({ apiUrl, projectName, name, clusterTemplateId, kubernetesVersion = "", nodeCount = 1, masterCount = 1, controlPlaneFlavor = "", workerFlavor = "" }) {
  const profiles = getCapoProfiles();
  const profile = profiles.find((item) => item.id === clusterTemplateId);
  if (!profile) {
    throw new Error(`Unknown CAPO profile: ${clusterTemplateId || "(empty)"}`);
  }
  const requestedVersion = String(kubernetesVersion || profile.defaultKubernetesVersion || profile.kubernetesVersion || "").trim().replace(/^v/, "");
  const selectedVersion = profile.kubernetesVersions.find((entry) => entry.minor === requestedVersion || entry.version.replace(/^v/, "") === requestedVersion);
  if (!selectedVersion) {
    throw new Error(`Kubernetes version is not allowed for CAPO profile ${profile.id}: ${requestedVersion || "(empty)"}`);
  }
  const selectedControlPlaneFlavor = String(controlPlaneFlavor || profile.masterFlavorId || "").trim();
  const selectedWorkerFlavor = String(workerFlavor || profile.flavorId || "").trim();
  if (!selectedControlPlaneFlavor || !profile.allowedControlPlaneFlavors.includes(selectedControlPlaneFlavor)) {
    throw new Error(`Control-plane flavor is not allowed for CAPO profile ${profile.id}: ${selectedControlPlaneFlavor || "(empty)"}`);
  }
  if (!selectedWorkerFlavor || !profile.allowedWorkerFlavors.includes(selectedWorkerFlavor)) {
    throw new Error(`Worker flavor is not allowed for CAPO profile ${profile.id}: ${selectedWorkerFlavor || "(empty)"}`);
  }
  const normalizedNodeCount = normalizeReplicaCount(nodeCount, 1, { min: 0, max: 100, label: "Worker count" });
  const normalizedMasterCount = normalizeReplicaCount(masterCount, 1, { min: 1, max: 9, label: "Control-plane count" });
  const clusterUuid = buildCapoClusterUuid(name);
  const manifest = await buildCapoManifest({
    clusterUuid,
    projectName,
    name,
    profile: { ...profile, imageId: selectedVersion.imageId, kubernetesVersion: selectedVersion.version, masterFlavorId: selectedControlPlaneFlavor, flavorId: selectedWorkerFlavor },
    nodeCount: normalizedNodeCount,
    masterCount: normalizedMasterCount,
  });
  const manifestPath = await writeCapoManifest(clusterUuid, manifest);
  let statusReason = `CAPO manifest request file created: ${manifestPath}`;

  if (capoApplyEnabled()) {
    await ensureCapoNamespace(apiUrl);
    await runCommand(resolveKubectlCommand(apiUrl), ["apply", "-f", manifestPath]);
    statusReason = `CAPO manifest applied to management cluster: ${manifestPath}`;
  } else {
    statusReason += " / Set CAPO_APPLY_ENABLED=true to run kubectl apply during approval.";
  }

  return {
    clusterUuid,
    name,
    status: "provisioning",
    statusReason,
    apiAddress: "",
    masterCount: normalizedMasterCount,
    nodeCount: normalizedNodeCount,
    clusterTemplateId: profile.id,
    kubernetesVersion: selectedVersion.version,
    controlPlaneFlavor: selectedControlPlaneFlavor,
    workerFlavor: selectedWorkerFlavor,
  };
}

export async function fetchMagnumCluster({ apiUrl, clusterUuid }) {
  if (!capoApplyEnabled()) {
    return {
      clusterUuid,
      status: "provisioning",
      statusReason: "CAPO manifest request file was created; automatic apply is disabled.",
      apiAddress: "",
      apiPort: 6443,
    };
  }
  const json = await kubectlJson(["get", "cluster", clusterUuid, "-n", capoNamespace(), "-o", "json"], apiUrl);
  let endpoint = json.status?.controlPlaneEndpoint || json.spec?.controlPlaneEndpoint || null;
  if (!String(endpoint?.host || "").trim()) {
    const infrastructure = await kubectlJson(["get", "openstackcluster", clusterUuid, "-n", capoNamespace(), "-o", "json"], apiUrl);
    endpoint = infrastructure.status?.controlPlaneEndpoint
      || infrastructure.spec?.controlPlaneEndpoint
      || endpoint;
  }
  return {
    clusterUuid,
    status: normalizeCapoStatus(json),
    statusReason: buildStatusReasonFromCluster(json),
    apiAddress: String(endpoint?.host || "").trim(),
    apiPort: Math.max(1, Math.min(65535, Number(endpoint?.port || 6443) || 6443)),
  };
}

export function rewriteMagnumKubeconfig(rawKubeconfig, { serverUrl = "", tlsServerName = "" } = {}) {
  let config;
  try {
    config = parseYaml(String(rawKubeconfig || ""));
  } catch (error) {
    throw new Error(`CAPO kubeconfig를 해석하지 못했습니다. ${error.message}`);
  }
  if (!config || typeof config !== "object" || !Array.isArray(config.clusters) || !config.clusters.length) {
    throw new Error("CAPO kubeconfig의 cluster 항목이 올바르지 않습니다.");
  }
  for (const entry of config.clusters) {
    if (!entry?.cluster || typeof entry.cluster !== "object") continue;
    if (serverUrl) entry.cluster.server = serverUrl;
    if (tlsServerName) entry.cluster["tls-server-name"] = tlsServerName;
  }
  return stringifyYaml(config, { lineWidth: 0 });
}

export async function getMagnumClusterKubeconfig({ apiUrl, clusterUuid, serverUrl = "", tlsServerName = "" }) {
  if (!clusterUuid || !capoApplyEnabled()) {
    throw new Error("CAPO management cluster에서 kubeconfig를 조회할 수 없습니다.");
  }
  const secret = await kubectlJson(["get", "secret", `${clusterUuid}-kubeconfig`, "-n", capoNamespace(), "-o", "json"], apiUrl);
  const encoded = String(secret.data?.value || secret.data?.kubeconfig || "").trim();
  if (!encoded) throw new Error("CAPO kubeconfig Secret에 kubeconfig 데이터가 없습니다.");
  return rewriteMagnumKubeconfig(Buffer.from(encoded, "base64").toString("utf8"), { serverUrl, tlsServerName });
}

export async function deleteMagnumCluster({ apiUrl, clusterUuid } = {}) {
  if (clusterUuid && capoApplyEnabled()) {
    await runCommand(resolveKubectlCommand(apiUrl), ["delete", "cluster", clusterUuid, "-n", capoNamespace(), "--ignore-not-found=true"]);
  }
  const manifestRemoved = await removeCapoManifest(clusterUuid);
  return { ok: true, manifestRemoved };
}

export async function probeMagnumApi({ apiUrl } = {}) {
  const profiles = getCapoProfiles();
  const result = {
    ok: true,
    latencyMs: 0,
    templateCount: profiles.length,
    provider: "capo",
    cloudName: capoCloudTarget.cloudName,
    managementEndpoint: capoCloudTarget.managementEndpoint || apiUrl || "",
    applyEnabled: capoApplyEnabled(),
    clusterctlEnabled: envFlag("CAPO_CLUSTERCTL_ENABLED"),
    namespace: capoNamespace(),
    manifestDir: capoManifestDir(),
  };
  if (!capoApplyEnabled()) return result;
  const started = Date.now();
  await runCommand(resolveKubectlCommand(apiUrl), ["get", "namespace", capoNamespace()]);
  return {
    ...result,
    latencyMs: Date.now() - started,
  };
}
