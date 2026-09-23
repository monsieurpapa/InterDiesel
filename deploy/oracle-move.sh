#!/bin/bash
# Run in Oracle Cloud Shell. Moves Inter-Diesel to a new free server that has SSH access
# (for updates) and a fixed public IP, keeping all data (backup downloaded from the old server).
set -e
C=$OCI_TENANCY
OLD_IP="${OLD_IP:-84.12.76.130}"
RAW=https://raw.githubusercontent.com/monsieurpapa/InterDiesel/interdiesel-app/deploy
read -p "Identifiant proprietaire: " OU
read -s -p "Mot de passe proprietaire: " OP; echo
printf '{"username":"%s","password":"%s"}' "$OU" "$OP" > .cred.json; unset OP
curl -fsS -X POST "https://${OLD_IP//./-}.sslip.io/api/admin/backup" -H 'content-type: application/json' --data @.cred.json -o backup.sqlite || true
rm -f .cred.json
head -c 15 backup.sqlite 2>/dev/null | grep -q "SQLite format 3" || { echo "ERREUR: sauvegarde impossible (identifiant ou mot de passe ?)"; exit 1; }
echo "Sauvegarde OK ($(du -h backup.sqlite | cut -f1))"
[ -f ~/.ssh/id_ed25519 ] || ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519 -q
AD=$(oci iam availability-domain list -c $C --query 'data[0].name' --raw-output)
SUB=$(oci network subnet list -c $C --display-name interdiesel-subnet --query 'data[0].id' --raw-output)
IMG=$(oci compute image list -c $C --operating-system "Canonical Ubuntu" --operating-system-version "22.04" --shape VM.Standard.E2.1.Micro --sort-by TIMECREATED --query 'data[0].id' --raw-output)
echo "Creation du nouveau serveur..."
ID=$(oci compute instance launch -c $C --availability-domain $AD --shape VM.Standard.E2.1.Micro --image-id $IMG --subnet-id $SUB --assign-public-ip false --ssh-authorized-keys-file ~/.ssh/id_ed25519.pub --display-name interdiesel-prod --wait-for-state RUNNING --query data.id --raw-output 2>/dev/null)
VNIC=$(oci compute instance list-vnics --instance-id $ID --query 'data[0].id' --raw-output)
PRIVID=$(oci network private-ip list --vnic-id $VNIC --query 'data[0].id' --raw-output)
IP=$(oci network public-ip create -c $C --lifetime RESERVED --display-name interdiesel-ip --private-ip-id $PRIVID --wait-for-state ASSIGNED --query 'data."ip-address"' --raw-output 2>/dev/null)
printf 'IP=%s\nINSTANCE=%s\n' "$IP" "$ID" > ~/interdiesel.env
echo "IP fixe: $IP. Attente SSH..."
for i in $(seq 1 60); do ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 ubuntu@$IP true 2>/dev/null && break; sleep 10; done
scp -q backup.sqlite ubuntu@$IP:/tmp/interdiesel.sqlite
curl -fsSL $RAW/remote-setup.sh | ssh ubuntu@$IP "sudo bash -s $IP"
echo "NOUVELLE ADRESSE: https://${IP//./-}.sslip.io  (prete dans ~20 min)"
