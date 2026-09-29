#!/usr/bin/env sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "请先从 https://nodejs.org/ 安装 Node.js 24 LTS，再运行此脚本。"
  exit 1
fi
node scripts/install.mjs
