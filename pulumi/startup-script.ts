/**
 * Runs as root on every boot of the VM. It prepares the machine only, then hands over to configs/setup-vm.sh:
 *   1. Formats the data disk once and mounts it on /mnt/data.
 *   2. Puts everything that grows on the data disk: Docker, containerd, swap. The boot disk keeps only the OS and settings, so it cannot fill up.
 *   3. Turns on automatic security updates for Debian and Docker.
 *   4. Clones the repository and runs configs/setup-vm.sh.
 *
 * Every step checks before it acts, so running it again changes nothing.
 * Settings come from instance metadata (vm.ts), so changing them does not change this script.
 */
export const startupScript = (dataDeviceName: string) => `#!/bin/bash
set -euxo pipefail

md() { curl -sf -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }

# --- SSH: keys only (OS Login manages them through IAM) ---
cat > /etc/ssh/sshd_config.d/99-hardening.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
systemctl reload ssh || true

# --- keep the boot disk small ---
cat > /etc/cron.weekly/apt-cleanup <<'EOF'
#!/bin/sh
set -e
apt-get autoremove --purge -y
apt-get autoclean -y
EOF
chmod +x /etc/cron.weekly/apt-cleanup

# The journal would otherwise grow to 10% of the disk.
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/50-limits.conf <<'EOF'
[Journal]
SystemMaxUse=500M
SystemKeepFree=1G
EOF
systemctl restart systemd-journald || true

# --- data disk (before Docker, whose data lives there) ---
DEVICE=/dev/disk/by-id/google-${dataDeviceName}
MOUNT=/mnt/data
mkdir -p "$MOUNT"
if ! blkid "$DEVICE" >/dev/null 2>&1; then
  mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$DEVICE"
fi
grep -q " $MOUNT " /etc/fstab || echo "$DEVICE $MOUNT ext4 discard,defaults,nofail 0 2" >> /etc/fstab
mount -a
# Never start Docker without the data disk: its data would land on the boot disk.
mountpoint -q "$MOUNT" || { echo "FATAL: $MOUNT is not mounted" >&2; exit 1; }
# Growing the disk (dataDiskGb) does not grow the file system on it. This catches up at boot and does nothing when the sizes already match.
resize2fs "$DEVICE"
mkdir -p "$MOUNT/docker" "$MOUNT/containerd"
touch "$MOUNT/.MOUNTED"

# containerd keeps its own copy of every pulled image under /var/lib/containerd, outside Docker's data-root. Without this bind mount, pulls fill the boot disk even with data-root moved.
if ! grep -q "^$MOUNT/containerd /var/lib/containerd " /etc/fstab; then
  mkdir -p /var/lib/containerd
  echo "$MOUNT/containerd /var/lib/containerd none bind 0 0" >> /etc/fstab
  mount /var/lib/containerd
fi

if [ ! -f "$MOUNT/swapfile" ]; then
  fallocate -l 2G "$MOUNT/swapfile"
  chmod 600 "$MOUNT/swapfile"
  mkswap "$MOUNT/swapfile"
fi
grep -q "$MOUNT/swapfile" /etc/fstab || echo "$MOUNT/swapfile none swap sw 0 0" >> /etc/fstab
swapon -a

# --- Docker: data on the data disk, logs rotated ---
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "data-root": "/mnt/data/docker",
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF

# https://docs.docker.com/engine/install/debian/
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# --- automatic security updates: Debian security and the Docker engine ---
# Reboots at 20:00 UTC only when an update needs it (a new kernel). This script and setup-vm.sh bring Windmill back after the reboot.
command -v unattended-upgrade >/dev/null 2>&1 || apt-get install -y unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52windmill-upgrades <<'EOF'
Unattended-Upgrade::Origins-Pattern {
  "origin=Debian,codename=\${distro_codename}-security,label=Debian-Security";
  "origin=Docker,codename=\${distro_codename}";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "20:00";
EOF

# --- Ops Agent: disk and memory metrics for the alerts ---
# https://cloud.google.com/monitoring/agent/ops-agent/installation
if ! systemctl is-active --quiet google-cloud-ops-agent; then
  curl -sSO https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  bash add-google-cloud-ops-agent-repo.sh --also-install || true
  rm -f add-google-cloud-ops-agent-repo.sh
fi

# --- the application ---
REPO_URL=$(md wm-repo-url)
REPO_BRANCH=$(md wm-repo-branch)

# A private repository (an SSH URL) is cloned with a read-only deploy key. The key lives on the data disk, so a rebuilt VM keeps using the key already registered on GitHub.
case "$REPO_URL" in
  git@*|ssh://*)
    install -d -m 700 /root/.ssh "$MOUNT/ssh"
    if [ ! -f "$MOUNT/ssh/id_ed25519" ]; then
      ssh-keygen -t ed25519 -N "" -f "$MOUNT/ssh/id_ed25519" -C "windmill-vm"
    fi
    ln -sfn "$MOUNT/ssh/id_ed25519" /root/.ssh/id_ed25519
    ln -sfn "$MOUNT/ssh/id_ed25519.pub" /root/.ssh/id_ed25519.pub
    grep -q "^github.com " /root/.ssh/known_hosts 2>/dev/null || ssh-keyscan github.com >> /root/.ssh/known_hosts
    # Published as a guest attribute, so the operator can read it with one gcloud command (pulumi stack output deployKeyCommand).
    curl -sf -X PUT -H 'Metadata-Flavor: Google' --data-binary @"$MOUNT/ssh/id_ed25519.pub" \\
      http://metadata.google.internal/computeMetadata/v1/instance/guest-attributes/windmill/deploy-key || true
    ;;
esac

if [ ! -d /opt/windmill/.git ]; then
  # Until the deploy key is registered the clone fails. Keep trying for an hour, so registering the key is all it takes; after that, a reboot starts over.
  for _ in $(seq 1 120); do
    git clone --branch "$REPO_BRANCH" "$REPO_URL" /opt/windmill && break
    echo "clone failed; for a private repository, add the deploy key on GitHub (pulumi stack output deployKeyCommand)" >&2
    rm -rf /opt/windmill
    sleep 30
  done
  [ -d /opt/windmill/.git ] || { echo "FATAL: could not clone $REPO_URL" >&2; exit 1; }
fi
git -C /opt/windmill remote set-url origin "$REPO_URL"

# Used only when .env does not exist yet.
INIT_WINDMILL_DOMAIN=$(md wm-domain); export INIT_WINDMILL_DOMAIN
INIT_COMPOSE_PROFILES=$(md wm-profiles); export INIT_COMPOSE_PROFILES
INIT_BACKUP_BUCKET=$(md wm-backup-bucket); export INIT_BACKUP_BUCKET
/opt/windmill/configs/setup-vm.sh
`;
