import { lazy } from "react";

const DYNAMIC_IMPORT_RELOAD_KEY = "terminal-lab:dynamic-import-reload-at";

function readDynamicImportReloadState() {
  if (typeof window === "undefined") return { at: 0, path: "" };
  try {
    const raw = window.sessionStorage?.getItem(DYNAMIC_IMPORT_RELOAD_KEY) || "";
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      at: Number(parsed?.at || 0),
      path: String(parsed?.path || ""),
    };
  } catch {
    return { at: 0, path: "" };
  }
}

function writeDynamicImportReloadState(state) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(DYNAMIC_IMPORT_RELOAD_KEY, JSON.stringify({
      at: Number(state?.at || 0),
      path: String(state?.path || ""),
    }));
  } catch {
    // Ignore storage write failures and fall back to the thrown import error.
  }
}

function isDynamicImportError(error) {
  const message = String(error?.message || error || "");
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message);
}

function maybeReloadAfterDynamicImportError(error) {
  if (typeof window === "undefined" || !isDynamicImportError(error)) return false;
  const now = Date.now();
  const { at: lastReloadAt, path: lastReloadPath } = readDynamicImportReloadState();
  const currentPath = `${window.location.pathname}${window.location.search}`;
  const sameRouteCooldownActive = Number.isFinite(lastReloadAt) && now - lastReloadAt <= 10000 && lastReloadPath === currentPath;
  if (sameRouteCooldownActive) return false;
  writeDynamicImportReloadState({ at: now, path: currentPath });
  window.location.reload();
  return true;
}

export function lazyWithChunkReload(loader) {
  return lazy(() => loader().catch((error) => {
    if (maybeReloadAfterDynamicImportError(error)) {
      return new Promise(() => {});
    }
    throw error;
  }));
}

export function lazyNamedWithChunkReload(loader, exportName) {
  return lazyWithChunkReload(() => loader().then((module) => ({ default: module[exportName] })));
}
