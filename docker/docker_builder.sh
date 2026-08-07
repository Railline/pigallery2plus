#!/bin/bash
# PiGallery2 Plus: Build -> Release -> Docker (Debian Trixie) -> Diagnostics
# This is a helper script for building docker locally. Its a best effort file ans provided as it is, do not expect significant support for this if it gets our of sync from the project. 

set -Eeuo pipefail

# Configuration
REPO_URL="${REPO_URL:-https://github.com/Railline/pigallery2plus.git}"
REPO_REF="${REPO_REF:-main}"
BUILD_DIR="$(mktemp -d -t pigallery2plus-build.XXXXXX)"
IMAGE_NAME="${IMAGE_NAME:-pigallery2plus:local}"
trap 'rm -rf -- "$BUILD_DIR"' EXIT

echo "--- 1. Pre-flight Environment Check ---"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: node is not installed. Please install Node.js 22.12 or newer."
    exit 1
else
    NODE_VER=$(node -v)
    echo "Found Node.js: $NODE_VER"
fi
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 22 && minor >= 12) || major === 23 ? 0 : 1)'; then
    echo "Error: unsupported Node.js version. Expected >=22.12 and <24."
    exit 1
fi

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed."
    exit 1
else
    NPM_VER=$(npm -v)
    echo "Found npm: $NPM_VER"
fi

# Check for Docker (required for the build-docker step)
if ! command -v docker &> /dev/null; then
    echo "Error: docker is not installed. Required for building the container."
    exit 1
fi
if ! docker info &> /dev/null; then
    echo "Error: the Docker daemon is not reachable."
    exit 1
fi

# Check for Git
if ! command -v git &> /dev/null; then
    echo "Error: git is not installed."
    exit 1
fi

echo "--- 2. Preparing Repository ---"
git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$BUILD_DIR"
cd "$BUILD_DIR"

echo "--- 3. Installing Build Dependencies ---"
# Keep optional packages so the release can select the right platform binaries.
npm ci --include=optional

echo "--- 4. Creating Production Release ---"
# This mirrors the GitHub Action workflow you provided
npm run create-release -- --skip-opt-packages=ffmpeg-static,ffprobe-static --force-opt-packages

echo "--- 5. Building Docker Image (Debian Trixie) ---"
# Match the Dockerfile expectation: rename 'release' to 'pigallery2-release'
if [ -d "release" ]; then
    mv release pigallery2-release
else
    echo "Error: Release folder was not created by gulp."
    exit 1
fi

# You might need to run this with sudo
docker build -t "$IMAGE_NAME" \
             -f docker/debian-trixie/Dockerfile.build .

echo "--- 6. Running Post-Build Diagnostics ---"
# The Dockerfile runs diagnostics during build, but this verifies the final image layer
# You might need to run this with sudo
docker run --rm "$IMAGE_NAME" --run-diagnostics --Server-Log-level=silly

echo "------------------------------------------------"
echo "SUCCESS: $IMAGE_NAME is ready."
echo "------------------------------------------------"
