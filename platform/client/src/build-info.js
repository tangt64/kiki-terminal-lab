const versionMajor = typeof __APP_VERSION_MAJOR__ === "string" ? __APP_VERSION_MAJOR__ : "1";
const commitCount = typeof __BUILD_COMMIT_COUNT__ === "string" ? __BUILD_COMMIT_COUNT__ : "0";
const buildBranch = typeof __BUILD_BRANCH__ === "string" ? __BUILD_BRANCH__ : "unknown";
const buildCommit = typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown";







export function formatBuildBranch() {
  return buildBranch && buildBranch !== "unknown" ? buildBranch : "local";
}

export function formatBuildCommit() {
  return buildCommit && buildCommit !== "unknown" ? buildCommit : "dev";
}
