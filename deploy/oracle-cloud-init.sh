#!/bin/bash
# Oracle Cloud "Always Free" VM setup for Inter-Diesel (Ubuntu 22.04/24.04).
# Paste this whole file in: Create instance > Show advanced options > Management >
# "Paste cloud-init script". Fill the 3 OWNER_ values first. Takes ~15 minutes after boot.
# The app is then at https://<public-ip-with-dashes>.sslip.io  (e.g. https://141-147-1-2.sslip.io)
OWNER_NAME="Propriétaire"
OWNER_USERNAME="proprietaire"
OWNER_PASSWORD="CHANGE-ME-8+chars"
OWNER_PIN="1111"
RATE="2300"
BRANCH="interdiesel-app"
REPO="https://github.com/monsieurpapa/InterDiesel.git"

set -eux
exec > /var/log/interdiesel-setup.log 2>&1

# 1. Swap: lets the 1 GB "micro" VM build the app
if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi

# 2. Open ports 80/443 (Oracle Ubuntu images block them in iptables by default)
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
netfilter-persistent save || true

# 3. Docker
curl -fsSL https://get.docker.com | sh

# 4. App
git clone --branch "$BRANCH" "$REPO" /opt/interdiesel
cd /opt/interdiesel
IP=$(curl -s https://api.ipify.org)
cat > .env <<ENV
DOMAIN=$(echo "$IP" | tr . -).sslip.io
OWNER_NAME=$OWNER_NAME
OWNER_USERNAME=$OWNER_USERNAME
OWNER_PASSWORD=$OWNER_PASSWORD
OWNER_PIN=$OWNER_PIN
RATE=$RATE
ENV
docker compose up -d --build

# 5. Once the owner account exists, remove the password from the settings file
for i in $(seq 1 60); do
  if docker compose logs app 2>/dev/null | grep -q "Compte propriétaire créé\|en marche"; then break; fi
  sleep 10
done
sed -i '/^OWNER_PASSWORD=/d' .env
echo "READY: https://$(echo "$IP" | tr . -).sslip.io"
