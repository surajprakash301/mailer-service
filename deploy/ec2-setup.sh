#!/usr/bin/env bash
# Bootstrap / update Loky mailer on an EC2 host (run ON the server as root or with sudo).
# Usage: sudo bash deploy/ec2-setup.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/surajprakash301/mailer-service.git}"
APP_DIR="${APP_DIR:-/opt/mailer}"
BRANCH="${BRANCH:-main}"

echo "==> Installing Docker if needed"
if ! command -v docker >/dev/null 2>&1; then
  if command -v yum >/dev/null 2>&1; then
    yum install -y docker git
    systemctl enable --now docker
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y docker git
    systemctl enable --now docker
  elif command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y ca-certificates curl git
    install -m 0755 -d /etc/apt/keyrings
    if [[ ! -f /etc/apt/keyrings/docker.asc ]]; then
      curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
      chmod a+r /etc/apt/keyrings/docker.asc
    fi
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    systemctl enable --now docker
  else
    echo "Unsupported package manager. Install Docker manually, then re-run."
    exit 1
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  if command -v yum >/dev/null 2>&1 || command -v dnf >/dev/null 2>&1; then
    # Amazon Linux often needs the compose plugin via docker package or standalone binary
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-$(uname -m)" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  fi
fi

echo "==> App directory ${APP_DIR}"
mkdir -p "${APP_DIR}"
if [[ -d "${APP_DIR}/.git" ]]; then
  git -C "${APP_DIR}" fetch origin
  git -C "${APP_DIR}" checkout "${BRANCH}"
  git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"
else
  git clone --branch "${BRANCH}" "${REPO_URL}" "${APP_DIR}"
fi

mkdir -p "${APP_DIR}/data"

if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "==> Creating ${APP_DIR}/.env from .env.example (EDIT SECRETS before production)"
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
  # Force container data path
  if grep -q '^DATA_DIR=' "${APP_DIR}/.env"; then
    sed -i.bak 's|^DATA_DIR=.*|DATA_DIR=/data|' "${APP_DIR}/.env" && rm -f "${APP_DIR}/.env.bak"
  else
    echo 'DATA_DIR=/data' >> "${APP_DIR}/.env"
  fi
  echo "WARNING: Fill OPENAI_API_KEY, RESEND_API_KEY, CRON_SECRET in ${APP_DIR}/.env"
fi

cd "${APP_DIR}"
echo "==> Building and starting containers"
docker compose up -d --build

echo "==> Health"
sleep 3
curl -fsS "http://127.0.0.1:8787/api/health" || true
echo
echo "Done. Persist leads in ${APP_DIR}/data. Open SG TCP 8787 or reverse-proxy via nginx."
