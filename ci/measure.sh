#!/usr/bin/env bash
# Measure one tree. The same steps run in CI and locally.
#
#   ci/measure.sh <tree> <out.json> [<ruler-tree>]
#
# The tree is installed and built first (npm ci runs the build), then measured.
# ruler-tree: after the build, take .oxlintrc.json, tsconfig.json and tsconfig.cli.json from here, so base and PR are
#             checked with the same rules. A PR that adds a rule then isn't blamed for problems that already existed.
# JUDGE_METRICS: which metrics.mjs to use (CI passes the base branch's copy, so a PR can't change how it's judged).
set -euo pipefail

abs() { case "$1" in /*) echo "$1" ;; *) echo "$PWD/$1" ;; esac; }

TREE="$(cd "$1" && pwd)"
OUT="$(abs "$2")"
RULER="${3:+$(cd "$3" && pwd)}"
JUDGE_METRICS="$(abs "${JUDGE_METRICS:-$TREE/ci/metrics.mjs}")"

cd "$TREE"
npm ci --no-audit --no-fund --silent

if [ -n "$RULER" ] && [ "$RULER" != "$TREE" ]; then
  for f in .oxlintrc.json tsconfig.json tsconfig.cli.json; do
    if [ -f "$RULER/$f" ]; then cp "$RULER/$f" "$f"; elif [ -f "$f" ]; then rm "$f"; fi
  done
fi

node "$JUDGE_METRICS" collect "$OUT"
