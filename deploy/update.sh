#!/bin/bash
# Run in Oracle Cloud Shell after pushing new code to GitHub: updates the server, data kept.
set -e
source ~/interdiesel.env
curl -fsSL https://raw.githubusercontent.com/monsieurpapa/InterDiesel/interdiesel-app/deploy/remote-setup.sh | ssh ubuntu@$IP "sudo bash -s $IP"
