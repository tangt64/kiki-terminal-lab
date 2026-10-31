// ISO installation creates a separate, persistent target volume. The installer
// VM remains available for recovery after creating a disk-only runtime VM.
export function isoError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function isoDiskSize(value) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 8 || size > 2048) throw isoError("설치 디스크는 8~2048GB의 정수로 지정하세요.");
  return size;
}

export function validateIsoImage(image) {
  if (image?.status !== "active" || image?.disk_format !== "iso") throw isoError("사용 가능한 ISO 형식의 이미지를 선택하세요.");
  if (image.hw_firmware_type !== "uefi") throw isoError("UEFI ISO를 등록하세요. 이미지의 hw_firmware_type=uefi 설정이 필요합니다.");
  if (image.os_secure_boot === "required") throw isoError("이 ISO 설치 경로는 Secure Boot 필수 이미지를 지원하지 않습니다.");
  const bytes = Number(image.size);
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 8 * 1024 ** 3) throw isoError("ISO 크기는 8GB 이하여야 합니다.");
  return Math.max(2, Math.ceil(bytes / 1024 ** 3));
}

async function available(api, resource, id, { timeoutMs = 600000, intervalMs = 1500 } = {}) {
  const key = resource === "snapshots" ? "snapshot" : "volume";
  const deadline = Date.now() + timeoutMs;
  do {
    const row = (await api("volume", `/${resource}/${encodeURIComponent(id)}`, { method: "GET" }))[key];
    if (row?.status === "available") return row;
    if (String(row?.status || "").startsWith("error")) throw isoError(`${resource} 작업이 실패했습니다. 자원 ${id}를 확인하세요.`, 502);
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (Date.now() <= deadline);
  throw isoError(`${resource} 준비 시간이 초과됐습니다. 자원 ${id}는 복구를 위해 보존됩니다.`, 504);
}

export async function createIsoServer(api, { name, image, flavorId, flavorRef = flavorId, networkId, securityGroupNames = [], ownerUserId, bootVolumeSizeGb = 32, wait = {}, automation = null }) {
  const cdromSize = validateIsoImage(image);
  const size = isoDiskSize(bootVolumeSizeGb);
  if (!ownerUserId || !name || !networkId || !flavorId) throw isoError("ISO 생성의 소유자와 인스턴스 구성이 필요합니다.");
  const metadata = { terminal_lab_managed: "true", terminal_lab_user_id: String(ownerUserId), terminal_lab_iso_image_id: image.id };
  if(automation)metadata.terminal_lab_build_job_id=automation.jobId;
  const volume = automation?.volumeId
    ? (await api('volume',`/volumes/${automation.volumeId}`,{method:'GET'})).volume
    : (await api("volume", "/volumes", { method: "POST", body: { volume: { name: `${name}-install-disk`, size, metadata } } })).volume;
  if (!volume?.id) throw isoError("설치 볼륨 ID를 확인하지 못했습니다.", 502);
  if(automation && (volume.metadata?.terminal_lab_build_job_id!==automation.jobId || volume.metadata?.terminal_lab_user_id!==String(ownerUserId) || volume.size!==size))throw isoError('자동 설치 볼륨 소유권 불일치',409);
  if(automation)await automation.onVolume(volume.id);
  try {
    await available(api, "volumes", volume.id, wait);
    const server = { name, flavorRef: flavorId, networks: [{ uuid: networkId }],
      metadata: { ...metadata, terminal_lab_boot_source: "iso", terminal_lab_install_volume_id: volume.id, terminal_lab_install_flavor_id: flavorId, terminal_lab_install_flavor_ref: flavorRef, terminal_lab_install_size_gb: String(size), terminal_lab_install_network_id: networkId },
      security_groups: securityGroupNames.map((group) => ({ name: group })),
      block_device_mapping_v2: [
        { boot_index: 0, uuid: image.id, source_type: "image", destination_type: "volume", volume_size: cdromSize, device_type: "cdrom", disk_bus: "scsi", delete_on_termination: true },
        { boot_index: 1, uuid: volume.id, source_type: "volume", destination_type: "volume", device_type: "disk", disk_bus: "scsi", delete_on_termination: false },
      ] };
    if(automation){
      server.config_drive=true;
      server.user_data=Buffer.from(await automation.seed(volume.id)).toString('base64');
      await automation.beforeCreate();
    }
    const result = (await api("compute", "/servers", { method: "POST", body: { server } })).server;
    if (!result?.id) throw isoError("Nova 응답에 인스턴스 ID가 없습니다.", 502);
    return { ...result, installation: { mode: "iso", stage: "installing", targetVolumeId: volume.id, isoImageId: image.id, diskSizeGb: size, accountSetup: "installer" } };
  } catch (error) {
    // A timed-out Nova request may have created a server. Never delete the disk
    // on an ambiguous response: report its ID so an operator can recover it.
    error.message += ` (설치 볼륨 ${volume.id} 보존)`;
    throw error;
  }
}

const transitions = new Map();
export async function completeIsoServer(api, options) {
  const key = `${options.projectName}/${options.serverId}`;
  if (transitions.has(key)) throw isoError("같은 ISO 설치 전환이 진행 중입니다.", 409);
  const task = complete(api, options);
  transitions.set(key, task);
  try { return await task; } finally { transitions.delete(key); }
}

async function complete(api, { serverId, ownerUserId, installationConfirmed, wait = {} }) {
  if (installationConfirmed !== true) throw isoError("OS 설치 완료를 먼저 확인하세요.");
  const server = (await api("compute", `/servers/${encodeURIComponent(serverId)}`, { method: "GET" })).server;
  const meta = server?.metadata || {};
  if (meta.terminal_lab_boot_source !== "iso" || meta.terminal_lab_user_id !== String(ownerUserId)) throw isoError("본인의 ISO 설치 VM만 전환할 수 있습니다.", 403);
  const targets = (await api("compute", "/servers/detail", { method: "GET" })).servers || [];
  const existing = targets.find((row) => row.metadata?.terminal_lab_iso_origin_id === serverId && row.metadata?.terminal_lab_user_id === String(ownerUserId));
  if (existing) return { ...existing, installation: { mode: "iso", stage: "disk-boot", installerServerId: serverId, reused: true } };
  if (server.status !== "SHUTOFF") throw isoError("설치기에서 OS 설치를 완료하고 VM을 정상 종료한 뒤 전환하세요.", 409);
  const volumeId = meta.terminal_lab_install_volume_id;
  if (!volumeId) throw isoError("설치 볼륨 식별자가 없습니다.", 409);
  const source = (await api("volume", `/volumes/${encodeURIComponent(volumeId)}`, { method: "GET" })).volume;
  if (source?.metadata?.terminal_lab_user_id !== String(ownerUserId) || source.metadata.terminal_lab_iso_image_id !== meta.terminal_lab_iso_image_id || source.status !== "in-use" || source.attachments?.length !== 1 || source.attachments[0].server_id !== serverId) throw isoError("설치 볼륨의 소유자와 연결 상태가 일치하지 않습니다.", 409);
  const networkId = meta.terminal_lab_install_network_id, flavorId = meta.terminal_lab_install_flavor_id;
  if (!networkId || !flavorId) throw isoError("원본 네트워크와 Flavor 구성이 없습니다.", 409);
  const metadata = { terminal_lab_managed: "true", terminal_lab_user_id: String(ownerUserId), terminal_lab_iso_origin_id: serverId };
  const snapshots = (await api("volume", "/snapshots/detail", { method: "GET" })).snapshots || [];
  let snapshot = snapshots.find((row) => row.volume_id === volumeId && row.metadata?.terminal_lab_iso_origin_id === serverId && row.metadata?.terminal_lab_user_id === String(ownerUserId));
  if (!snapshot) snapshot = (await api("volume", "/snapshots", { method: "POST", body: { snapshot: { name: `${server.name}-installed`, volume_id: volumeId, force: true, metadata } } })).snapshot;
  if (!snapshot?.id) throw isoError("설치 스냅샷 ID가 없습니다.", 502);
  await available(api, "snapshots", snapshot.id, wait);
  const volumes = (await api("volume", "/volumes/detail", { method: "GET" })).volumes || [];
  let target = volumes.find((row) => row.snapshot_id === snapshot.id && row.metadata?.terminal_lab_iso_origin_id === serverId && row.metadata?.terminal_lab_user_id === String(ownerUserId));
  if (!target) target = (await api("volume", "/volumes", { method: "POST", body: { volume: { name: `${server.name}-runtime`, size: source.size, snapshot_id: snapshot.id, metadata } } })).volume;
  if (!target?.id) throw isoError("실행 볼륨 ID가 없습니다.", 502);
  await available(api, "volumes", target.id, wait);
  await api("volume", `/volumes/${target.id}/action`, { method: "POST", body: { "os-set_bootable": { bootable: true } } });
  await api("volume", `/volumes/${target.id}/action`, { method: "POST", body: { "os-set_image_metadata": { metadata: { hw_firmware_type: "uefi", hw_disk_bus: "scsi", hw_scsi_model: "virtio-scsi", os_secure_boot: "disabled" } } } });
  const result = (await api("compute", "/servers", { method: "POST", body: { server: { name: `${server.name.slice(0, 54)}-installed`, flavorRef: flavorId, networks: [{ uuid: networkId }], metadata,
    security_groups: (server.security_groups || []).map((group) => ({ name: group.name })),
    block_device_mapping_v2: [{ boot_index: 0, uuid: target.id, source_type: "volume", destination_type: "volume", device_type: "disk", disk_bus: "scsi", delete_on_termination: false }] } } })).server;
  if (!result?.id) throw isoError("실행 VM ID를 확인하지 못했습니다.", 502);
  return { ...result, installation: { mode: "iso", stage: "disk-boot", installerServerId: serverId, targetVolumeId: target.id, snapshotId: snapshot.id, accountSetup: "installer" } };
}
