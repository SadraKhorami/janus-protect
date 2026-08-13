#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(git rev-parse --show-toplevel)"

[[ $(git branch --show-current) == main ]] || { echo 'Releases must be created from main.' >&2; exit 1; }
[[ -z $(git status --porcelain) ]] || { echo 'Commit or discard local changes first.' >&2; exit 1; }

git fetch origin main --tags
[[ $(git rev-parse HEAD) == $(git rev-parse origin/main) ]] || {
  echo 'Local main must exactly match origin/main.' >&2
  exit 1
}

version=$(node -p "require('./package.json').version")
tag="v${version}"
git rev-parse --verify --quiet "refs/tags/${tag}" >/dev/null && {
  echo "${tag} already exists. Bump the project version before releasing." >&2
  exit 1
}

pnpm check
git tag --annotate "${tag}" --message "Janus Protect ${tag}"
git push origin "${tag}"

echo "${tag} pushed. GitHub will verify it and publish the release."
