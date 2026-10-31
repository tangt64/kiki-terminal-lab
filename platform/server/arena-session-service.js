import { createHeatStack, createOpenstackRemoteConsole, deleteHeatStack, resolveOpenstackServer } from "./heat.js";
import { createZunRemoteContainer, deleteZunRemoteContainer } from "./zun.js";

const ARENA_VM_HEAT_TEMPLATE = process.env.ARENA_VM_HEAT_TEMPLATE || process.env.SELF_SERVICE_VM_HEAT_TEMPLATE || "linux-shell-lab.yaml";
const ARENA_VM_HEAT_API_URL = process.env.ARENA_VM_HEAT_API_URL || process.env.SELF_SERVICE_VM_HEAT_API_URL || "";
const ARENA_VM_KEY_NAME = process.env.ARENA_VM_KEY_NAME || "lab-key";
const ARENA_VM_SECURITY_GROUP = process.env.ARENA_VM_SECURITY_GROUP || "example.com";
const ARENA_DEFAULT_ZUN_IMAGE = process.env.ARENA_DEFAULT_ZUN_IMAGE || "docker.io/library/rockylinux:9";
const ARENA_DEFAULT_ZUN_NETWORK = process.env.ARENA_DEFAULT_ZUN_NETWORK || "net-infra";
const ARENA_DEFAULT_ZUN_SECURITY_GROUP = process.env.ARENA_DEFAULT_ZUN_SECURITY_GROUP || "example.com";

function buildArenaResourceName({ user, node }) {
  const stamp = Date.now().toString(36);
  return `arena-${String(user?.username || "user").toLowerCase()}-${String(node?.nodeCode || "node").toLowerCase()}-${stamp}`;
}

function buildVmParameters({ resourceName, scenario }) {
  const metadata = scenario?.metadata || {};
  return {
    instance_name: resourceName,
    flavor: String(scenario?.flavorName || "").trim() || "m1.small",
    image: String(scenario?.imageName || "").trim() || "lab-rocky-9-2026",
    network: String(scenario?.networkName || "").trim() || "net-infra",
    key_name: ARENA_VM_KEY_NAME,
    security_group: ARENA_VM_SECURITY_GROUP,
    ...(String(metadata.cloudInitTemplateName || "").trim() ? { cloud_init_template_name: String(metadata.cloudInitTemplateName || "").trim() } : {}),
    ...(String(metadata.applicationYamlName || "").trim() ? { application_yaml_name: String(metadata.applicationYamlName || "").trim() } : {}),
    ...(String(metadata.applicationYamlCategory || "").trim() ? { application_yaml_category: String(metadata.applicationYamlCategory || "").trim() } : {}),
  };
}

async function provisionContainerArenaSession({ platformStatus, user, node, scenario, zunProjectName }) {
  const resourceName = buildArenaResourceName({ user, node });
  if (platformStatus?.zunEnabled && platformStatus?.zunApiUrl) {
    const created = await createZunRemoteContainer({
      apiUrl: platformStatus.zunApiUrl,
      projectName: zunProjectName,
      name: resourceName,
      image: String(scenario?.imageName || "").trim() || ARENA_DEFAULT_ZUN_IMAGE,
      network: String(scenario?.networkName || "").trim() || ARENA_DEFAULT_ZUN_NETWORK,
      securityGroup: ARENA_DEFAULT_ZUN_SECURITY_GROUP,
    });
    return {
      resourceId: created.containerUuid || resourceName,
      resourceName,
      consoleUrl: "",
      metadata: {
        driver: "zun",
        addresses: created.addresses || [],
        remoteStatus: created.status || "",
        templateBindings: {
          applicationYamlName: String(scenario?.metadata?.applicationYamlName || "").trim(),
          applicationYamlCategory: String(scenario?.metadata?.applicationYamlCategory || "").trim(),
        },
      },
    };
  }

  return {
    resourceId: `mock-container-${resourceName}`,
    resourceName,
    consoleUrl: "",
    metadata: {
      driver: "mock-container",
      templateBindings: {
        applicationYamlName: String(scenario?.metadata?.applicationYamlName || "").trim(),
        applicationYamlCategory: String(scenario?.metadata?.applicationYamlCategory || "").trim(),
      },
    },
  };
}

