#!/usr/bin/env bash
set -euo pipefail

# Bump version and publish all @kibadist/agentui-* packages
# Usage: ./scripts/bump-and-publish.sh [patch|minor|major] [--dry-run]

BUMP_TYPE="${1:-patch}"
DRY_RUN="${2:-}"

if [[ "$BUMP_TYPE" != "patch" && "$BUMP_TYPE" != "minor" && "$BUMP_TYPE" != "major" ]]; then
  echo "Usage: $0 [patch|minor|major] [--dry-run]"
  exit 1
fi

PACKAGES=(
  packages/protocol
  packages/validate
  packages/react
  packages/nest
  packages/ai
  packages/next
)

# Read current version from protocol (source of truth)
CURRENT=$(node -p "require('./packages/protocol/package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

case "$BUMP_TYPE" in
  major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
  minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
  patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
esac

echo "Bumping: $CURRENT -> $NEW_VERSION ($BUMP_TYPE)"
echo ""

# Typecheck first
echo "Running typecheck..."
pnpm typecheck

# Build all packages
echo "Building all packages..."
pnpm build

# Bump version in all package.json files
for pkg in "${PACKAGES[@]}"; do
  node -e "
    const fs = require('fs');
    const path = './${pkg}/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '${NEW_VERSION}';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "  Bumped ${pkg}/package.json -> ${NEW_VERSION}"
done

echo ""

if [[ "$DRY_RUN" == "--dry-run" ]]; then
  echo "Dry run — skipping publish and git commit."
  echo "Would publish:"
  for pkg in "${PACKAGES[@]}"; do
    NAME=$(node -p "require('./${pkg}/package.json').name")
    echo "  ${NAME}@${NEW_VERSION}"
  done
  exit 0
fi

# Publish in dependency order
for pkg in "${PACKAGES[@]}"; do
  NAME=$(node -p "require('./${pkg}/package.json').name")
  echo "Publishing ${NAME}@${NEW_VERSION}..."
  (cd "$pkg" && pnpm publish --access public --no-git-checks)
done

echo ""

# Git commit and tag
git add packages/*/package.json
git commit -m "Bump all packages to v${NEW_VERSION}"
git tag "v${NEW_VERSION}"

echo ""
echo "Done! All packages published at v${NEW_VERSION}"
echo "Run 'git push && git push --tags' to push."
