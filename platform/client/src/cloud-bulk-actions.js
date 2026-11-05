export function selectBulkStartTargets(instances, isBusy = () => false) {
  const seen = new Set();
  return instances.filter(vm => {
    const id = String(vm.id);
    if (seen.has(id) || String(vm.status).toUpperCase() !== 'SHUTOFF' || vm['OS-EXT-STS:task_state'] || isBusy(vm.id)) return false;
    seen.add(id); return true;
  });
}
export async function runCloudBulkActions({ instances, operation, runAction, onProgress = () => {} }) {
  if (!["delete", "reboot", "start"].includes(operation)) throw new Error("지원하지 않는 일괄 작업입니다.");
  if (operation === 'start' && (!instances.length || instances.some(instance => String(instance.status).toUpperCase() !== 'SHUTOFF') || new Set(instances.map(instance => String(instance.id))).size !== instances.length)) throw new Error('중지된 가상머신만 중복 없이 선택해 주세요.');
  const results = [];
  // Keep requests ordered so snapshot refreshes cannot overwrite newer results.
  for (const instance of instances) {
    try {
      const result = await runAction({
        method: operation === "delete" ? "DELETE" : "POST",
        path: `/api/cloud-console/instances/${encodeURIComponent(instance.id)}${operation === "delete" ? "" : "/action"}`,
        body: operation === "delete" ? {} : { action: operation },
      });
      if (!result) throw new Error("작업 응답을 확인하지 못했습니다.");
      results.push({ id: instance.id, name: instance.name || instance.id, status: result.approvalRequired ? "pending" : "success" });
    } catch (error) {
      results.push({ id: instance.id, name: instance.name || instance.id, status: "failed", message: error.userMessage || error.message || "작업 실패" });
    }
    onProgress(results.length, instances.length);
  }
  return results;
}
