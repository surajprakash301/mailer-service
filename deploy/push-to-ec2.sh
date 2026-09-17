#!/usr/bin/env bash
# Run from your Mac: copy app + .env to EC2 and remote-run setup.
# Usage:
#   ./deploy/push-to-ec2.sh ec2-user@PUBLIC_IP /path/to/emailer_pair_key.pem
set -euo pipefail

TARGET="${1:?usage: $0 user@host /path/to/key.pem}"
KEY="${2:?usage: $0 user@host /path/to/key.pem}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o IdentitiesOnly=yes "$TARGET" 'sudo mkdir -p /opt/mailer && sudo chown -R $(whoami) /opt/mailer'
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude data/leads.json \
  --exclude '.env' \
  -e "ssh -i $KEY -o IdentitiesOnly=yes" \
  "$ROOT/" "$TARGET:/opt/mailer/"

if [[ -f "$ROOT/.env" ]]; then
  # Ship env with DATA_DIR forced for container mount
  scp -i "$KEY" -o IdentitiesOnly=yes "$ROOT/.env" "$TARGET:/opt/mailer/.env.localcopy"
  ssh -i "$KEY" -o IdentitiesOnly=yes "$TARGET" 'cd /opt/mailer && cp .env.localcopy .env && (grep -q "^DATA_DIR=" .env && sed -i.bak "s|^DATA_DIR=.*|DATA_DIR=/data|" .env || echo "DATA_DIR=/data" >> .env) && rm -f .env.bak .env.localcopy'
fi

ssh -i "$KEY" -o IdentitiesOnly=yes "$TARGET" 'sudo bash /opt/mailer/deploy/ec2-setup.sh'
echo "Verify: curl -s http://${TARGET#*@}:8787/api/health"
