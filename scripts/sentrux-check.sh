#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${ROOT_DIR}/.tools"
BIN_PATH="${TOOLS_DIR}/sentrux"
VERSION="${SENTRUX_VERSION:-0.5.7}"
OS="${SENTRUX_OS:-linux}"
ARCH="${SENTRUX_ARCH:-x86_64}"
URL="https://github.com/sentrux/sentrux/releases/download/v${VERSION}/sentrux-${OS}-${ARCH}"

mkdir -p "${TOOLS_DIR}"

if [[ ! -x "${BIN_PATH}" ]]; then
  echo "Installing sentrux v${VERSION} to ${BIN_PATH}"
  curl -fsSL "${URL}" -o "${BIN_PATH}"
  chmod +x "${BIN_PATH}"
fi

exec "${BIN_PATH}" check "${ROOT_DIR}"