async function provisionVmArenaSession({ serviceProjectName, user, node, scenario }) {
  const resourceName = buildArenaResourceName({ user, node });
  const created = await createHeatStack({
    stackName: resourceName,
    templateName: String(scenario?.metadata?.heatTemplateName || "").trim() || ARENA_VM_HEAT_TEMPLATE,
    apiUrl: ARENA_VM_HEAT_API_URL,
    projectName: serviceProjectName,
    parameters: buildVmParameters({ resourceName, scenario }),
  });

  const resolvedServer = await resolveOpenstackServer({
    serverName: created.stackName || resourceName,
    fixedIp: created.instanceIp || "",
    projectName: serviceProjectName,
  });

  const consoleType = String(scenario?.consoleType || "serial").trim().toLowerCase();
  if (!["serial", "ssh"].includes(consoleType)) {
    throw new Error("실무 역량 진단 VM은 serial 또는 SSH 콘솔만 사용할 수 있습니다.");
  }
  const consoleEntry = consoleType === "serial"
    ? await createOpenstackRemoteConsole({
        serverId: resolvedServer?.id || created.stackId || resourceName,
        protocol: "serial",
        type: "serial",
        projectName: serviceProjectName,
      })
    : null;

  return {
    resourceId: resolvedServer?.id || created.stackId || resourceName,
    resourceName: created.stackName || resourceName,
    consoleUrl: consoleEntry?.url || "",
    metadata: {
      driver: "openstack",
      stackId: created.stackId || "",
      stackName: created.stackName || resourceName,
      instanceIp: created.instanceIp || "",
      serverId: resolvedServer?.id || "",
      addresses: created.instanceIps || [],
      templateBindings: {
        heatTemplateName: String(scenario?.metadata?.heatTemplateName || "").trim(),
        cloudInitTemplateName: String(scenario?.metadata?.cloudInitTemplateName || "").trim(),
        applicationYamlName: String(scenario?.metadata?.applicationYamlName || "").trim(),
        applicationYamlCategory: String(scenario?.metadata?.applicationYamlCategory || "").trim(),
      },
    },
  };
}

export async function provisionArenaSession({
  platformStatus,
  user,
  node,
  scenario,
  serviceProjectName,
  zunProjectName,
}) {
  if (scenario?.backendType === "container") {
    return provisionContainerArenaSession({ platformStatus, user, node, scenario, zunProjectName });
  }
  return provisionVmArenaSession({ serviceProjectName, user, node, scenario });
}

export async function reconnectArenaSession({ sessionRecord, serviceProjectName }) {
  if (sessionRecord?.consoleType !== "serial") {
    return {
      consoleUrl: sessionRecord?.consoleUrl || "",
      metadata: {
        ...(sessionRecord?.metadata || {}),
        lastReconnectAt: new Date().toISOString(),
      },
    };
  }
  const serverId = String(sessionRecord?.metadata?.serverId || sessionRecord?.resourceId || "").trim();
  if (!serverId) {
    return {
      consoleUrl: sessionRecord?.consoleUrl || "",
      metadata: {
        ...(sessionRecord?.metadata || {}),
        lastReconnectAt: new Date().toISOString(),
      },
    };
  }
  const consoleEntry = await createOpenstackRemoteConsole({
    serverId,
    protocol: "serial",
    type: "serial",
    projectName: serviceProjectName,
  });
  return {
    consoleUrl: consoleEntry?.url || sessionRecord?.consoleUrl || "",
    metadata: {
      ...(sessionRecord?.metadata || {}),
      lastReconnectAt: new Date().toISOString(),
    },
  };
}

export async function rebootArenaSession({ sessionRecord, serviceProjectName }) {
  return reconnectArenaSession({ sessionRecord, serviceProjectName });
}

export async function terminateArenaSession({ sessionRecord, platformStatus, serviceProjectName, zunProjectName }) {
  const driver = String(sessionRecord?.metadata?.driver || "").trim();
  if (driver === "zun" && platformStatus?.zunApiUrl && sessionRecord?.resourceId) {
    await deleteZunRemoteContainer({
      apiUrl: platformStatus.zunApiUrl,
      projectName: zunProjectName,
      containerUuid: sessionRecord.resourceId,
    });
    return;
  }
  if (driver === "openstack" && sessionRecord?.metadata?.stackId && sessionRecord?.metadata?.stackName) {
    await deleteHeatStack({
      stackId: sessionRecord.metadata.stackId,
      stackName: sessionRecord.metadata.stackName,
      projectName: serviceProjectName,
    });
  }
}
