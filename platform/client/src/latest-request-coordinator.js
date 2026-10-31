export function createLatestRequestCoordinator() {
  let current = null;
  let sequence = 0;

  return {
    begin({ key = "", replace = false } = {}) {
      const normalizedKey = String(key || "").trim();
      if (current) {
        if (!replace || current.key === normalizedKey) {
          return { started: false, request: current };
        }
        current.controller.abort();
      }

      const request = {
        id: ++sequence,
        key: normalizedKey,
        controller: new AbortController(),
      };
      current = request;
      return { started: true, request };
    },

    isCurrent(request) {
      return Boolean(request && current?.id === request.id);
    },

    finish(request) {
      if (!request || current?.id !== request.id) return false;
      current = null;
      return true;
    },

    cancel() {
      if (!current) return false;
      const request = current;
      current = null;
      request.controller.abort();
      return true;
    },

    getCurrent() {
      return current;
    },
  };
}
