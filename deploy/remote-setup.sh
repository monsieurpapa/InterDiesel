#!/bin/bash
# Runs ON the server (as root) to install or update Inter-Diesel. Called by oracle-move.sh / update.sh.
set -e
BRANCH="${BRANCH:-interdiesel-app}"
REPO="${REPO:-https://github.com/monsieurpapa/InterDiesel.git}"
IP="$1"
if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi
if ! iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null; then
  iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
  iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
  iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
  netfilter-persistent save || true
fi
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh
if [ ! -d /opt/interdiesel/.git ]; then git clone --branch "$BRANCH" "$REPO" /opt/interdiesel; fi
cd /opt/interdiesel
git fetch -q origin "$BRANCH" && git reset -q --hard "origin/$BRANCH"
mkdir -p data
if [ -f /tmp/interdiesel.sqlite ]; then mv /tmp/interdiesel.sqlite data/interdiesel.sqlite; fi
if [ ! -f .env ]; then
  printf 'DOMAIN=%s.sslip.io\nSEED_STAFF=1\n' "$(echo "$IP" | tr . -)" > .env
fi
nohup docker compose up -d --build > /var/log/interdiesel-build.log 2>&1 &
echo "Construction lancée en arrière-plan (10-25 min). Suivi : sudo tail -f /var/log/interdiesel-build.log"
