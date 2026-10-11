#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

echo "=== Running MACV-R7 / MACV-R8 Revert Sensitivity Suite ==="
python3 "${SCRIPT_DIR}/revert-sensitivity.py"
