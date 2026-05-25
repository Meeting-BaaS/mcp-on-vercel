#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Load environment-specific .env file, falling back to .env
ENV_FILE=".env_${ENVIRON:-}"
if [ -f "$ENV_FILE" ]; then
  echo "[DEBUG] Loading environment variables from $ENV_FILE"
  set -a; source "$ENV_FILE"; set +a
elif [ -f ".env" ]; then
  echo "[DEBUG] Loading environment variables from .env"
  set -a; source .env; set +a
else
  echo "[DEBUG] No .env file found, using existing environment variables"
fi

BEGIN_TS=$(date +%s)

# Must match the Helm chart's image.repository basename (mcp-on-vercel) so the
# pushed image lands at <registry>/<namespace>/mcp-on-vercel:<tag>, where the
# Kubernetes deployment pulls it from. Using a different name (e.g. mcp-server)
# pushes successfully but leaves the pods in ImagePullBackOff.
IMAGE_NAME=mcp-on-vercel

get_image_repo() {
  if [ "${ENVIRON:-}" == "preprod" ]; then
    echo "rg.fr-par.scw.cloud/baas-api-server-preprod"
  elif [ "${ENVIRON:-}" == "prod" ]; then
    echo "rg.fr-par.scw.cloud/meeting-baas-prod-api-server"
  else
    echo "[ERROR] ENVIRON must be either 'preprod' or 'prod'"
    exit 1
  fi
}

validate_environment() {
  if [ -z "${ENVIRON:-}" ]; then
    echo "[ERROR] ENVIRON not specified"
    echo "Usage: ENVIRON=preprod bash ./scripts/deploy.sh"
    exit 1
  fi

  MISSING_VARS=()
  [ -z "${AWS_SECRET_ACCESS_KEY:-}" ] && MISSING_VARS+=(AWS_SECRET_ACCESS_KEY)
  [ -z "${AWS_ACCESS_KEY_ID:-}" ] && MISSING_VARS+=(AWS_ACCESS_KEY_ID)
  if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "[ERROR] Missing required environment variables: ${MISSING_VARS[*]}"
    echo "Please set your Scaleway credentials before running this script."
    exit 1
  fi

  echo "[DEBUG] Scaleway credentials present (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY set)"

  if [ "${ENVIRON:-}" == "prod" ]; then
    echo "[WARNING] You are about to deploy to PRODUCTION!"
    if [[ "${AUTO_CONFIRM:-false}" != "true" ]]; then
      read -rp "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM
      if [ "$CONFIRM" != "yes" ]; then
        echo "[INFO] Production deployment cancelled."
        exit 0
      fi
    fi
  fi
}

deploy() {
  local IMAGE_REPO
  IMAGE_REPO=$(get_image_repo)
  local GIT_HASH
  GIT_HASH=$(git rev-parse HEAD)
  local DATE_TAG
  DATE_TAG=$(date +%Y-%m-%d)
  local IMAGE_TAG=${DATE_TAG}-${GIT_HASH}
  local TARGET_PLATFORM="linux/${TARGET_ARCH}"

  # In --upload mode the image was already built locally (verified below); skip
  # the build and only tag + push it.
  if [[ "$MODE" != "upload" ]]; then
    echo "[DEBUG] Building $IMAGE_NAME for platform: $TARGET_PLATFORM..."
    if ! docker build \
      --platform="$TARGET_PLATFORM" \
      -f Dockerfile . \
      --tag="$IMAGE_NAME:$IMAGE_TAG"; then
      echo "[ERROR] Docker build failed. Aborting."
      exit 1
    fi
  else
    echo "[DEBUG] --upload mode: skipping build, using existing $IMAGE_NAME:$IMAGE_TAG"
  fi

  local remote_image_tagged="$IMAGE_REPO/$IMAGE_NAME:$IMAGE_TAG"
  docker tag "$IMAGE_NAME:$IMAGE_TAG" "$remote_image_tagged"

  echo "[DEBUG] Logging in to Scaleway Container Registry..."
  if ! echo "$AWS_SECRET_ACCESS_KEY" | docker login rg.fr-par.scw.cloud -u _token --password-stdin; then
    echo "[ERROR] Docker login failed. Aborting."
    exit 1
  fi

  echo "[DEBUG] Pushing image to $remote_image_tagged..."
  if ! docker push "$remote_image_tagged"; then
    echo "[ERROR] Failed to push Docker image. Aborting."
    exit 1
  fi

  echo "[SUCCESS] MCP Server image pushed successfully!"
  echo "IMAGE_TAG=$IMAGE_TAG"
  echo "IMAGE=$remote_image_tagged"
}

# Parse arguments
MODE="build"
AUTO_CONFIRM=false
TARGET_ARCH="${TARGET_ARCH:-amd64}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --build|--deploy)
      MODE="build"
      shift
      ;;
    --upload)
      MODE="upload"
      shift
      ;;
    --yes)
      AUTO_CONFIRM=true
      shift
      ;;
    --arch)
      TARGET_ARCH="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ENVIRON=preprod bash ./scripts/deploy.sh [--build|--upload] [--arch amd64|arm64] [--yes]"
      exit 1
      ;;
  esac
done

if [[ "$TARGET_ARCH" != "amd64" && "$TARGET_ARCH" != "arm64" ]]; then
  echo "[ERROR] Invalid architecture: $TARGET_ARCH. Supported: amd64, arm64"
  exit 1
fi

echo "[DEBUG] Target architecture: $TARGET_ARCH (platform: linux/$TARGET_ARCH)"

validate_environment

# Check local image exists for upload-only mode
if [[ "$MODE" == "upload" ]]; then
  GIT_HASH=$(git rev-parse HEAD)
  DATE_TAG=$(date +%Y-%m-%d)
  IMAGE_TAG=${DATE_TAG}-${GIT_HASH}
  if ! docker images | grep -q "$IMAGE_NAME.*$IMAGE_TAG"; then
    echo "[ERROR] Docker image $IMAGE_NAME:$IMAGE_TAG not found locally."
    exit 1
  fi
fi

deploy

TOTAL_TS=$(date +%s)
echo "Total duration $((TOTAL_TS - BEGIN_TS)) seconds"
