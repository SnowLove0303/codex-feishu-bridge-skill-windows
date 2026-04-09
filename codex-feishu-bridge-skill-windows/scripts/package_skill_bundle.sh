#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/../codex-feishu-bridge-skill-windows-v1.0.0.zip}"

rm -f "$OUT"
cd "$ROOT/.."
zip -qr "$OUT" "codex-feishu-bridge-skill-windows"
printf "Created: %s\n" "$OUT"
