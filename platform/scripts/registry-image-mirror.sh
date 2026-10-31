#!/usr/bin/env sh
set -eu

SOURCE_IMAGE="${REGISTRY_SOURCE_IMAGE:-${REGISTRY_MIRROR_SOURCE_IMAGE:-}}"
TARGET_IMAGE="${REGISTRY_TARGET_IMAGE:-${REGISTRY_MIRROR_TARGET_IMAGE:-${REGISTRY_IMAGE_NAME:-}}}"
TLS_VERIFY="${REGISTRY_TLS_VERIFY:-true}"
DEST_USERNAME="${REGISTRY_USERNAME:-${REGISTRY_DEST_USERNAME:-${IMAGE_REGISTRY_USERNAME:-}}}"
DEST_PASSWORD="${REGISTRY_PASSWORD:-${REGISTRY_DEST_PASSWORD:-${IMAGE_REGISTRY_PASSWORD:-}}}"
SOURCE_USERNAME="${REGISTRY_SOURCE_USERNAME:-}"
SOURCE_PASSWORD="${REGISTRY_SOURCE_PASSWORD:-}"
AUTH_FILE="${REGISTRY_AUTH_FILE:-}"
COPY_ALL_ARCHES="${REGISTRY_COPY_ALL_ARCHES:-false}"

SKOPEO_PLATFORM_ARGS=""
if [ "$COPY_ALL_ARCHES" = "true" ] || [ "$COPY_ALL_ARCHES" = "1" ]; then
  SKOPEO_PLATFORM_ARGS="--all"
fi

run_skopeo_copy() {
  if [ -n "$AUTH_FILE" ] && [ -r "$AUTH_FILE" ]; then
    exec skopeo copy --authfile "$AUTH_FILE" "$@"
  fi
  exec skopeo copy "$@"
}

if [ -z "$SOURCE_IMAGE" ] || [ -z "$TARGET_IMAGE" ]; then
  echo "REGISTRY_SOURCE_IMAGE and REGISTRY_TARGET_IMAGE are required." >&2
  exit 2
fi

echo "Mirroring ${SOURCE_IMAGE} -> ${TARGET_IMAGE}"

if command -v skopeo >/dev/null 2>&1; then
  TLS_FLAG="--dest-tls-verify=true"
  SRC_TLS_FLAG="--src-tls-verify=true"
  if [ "$TLS_VERIFY" = "false" ] || [ "$TLS_VERIFY" = "0" ]; then
    TLS_FLAG="--dest-tls-verify=false"
    SRC_TLS_FLAG="--src-tls-verify=false"
  fi

  if [ -n "$DEST_USERNAME" ] && [ -n "$DEST_PASSWORD" ] && [ -n "$SOURCE_USERNAME" ] && [ -n "$SOURCE_PASSWORD" ]; then
    run_skopeo_copy $SKOPEO_PLATFORM_ARGS --retry-times 3 "$SRC_TLS_FLAG" "$TLS_FLAG" \
      --src-creds "${SOURCE_USERNAME}:${SOURCE_PASSWORD}" \
      --dest-creds "${DEST_USERNAME}:${DEST_PASSWORD}" \
      "docker://${SOURCE_IMAGE}" "docker://${TARGET_IMAGE}"
  fi

  if [ -n "$DEST_USERNAME" ] && [ -n "$DEST_PASSWORD" ]; then
    run_skopeo_copy $SKOPEO_PLATFORM_ARGS --retry-times 3 "$SRC_TLS_FLAG" "$TLS_FLAG" \
      --dest-creds "${DEST_USERNAME}:${DEST_PASSWORD}" \
      "docker://${SOURCE_IMAGE}" "docker://${TARGET_IMAGE}"
  fi

  if [ -n "$SOURCE_USERNAME" ] && [ -n "$SOURCE_PASSWORD" ]; then
    run_skopeo_copy $SKOPEO_PLATFORM_ARGS --retry-times 3 "$SRC_TLS_FLAG" "$TLS_FLAG" \
      --src-creds "${SOURCE_USERNAME}:${SOURCE_PASSWORD}" \
      "docker://${SOURCE_IMAGE}" "docker://${TARGET_IMAGE}"
  fi

  run_skopeo_copy $SKOPEO_PLATFORM_ARGS --retry-times 3 "$SRC_TLS_FLAG" "$TLS_FLAG" \
    "docker://${SOURCE_IMAGE}" "docker://${TARGET_IMAGE}"
fi

if command -v crane >/dev/null 2>&1; then
  if [ -n "$DEST_USERNAME" ] && [ -n "$DEST_PASSWORD" ]; then
    TARGET_REGISTRY="$(printf '%s' "$TARGET_IMAGE" | cut -d/ -f1)"
    printf '%s' "$DEST_PASSWORD" | crane auth login "$TARGET_REGISTRY" -u "$DEST_USERNAME" --password-stdin
  fi

  if [ -n "$SOURCE_USERNAME" ] && [ -n "$SOURCE_PASSWORD" ]; then
    SOURCE_REGISTRY="$(printf '%s' "$SOURCE_IMAGE" | cut -d/ -f1)"
    printf '%s' "$SOURCE_PASSWORD" | crane auth login "$SOURCE_REGISTRY" -u "$SOURCE_USERNAME" --password-stdin
  fi

  if [ "$TLS_VERIFY" = "false" ] || [ "$TLS_VERIFY" = "0" ]; then
    exec crane copy --insecure "$SOURCE_IMAGE" "$TARGET_IMAGE"
  fi
  exec crane copy "$SOURCE_IMAGE" "$TARGET_IMAGE"
fi

echo "Neither skopeo nor crane is installed. Install skopeo or provide CONTAINER_REGISTRY_IMAGE_MIRROR_COMMAND." >&2
exit 127
