#!/bin/bash
set -euo pipefail

echo "=== Deploying Multibagger to OCI ==="

# Pull latest code
git pull origin main

# Copy service files to systemd
sudo cp deploy/multibagger-paper.service /etc/systemd/system/

# Reload systemd to recognize new config
sudo systemctl daemon-reload

# Reset failure counter
sudo systemctl reset-failed multibagger-paper

# Restart bot
sudo systemctl restart multibagger-paper

# Verify status
sudo systemctl status multibagger-paper --no-pager

echo "=== Deployment complete ==="
echo "Check logs: sudo journalctl -u multibagger-paper -f"
