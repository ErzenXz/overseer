#!/bin/bash

#################################################
# Overseer Installation Script
# Self-hosted AI Agent with Full VPS Access
#
# SAFE INSTALLATION:
#   - Uses a random high port for admin dashboard
#   - Configures UFW WITHOUT breaking existing rules
#   - NEVER blocks port 22 (SSH)
#   - Installs fail2ban for security
#   - Detects existing services and avoids conflicts
#   - Non-destructive: works on fresh AND existing VPS
#
# Supports: Ubuntu/Debian, CentOS/RHEL/Fedora,
#           macOS, Windows (via WSL2)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ErzenXz/overseer/main/scripts/install.sh | bash
#   
#   # With options:
#   OVERSEER_PORT=8080 bash install.sh
#################################################

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'
DIM='\033[2m'

# Configuration
OVERSEER_VERSION="${OVERSEER_VERSION:-main}"
OVERSEER_DIR="${OVERSEER_DIR:-$HOME/overseer}"
OVERSEER_REPO="${OVERSEER_REPO:-https://github.com/ErzenXz/overseer.git}"
OVERSEER_USER="${OVERSEER_USER:-$USER}"
NODE_VERSION="20"
MIN_MEMORY_MB=512
MIN_DISK_GB=1
OVERSEER_DOMAIN="${OVERSEER_DOMAIN:-}"
OVERSEER_TLS_EMAIL="${OVERSEER_TLS_EMAIL:-}"
OVERSEER_ENABLE_TLS="${OVERSEER_ENABLE_TLS:-false}"
OVERSEER_ADMIN_USERNAME="${OVERSEER_ADMIN_USERNAME:-admin}"
OVERSEER_ADMIN_PASSWORD="${OVERSEER_ADMIN_PASSWORD:-}"
OVERSEER_ENABLE_AUTO_SECURITY_UPDATES="${OVERSEER_ENABLE_AUTO_SECURITY_UPDATES:-true}"
OVERSEER_ENABLE_AUTO_APP_UPDATES="${OVERSEER_ENABLE_AUTO_APP_UPDATES:-true}"
OVERSEER_AUTO_UPDATE_SCHEDULE="${OVERSEER_AUTO_UPDATE_SCHEDULE:-daily}"

# Will be set dynamically
OVERSEER_PORT=""
ADMIN_PASSWORD=""
SESSION_SECRET=""
ENCRYPTION_KEY=""

# Script flags
SHOW_HELP=0
DRY_RUN=0
NON_INTERACTIVE=0

# =========================================
# CLI / Flags
# =========================================

usage() {
    cat <<'EOF'
Overseer Installation Script

Usage:
  bash install.sh [--help] [--dry-run] [--yes]

Options:
  -h, --help       Show this help and exit
  --dry-run        Print what would happen, without making changes
  -y, --yes        Non-interactive mode (skip prompts where possible)

Environment:
  OVERSEER_DIR=/path/to/install
  OVERSEER_VERSION=main|tag|branch
  OVERSEER_REPO=https://github.com/.../overseer.git
  OVERSEER_PORT=3000 (optional; random high port by default)

Notes:
  This script is designed to be safe on existing VPS installs. It will:
  - never block SSH (22/tcp)
  - avoid conflicting ports by default
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            -h|--help)
                SHOW_HELP=1
                shift
                ;;
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            -y|--yes)
                NON_INTERACTIVE=1
                shift
                ;;
            *)
                echo "Unknown option: $1" >&2
                usage >&2
                exit 2
                ;;
        esac
    done
}

# =========================================
# Utility Functions
# =========================================

print_banner() {
    echo -e "${PURPLE}"
    cat << 'BANNER'
    ____                                     
   / __ \__   _____  _____________  ___  _____
  / / / / | / / _ \/ ___/ ___/ _ \/ _ \/ ___/
 / /_/ /| |/ /  __/ /  (__  )  __/  __/ /    
 \____/ |___/\___/_/  /____/\___/\___/_/     
BANNER
    echo -e "${NC}"
    echo -e "${CYAN}  Self-hosted AI Agent with Full VPS Access${NC}"
    echo -e "${DIM}  Open-source alternative to OpenClaw${NC}"
    echo ""
}

print_step() {
    echo -e "\n${BLUE}==>${NC} ${BOLD}$1${NC}"
}

print_substep() {
    echo -e "    ${CYAN}>${NC} $1"
}

print_warning() {
    echo -e "    ${YELLOW}! Warning:${NC} $1"
}

print_error() {
    echo -e "    ${RED}x Error:${NC} $1"
}

print_success() {
    echo -e "    ${GREEN}+ $1${NC}"
}

print_info() {
    echo -e "    ${DIM}$1${NC}"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

is_root() {
    [ "$(id -u)" -eq 0 ]
}

sudo_cmd() {
    if is_root; then
        "$@"
    else
        sudo "$@"
    fi
}

# =========================================
# OS Detection
# =========================================

detect_os() {
    OS="unknown"
    OS_VERSION=""
    OS_FAMILY=""
    PKG_MANAGER="unknown"

    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            OS=$ID
            OS_VERSION=$VERSION_ID
            OS_FAMILY="${ID_LIKE:-$ID}"
        elif [ -f /etc/redhat-release ]; then
            OS="rhel"
        elif [ -f /etc/debian_version ]; then
            OS="debian"
        else
            OS="linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        OS_VERSION=$(sw_vers -productVersion 2>/dev/null || echo "unknown")
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
        OS="wsl"
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            OS=$ID
        fi
    fi

    # Detect package manager
    if command_exists apt-get; then
        PKG_MANAGER="apt"
    elif command_exists dnf; then
        PKG_MANAGER="dnf"
    elif command_exists yum; then
        PKG_MANAGER="yum"
    elif command_exists pacman; then
        PKG_MANAGER="pacman"
    elif command_exists brew; then
        PKG_MANAGER="brew"
    fi
}

# =========================================
# Port Management - SAFE random port selection
# =========================================

generate_random_port() {
    # Generate a random port between 10000-60000
    # Avoids common service ports and stays in unprivileged range
    local port
    local max_attempts=50

    for ((i=0; i<max_attempts; i++)); do
        port=$(( (RANDOM % 50000) + 10000 ))
        
        # Check if port is in use
        if ! is_port_in_use "$port"; then
            echo "$port"
            return 0
        fi
    done

    # Fallback: find any available port
    for port in $(seq 10000 60000 | shuf | head -20); do
        if ! is_port_in_use "$port"; then
            echo "$port"
            return 0
        fi
    done

    echo "10847" # Last resort fallback
}

is_port_in_use() {
    local port=$1
    if command_exists ss; then
        ss -tlnp 2>/dev/null | grep -q ":${port} " && return 0
    elif command_exists netstat; then
        netstat -tlnp 2>/dev/null | grep -q ":${port} " && return 0
    elif command_exists lsof; then
        lsof -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    fi
    return 1
}

# =========================================
# Service Detection - Don't break existing services!
# =========================================

detect_existing_services() {
    print_step "Detecting existing services on this VPS..."
    
    local services_found=0

    # Check common web servers
    if command_exists nginx && systemctl is-active --quiet nginx 2>/dev/null; then
        print_info "Found: nginx (running)"
        services_found=$((services_found + 1))
    fi

    if command_exists apache2 && systemctl is-active --quiet apache2 2>/dev/null; then
        print_info "Found: Apache2 (running)"
        services_found=$((services_found + 1))
    fi

    if command_exists caddy && systemctl is-active --quiet caddy 2>/dev/null; then
        print_info "Found: Caddy (running)"
        services_found=$((services_found + 1))
    fi

    # Check for Docker
    if command_exists docker && systemctl is-active --quiet docker 2>/dev/null; then
        local containers=$(docker ps -q 2>/dev/null | wc -l)
        print_info "Found: Docker (${containers} running containers)"
        services_found=$((services_found + 1))
    fi

    # Check for databases
    if systemctl is-active --quiet postgresql 2>/dev/null; then
        print_info "Found: PostgreSQL (running)"
        services_found=$((services_found + 1))
    fi

    if systemctl is-active --quiet mysql 2>/dev/null || systemctl is-active --quiet mariadb 2>/dev/null; then
        print_info "Found: MySQL/MariaDB (running)"
        services_found=$((services_found + 1))
    fi

    if systemctl is-active --quiet redis 2>/dev/null || systemctl is-active --quiet redis-server 2>/dev/null; then
        print_info "Found: Redis (running)"
        services_found=$((services_found + 1))
    fi

    # Check for existing Node.js apps (PM2)
    if command_exists pm2; then
        local pm2_apps=$(pm2 list 2>/dev/null | grep -c "online" || echo "0")
        if [ "$pm2_apps" -gt 0 ]; then
            print_info "Found: PM2 with ${pm2_apps} running apps"
            services_found=$((services_found + 1))
        fi
    fi

    # Check for existing UFW rules
    if command_exists ufw; then
        local ufw_status=$(sudo_cmd ufw status 2>/dev/null | head -1 || echo "unknown")
        print_info "UFW status: ${ufw_status}"
    fi

    if [ $services_found -gt 0 ]; then
        echo ""
        print_warning "Found ${services_found} existing service(s) on this VPS."
        print_info "Overseer will use a random port to avoid conflicts."
        print_info "Your existing services will NOT be modified or affected."
        echo ""
    else
        print_success "Clean VPS detected - no existing services found."
    fi

    return 0
}

# =========================================
# SAFE UFW Configuration
# =========================================

configure_ufw_safe() {
    if [[ "$OS" == "macos" ]] || ! command_exists ufw; then
        return 0
    fi

    print_step "Configuring UFW firewall (safe mode)..."

    # CRITICAL: Always ensure SSH is allowed BEFORE enabling UFW
    print_substep "Ensuring SSH access is preserved..."
    
    # Allow SSH on port 22 (standard) - ALWAYS
    sudo_cmd ufw allow 22/tcp comment "SSH - NEVER REMOVE" 2>/dev/null || true
    print_success "Port 22 (SSH) - allowed"

    # Also allow SSH on any custom port if sshd is configured differently
    local ssh_port=$(grep -E "^Port " /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' || echo "22")
    if [ "$ssh_port" != "22" ] && [ -n "$ssh_port" ]; then
        sudo_cmd ufw allow "${ssh_port}/tcp" comment "Custom SSH port" 2>/dev/null || true
        print_success "Port ${ssh_port} (custom SSH) - allowed"
    fi

    # Allow Overseer admin panel port
    sudo_cmd ufw allow "${OVERSEER_PORT}/tcp" comment "Overseer Admin Dashboard" 2>/dev/null || true
    print_success "Port ${OVERSEER_PORT} (Overseer Admin) - allowed"

    # Check if UFW is already enabled
    local ufw_status=$(sudo_cmd ufw status 2>/dev/null | head -1 || echo "")
    
    if echo "$ufw_status" | grep -qi "active"; then
        print_info "UFW is already active - only added Overseer rules"
    else
        # Enable UFW with --force to avoid interactive prompt
        # But ONLY after ensuring SSH is allowed
        print_substep "Enabling UFW..."
        
        # Double-check SSH is in the rules before enabling
        local ssh_rule=$(sudo_cmd ufw status 2>/dev/null | grep "22/tcp" || echo "")
        if [ -z "$ssh_rule" ]; then
            print_error "SSH rule not found! Aborting UFW enable for safety."
            print_warning "Please manually run: sudo ufw allow 22/tcp && sudo ufw enable"
            return 0
        fi

        sudo_cmd ufw --force enable 2>/dev/null || true
        print_success "UFW enabled with safe defaults"
    fi

    # Show current rules
    print_substep "Current UFW rules:"
    sudo_cmd ufw status numbered 2>/dev/null | head -20 | while read -r line; do
        print_info "  $line"
    done
}

# =========================================
# SAFE fail2ban Installation
# =========================================

install_fail2ban() {
    if [[ "$OS" == "macos" ]]; then
        return 0
    fi

    print_step "Setting up fail2ban for security..."

    if command_exists fail2ban-client; then
        print_success "fail2ban already installed"
    else
        print_substep "Installing fail2ban..."
        case "$PKG_MANAGER" in
            apt)
                sudo_cmd apt-get install -y fail2ban >/dev/null 2>&1 || {
                    print_warning "Could not install fail2ban (non-critical)"
                    return 0
                }
                ;;
            dnf)
                sudo_cmd dnf install -y fail2ban >/dev/null 2>&1 || {
                    print_warning "Could not install fail2ban (non-critical)"
                    return 0
                }
                ;;
            yum)
                sudo_cmd yum install -y epel-release >/dev/null 2>&1 || true
                sudo_cmd yum install -y fail2ban >/dev/null 2>&1 || {
                    print_warning "Could not install fail2ban (non-critical)"
                    return 0
                }
                ;;
            *)
                print_warning "Skipping fail2ban - unsupported package manager"
                return 0
                ;;
        esac
        print_success "fail2ban installed"
    fi

    # Create a safe jail.local config (don't overwrite existing)
    local jail_file="/etc/fail2ban/jail.local"
    if [ ! -f "$jail_file" ]; then
        sudo_cmd tee "$jail_file" > /dev/null << 'JAIL_EOF'
# Overseer fail2ban configuration
# This file adds Overseer-specific protections without affecting existing jails

[DEFAULT]
# Ban for 10 minutes
bantime = 600
# Find 5 failures within 10 minutes
findtime = 600
maxretry = 5
# Don't ban localhost
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
maxretry = 5
JAIL_EOF
        print_success "fail2ban configured with safe defaults"
    else
        print_info "Existing jail.local found - not modifying"
    fi

    # Start/restart fail2ban
    sudo_cmd systemctl enable fail2ban 2>/dev/null || true
    sudo_cmd systemctl restart fail2ban 2>/dev/null || true
    print_success "fail2ban is active"
}

# =========================================
# Automatic OS Security Updates
# =========================================

configure_auto_security_updates() {
    if [ "${OVERSEER_ENABLE_AUTO_SECURITY_UPDATES}" != "true" ]; then
        print_info "Automatic OS security updates disabled by configuration"
        return 0
    fi

    if [[ "$OS" == "macos" ]] || [[ "${OS:-}" == "wsl" ]]; then
        return 0
    fi

    print_step "Configuring automatic OS security updates..."

    case "$PKG_MANAGER" in
        apt)
            sudo_cmd apt-get install -y unattended-upgrades apt-listchanges >/dev/null 2>&1 || {
                print_warning "Could not install unattended-upgrades"
                return 0
            }

            sudo_cmd tee /etc/apt/apt.conf.d/20auto-upgrades > /dev/null << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
EOF

            sudo_cmd tee /etc/apt/apt.conf.d/52overseer-unattended-upgrades > /dev/null << 'EOF'
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
EOF

            sudo_cmd systemctl enable unattended-upgrades >/dev/null 2>&1 || true
            sudo_cmd systemctl restart unattended-upgrades >/dev/null 2>&1 || true
            print_success "unattended-upgrades configured"
            ;;
        dnf)
            sudo_cmd dnf install -y dnf-automatic >/dev/null 2>&1 || {
                print_warning "Could not install dnf-automatic"
                return 0
            }
            sudo_cmd sed -i 's/^apply_updates = .*/apply_updates = yes/' /etc/dnf/automatic.conf 2>/dev/null || true
            sudo_cmd sed -i 's/^upgrade_type = .*/upgrade_type = security/' /etc/dnf/automatic.conf 2>/dev/null || true
            sudo_cmd systemctl enable dnf-automatic.timer >/dev/null 2>&1 || true
            sudo_cmd systemctl restart dnf-automatic.timer >/dev/null 2>&1 || true
            print_success "dnf-automatic security updates configured"
            ;;
        yum)
            sudo_cmd yum install -y yum-cron >/dev/null 2>&1 || {
                print_warning "Could not install yum-cron"
                return 0
            }
            sudo_cmd sed -i 's/^apply_updates = .*/apply_updates = yes/' /etc/yum/yum-cron.conf 2>/dev/null || true
            sudo_cmd systemctl enable yum-cron >/dev/null 2>&1 || true
            sudo_cmd systemctl restart yum-cron >/dev/null 2>&1 || true
            print_success "yum-cron auto updates configured"
            ;;
        *)
            print_warning "Auto security updates not supported for package manager: ${PKG_MANAGER}"
            ;;
    esac
}

# =========================================
# Automatic Overseer Application Updates
# =========================================

configure_auto_app_updates() {
    if [ "${OVERSEER_ENABLE_AUTO_APP_UPDATES}" != "true" ]; then
        print_info "Automatic Overseer app updates disabled by configuration"
        return 0
    fi

    if [[ "$OS" == "macos" ]] || [[ "${OS:-}" == "wsl" ]]; then
        return 0
    fi

    if ! command_exists systemctl; then
        print_warning "systemctl not available; skipping app update timer"
        return 0
    fi

    print_step "Configuring automatic Overseer app updates..."

    local update_script="/usr/local/bin/overseer-auto-update"
    local pnpm_path=$(which pnpm 2>/dev/null || echo "")
    local npm_path=$(which npm)

    sudo_cmd tee "$update_script" > /dev/null << EOF
#!/bin/bash
set -euo pipefail
cd "${OVERSEER_DIR}"

git fetch origin "${OVERSEER_VERSION}" >/dev/null 2>&1
LOCAL=\$(git rev-parse HEAD)
REMOTE=\$(git rev-parse "origin/${OVERSEER_VERSION}")

if [ "\$LOCAL" = "\$REMOTE" ]; then
  exit 0
fi

git reset --hard "origin/${OVERSEER_VERSION}" >/dev/null 2>&1
if [ -n "${pnpm_path}" ]; then
  "${pnpm_path}" install --no-frozen-lockfile >/dev/null 2>&1
  "${pnpm_path}" run build >/dev/null 2>&1
else
  "${npm_path}" install >/dev/null 2>&1
  "${npm_path}" run build >/dev/null 2>&1
fi

systemctl restart overseer >/dev/null 2>&1 || true
systemctl restart overseer-telegram >/dev/null 2>&1 || true
systemctl restart overseer-discord >/dev/null 2>&1 || true
systemctl restart overseer-whatsapp >/dev/null 2>&1 || true
EOF

    sudo_cmd chmod +x "$update_script"

    sudo_cmd tee /etc/systemd/system/overseer-auto-update.service > /dev/null << EOF
[Unit]
Description=Automatic Overseer application update
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=${OVERSEER_USER}
ExecStart=${update_script}
EOF

    sudo_cmd tee /etc/systemd/system/overseer-auto-update.timer > /dev/null << EOF
[Unit]
Description=Run Overseer automatic update ${OVERSEER_AUTO_UPDATE_SCHEDULE}

[Timer]
OnCalendar=${OVERSEER_AUTO_UPDATE_SCHEDULE}
RandomizedDelaySec=1800
Persistent=true

[Install]
WantedBy=timers.target
EOF

    sudo_cmd systemctl daemon-reload
    sudo_cmd systemctl enable overseer-auto-update.timer >/dev/null 2>&1 || true
    sudo_cmd systemctl restart overseer-auto-update.timer >/dev/null 2>&1 || true

    print_success "Automatic Overseer updates configured (${OVERSEER_AUTO_UPDATE_SCHEDULE})"
}

# =========================================
# Node.js Installation
# =========================================

install_nodejs() {
    print_step "Setting up Node.js ${NODE_VERSION}..."

    if command_exists node; then
        CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
            print_success "Node.js $(node -v) already installed - no changes needed"
            return 0
        fi
        print_warning "Node.js $(node -v) found - upgrading to v${NODE_VERSION}..."
    fi

    case "$OS" in
        ubuntu|debian|pop|linuxmint|wsl)
            print_substep "Installing via NodeSource..."
            curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo_cmd bash - >/dev/null 2>&1
            sudo_cmd apt-get install -y nodejs >/dev/null 2>&1
            ;;
        centos|rhel|fedora|rocky|almalinux)
            print_substep "Installing via NodeSource..."
            curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo_cmd bash - >/dev/null 2>&1
            sudo_cmd $PKG_MANAGER install -y nodejs >/dev/null 2>&1 || sudo_cmd yum install -y nodejs >/dev/null 2>&1
            ;;
        macos)
            if command_exists brew; then
                print_substep "Installing via Homebrew..."
                brew install node@${NODE_VERSION} 2>/dev/null
                brew link node@${NODE_VERSION} --force --overwrite 2>/dev/null || true
            else
                print_substep "Installing Homebrew first..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                brew install node@${NODE_VERSION}
            fi
            ;;
        *)
            print_error "Cannot auto-install Node.js on this OS"
            echo "Please install Node.js ${NODE_VERSION}+ manually: https://nodejs.org/"
            exit 1
            ;;
    esac

    if command_exists node; then
        print_success "Node.js $(node -v) installed"
    else
        print_error "Node.js installation failed"
        exit 1
    fi
}

# =========================================
# pnpm Installation
# =========================================

install_pnpm() {
    print_step "Setting up pnpm..."

    if command_exists pnpm; then
        print_success "pnpm $(pnpm -v) already installed"
        return 0
    fi

    # Use corepack if available (Node.js 16.13+)
    if command_exists corepack; then
        corepack enable 2>/dev/null || true
        corepack prepare pnpm@latest --activate 2>/dev/null || npm install -g pnpm
    else
        npm install -g pnpm
    fi

    if command_exists pnpm; then
        print_success "pnpm $(pnpm -v) installed"
    else
        print_warning "pnpm installation failed, will use npm instead"
    fi
}

# =========================================
# Build Dependencies
# =========================================

install_build_deps() {
    print_step "Installing build dependencies..."

    case "$OS" in
        ubuntu|debian|pop|linuxmint|wsl)
            sudo_cmd apt-get update -qq >/dev/null 2>&1
            sudo_cmd apt-get install -y -qq build-essential python3 git curl openssl ca-certificates >/dev/null 2>&1
            ;;
        centos|rhel|rocky|almalinux)
            sudo_cmd yum groupinstall -y "Development Tools" >/dev/null 2>&1 || true
            sudo_cmd yum install -y gcc-c++ make python3 git curl openssl >/dev/null 2>&1
            ;;
        fedora)
            sudo_cmd dnf groupinstall -y "Development Tools" >/dev/null 2>&1 || true
            sudo_cmd dnf install -y gcc-c++ make python3 git curl openssl >/dev/null 2>&1
            ;;
        macos)
            if ! xcode-select -p &>/dev/null; then
                xcode-select --install 2>/dev/null || true
                print_info "Xcode CLI tools installing - you may need to accept the dialog"
            fi
            ;;
    esac

    print_success "Build dependencies ready"
}

# =========================================
# System Requirements Check
# =========================================

check_requirements() {
    print_step "Checking system requirements..."

    local errors=0
    local warnings=0

    # Check Node.js
    if command_exists node; then
        local node_ver=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$node_ver" -ge "$NODE_VERSION" ]; then
            print_success "Node.js $(node -v)"
        else
            print_warning "Node.js $(node -v) - will upgrade"
            warnings=$((warnings + 1))
        fi
    else
        print_info "Node.js not installed - will install"
    fi

    # Check git
    if command_exists git; then
        print_success "git $(git --version | cut -d' ' -f3)"
    else
        print_info "git not installed - will install"
    fi

    # Check openssl
    if command_exists openssl; then
        print_success "openssl available"
    else
        print_warning "openssl not found - needed for key generation"
        warnings=$((warnings + 1))
    fi

    # Check available memory
    local mem_mb=0
    if [[ "$OS" == "macos" ]]; then
        mem_mb=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1024 / 1024 ))
    elif [ -f /proc/meminfo ]; then
        mem_mb=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 ))
    fi

    if [ "$mem_mb" -ge 2048 ]; then
        print_success "Memory: $(( mem_mb / 1024 ))GB available"
    elif [ "$mem_mb" -ge "$MIN_MEMORY_MB" ]; then
        print_warning "Memory: ${mem_mb}MB (2GB+ recommended, ${MIN_MEMORY_MB}MB minimum)"
    else
        print_error "Memory: ${mem_mb}MB (minimum ${MIN_MEMORY_MB}MB required)"
        errors=$((errors + 1))
    fi

    # Check disk space
    local disk_free_gb=0
    if [[ "$OS" == "macos" ]]; then
        disk_free_gb=$(df -g "$HOME" 2>/dev/null | tail -1 | awk '{print $4}')
    else
        disk_free_gb=$(df -BG "$HOME" 2>/dev/null | tail -1 | awk '{print $4}' | tr -d 'G')
    fi

    if [ "${disk_free_gb:-0}" -ge 2 ]; then
        print_success "Disk: ${disk_free_gb}GB free"
    elif [ "${disk_free_gb:-0}" -ge "$MIN_DISK_GB" ]; then
        print_warning "Disk: ${disk_free_gb}GB free (2GB+ recommended)"
    else
        print_error "Disk: ${disk_free_gb}GB free (minimum ${MIN_DISK_GB}GB required)"
        errors=$((errors + 1))
    fi

    if [ $errors -gt 0 ]; then
        return 1
    fi
    return 0
}

# =========================================
# Repository Setup
# =========================================

clone_repository() {
    print_step "Setting up Overseer at ${OVERSEER_DIR}..."

    if [ -d "$OVERSEER_DIR" ]; then
        if [ -d "$OVERSEER_DIR/.git" ]; then
            print_substep "Existing installation found, updating..."
            cd "$OVERSEER_DIR"
            
            # Stash any local changes
            git stash 2>/dev/null || true
            git pull origin "$OVERSEER_VERSION" 2>/dev/null || {
                print_warning "Could not pull updates, using existing version"
            }
        else
            print_warning "Directory exists but is not a git repo"
            print_substep "Backing up and re-cloning..."
            mv "$OVERSEER_DIR" "${OVERSEER_DIR}.backup.$(date +%s)" 2>/dev/null || true
            mkdir -p "$OVERSEER_DIR"
            cd "$OVERSEER_DIR"
            
            if [ -n "${OVERSEER_LOCAL:-}" ] && [ -d "${OVERSEER_LOCAL:-}" ]; then
                cp -r "$OVERSEER_LOCAL"/* . 2>/dev/null || true
                cp -r "$OVERSEER_LOCAL"/.[!.]* . 2>/dev/null || true
            else
                git clone --branch "$OVERSEER_VERSION" --depth 1 "$OVERSEER_REPO" .
            fi
        fi
    else
        mkdir -p "$OVERSEER_DIR"
        cd "$OVERSEER_DIR"

        if [ -n "${OVERSEER_LOCAL:-}" ] && [ -d "${OVERSEER_LOCAL:-}" ]; then
            print_substep "Copying from local directory..."
            cp -r "$OVERSEER_LOCAL"/* . 2>/dev/null || true
            cp -r "$OVERSEER_LOCAL"/.[!.]* . 2>/dev/null || true
        else
            print_substep "Cloning repository..."
            git clone --branch "$OVERSEER_VERSION" --depth 1 "$OVERSEER_REPO" .
        fi
    fi

    print_success "Repository ready"
}

handoff_to_repo_script() {
    local target_script="${OVERSEER_DIR}/scripts/install.sh"
    if [ "${OVERSEER_SCRIPT_HANDOFF_DONE:-0}" = "1" ]; then
        return 0
    fi

    if [ ! -f "$target_script" ]; then
        return 0
    fi

    local current_path
    local target_path
    current_path=$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || realpath "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")
    target_path=$(readlink -f "$target_script" 2>/dev/null || realpath "$target_script" 2>/dev/null || echo "$target_script")

    if [ "$current_path" = "$target_path" ]; then
        return 0
    fi

    print_substep "Switching to repository install script (${OVERSEER_VERSION})..."
    export OVERSEER_SCRIPT_HANDOFF_DONE=1
    exec bash "$target_script"
}

# =========================================
# Secret Generation
# =========================================

generate_secrets() {
    print_step "Generating secure secrets..."

    SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -A n -t x1 | tr -d ' \n')
    ENCRYPTION_KEY=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | od -A n -t x1 | tr -d ' \n')
    if [ -n "${OVERSEER_ADMIN_PASSWORD}" ]; then
        ADMIN_PASSWORD="${OVERSEER_ADMIN_PASSWORD}"
    else
        ADMIN_PASSWORD=$(openssl rand -base64 24 2>/dev/null | tr -dc 'a-zA-Z0-9!@#' | head -c 20 || echo "Overseer$(date +%s | tail -c 8)")
    fi

    print_success "Secrets generated"
}

# =========================================
# Environment Configuration
# =========================================

configure_environment() {
    print_step "Configuring environment..."

    cd "$OVERSEER_DIR"

    # Don't overwrite existing .env unless requested
    if [ -f ".env" ] && [ -z "${OVERSEER_FORCE_ENV:-}" ]; then
        print_warning "Existing .env found - preserving (set OVERSEER_FORCE_ENV=1 to overwrite)"
        
        # But update the PORT if needed
        if grep -q "^PORT=" .env; then
            local existing_port=$(grep "^PORT=" .env | cut -d'=' -f2)
            OVERSEER_PORT="$existing_port"
            print_info "Using existing port: ${OVERSEER_PORT}"
        fi
        return 0
    fi

    # Generate random port if not specified
    if [ -z "${OVERSEER_PORT:-}" ]; then
        OVERSEER_PORT=$(generate_random_port)
        print_success "Random port assigned: ${OVERSEER_PORT}"
    else
        print_info "Using specified port: ${OVERSEER_PORT}"
    fi

    # Detect public IP for BASE_URL
    local public_ip=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || curl -s --max-time 5 https://ifconfig.me 2>/dev/null || echo "localhost")
    local base_url
    if [ -n "${OVERSEER_DOMAIN}" ]; then
        if [ "${OVERSEER_ENABLE_TLS}" = "true" ]; then
            base_url="https://${OVERSEER_DOMAIN}"
        else
            base_url="http://${OVERSEER_DOMAIN}"
        fi
    else
        base_url="http://${public_ip}:${OVERSEER_PORT}"
    fi

    # Interactive configuration (if stdin is a terminal)
    local admin_username="${OVERSEER_ADMIN_USERNAME}"
    local openai_key=""
    local anthropic_key=""
    local telegram_token=""
    local discord_token=""
    local discord_client_id=""

    if [ -t 0 ]; then
        echo ""
        echo -e "${BOLD}Let's configure Overseer:${NC}"
        echo ""

        # Admin
        read -p "  Admin username [${OVERSEER_ADMIN_USERNAME}]: " input_admin
        admin_username=${input_admin:-${OVERSEER_ADMIN_USERNAME}}

        # LLM Provider
        echo ""
        echo -e "  ${DIM}Configure an LLM provider (required for AI features):${NC}"
        read -p "  OpenAI API Key (Enter to skip): " openai_key
        if [ -z "$openai_key" ]; then
            read -p "  Anthropic API Key (Enter to skip): " anthropic_key
        fi

        # Channels
        echo ""
        echo -e "  ${DIM}Configure chat channels (can be done later in admin panel):${NC}"
        read -p "  Telegram Bot Token (Enter to skip): " telegram_token
        read -p "  Discord Bot Token (Enter to skip): " discord_token
        if [ -n "$discord_token" ]; then
            read -p "  Discord Client ID: " discord_client_id
        fi
    fi

    # Write environment file
    cat > ".env" << EOF
# ============================================
# Overseer Configuration
# Generated on $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# ============================================

# Application
NODE_ENV=production
PORT=${OVERSEER_PORT}
BASE_URL=${base_url}

# Security (AUTO-GENERATED - DO NOT SHARE)
SESSION_SECRET=${SESSION_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}

# Database
DATABASE_PATH=./data/overseer.db

# Default Admin Credentials
DEFAULT_ADMIN_USERNAME=${admin_username}
DEFAULT_ADMIN_PASSWORD=${ADMIN_PASSWORD}

# LLM Providers (add via admin panel or here)
OPENAI_API_KEY=${openai_key}
ANTHROPIC_API_KEY=${anthropic_key}
GOOGLE_API_KEY=

# Telegram Bot
TELEGRAM_BOT_TOKEN=${telegram_token}
TELEGRAM_ALLOWED_USERS=

# Discord Bot
DISCORD_BOT_TOKEN=${discord_token}
DISCORD_CLIENT_ID=${discord_client_id}
DISCORD_ALLOWED_USERS=
DISCORD_ALLOWED_GUILDS=

# WhatsApp (configure via admin panel)
WHATSAPP_ENABLED=false

# Agent Settings
AGENT_MAX_RETRIES=3
AGENT_MAX_STEPS=30
AGENT_DEFAULT_MODEL=gpt-4o
AGENT_TIMEOUT_MS=120000

# Tool Settings
ALLOW_SHELL_COMMANDS=true
REQUIRE_CONFIRMATION_FOR_DESTRUCTIVE=true
SHELL_TIMEOUT_MS=30000
MAX_FILE_SIZE_MB=50
EOF

    chmod 600 ".env"
    print_success "Environment configured"
}

# =========================================
# Optional Nginx + TLS setup (cloud mode)
# =========================================

setup_nginx_proxy() {
    if [[ "$OS" == "macos" ]] || [[ "${OS:-}" == "wsl" ]]; then
        return 0
    fi

    if [ -z "${OVERSEER_DOMAIN}" ]; then
        return 0
    fi

    if ! command_exists nginx; then
        print_substep "Installing nginx..."
        case "$PKG_MANAGER" in
            apt) sudo_cmd apt-get install -y nginx >/dev/null 2>&1 ;;
            dnf) sudo_cmd dnf install -y nginx >/dev/null 2>&1 ;;
            yum) sudo_cmd yum install -y nginx >/dev/null 2>&1 ;;
            *) print_warning "Unsupported package manager for nginx auto-install"; return 0 ;;
        esac
    fi

    print_step "Configuring nginx reverse proxy for ${OVERSEER_DOMAIN}..."

    local nginx_conf="/etc/nginx/sites-available/overseer"
    sudo_cmd tee "$nginx_conf" > /dev/null << EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${OVERSEER_DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${OVERSEER_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

    if [ -d "/etc/nginx/sites-enabled" ]; then
        sudo_cmd ln -sf "$nginx_conf" /etc/nginx/sites-enabled/overseer
        sudo_cmd rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
    fi

    sudo_cmd nginx -t >/dev/null 2>&1 || {
        print_warning "nginx config validation failed"
        return 0
    }

    sudo_cmd systemctl enable nginx >/dev/null 2>&1 || true
    sudo_cmd systemctl restart nginx >/dev/null 2>&1 || true

    if command_exists ufw; then
        sudo_cmd ufw allow 80/tcp comment "HTTP" 2>/dev/null || true
        sudo_cmd ufw allow 443/tcp comment "HTTPS" 2>/dev/null || true
    fi

    print_success "nginx reverse proxy configured"
}

setup_letsencrypt_tls() {
    if [ "${OVERSEER_ENABLE_TLS}" != "true" ] || [ -z "${OVERSEER_DOMAIN}" ]; then
        return 0
    fi

    if [[ "$OS" == "macos" ]] || [[ "${OS:-}" == "wsl" ]]; then
        return 0
    fi

    if [ -z "${OVERSEER_TLS_EMAIL}" ]; then
        print_warning "OVERSEER_TLS_EMAIL not set - skipping certbot TLS setup"
        return 0
    fi

    print_step "Configuring Let's Encrypt TLS for ${OVERSEER_DOMAIN}..."

    case "$PKG_MANAGER" in
        apt)
            sudo_cmd apt-get install -y certbot python3-certbot-nginx >/dev/null 2>&1
            ;;
        dnf)
            sudo_cmd dnf install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
            ;;
        yum)
            sudo_cmd yum install -y certbot python3-certbot-nginx >/dev/null 2>&1 || true
            ;;
        *)
            print_warning "Unsupported package manager for certbot auto-install"
            return 0
            ;;
    esac

    sudo_cmd certbot --nginx \
        --non-interactive \
        --agree-tos \
        --redirect \
        --email "${OVERSEER_TLS_EMAIL}" \
        -d "${OVERSEER_DOMAIN}" >/dev/null 2>&1 || {
        print_warning "certbot failed - verify DNS resolves to this VPS and retry manually"
        return 0
    }

    print_success "TLS configured with Let's Encrypt"
}

# =========================================
# Install Dependencies
# =========================================

install_dependencies() {
    print_step "Installing dependencies..."

    cd "$OVERSEER_DIR"

    if command_exists pnpm; then
        pnpm install --no-frozen-lockfile 2>&1 | tail -5
    else
        npm install 2>&1 | tail -5
    fi

    print_success "Dependencies installed"
}

# =========================================
# Database Initialization
# =========================================

init_database() {
    print_step "Initializing database..."

    cd "$OVERSEER_DIR"
    mkdir -p data logs

    # Run database initialization and fail fast on errors.
    if command_exists pnpm; then
        if ! pnpm run db:init; then
            print_error "Database initialization failed"
            exit 1
        fi
    else
        if ! npm run db:init; then
            print_error "Database initialization failed"
            exit 1
        fi
    fi

    print_success "Database initialized"
}

# =========================================
# Build Application
# =========================================

build_app() {
    print_step "Building application..."

    cd "$OVERSEER_DIR"

    print_substep "Cleaning previous build..."
    rm -rf .next
    if command_exists pnpm; then
        if ! pnpm run build; then
            print_error "Application build failed"
            exit 1
        fi
    else
        if ! npm run build; then
            print_error "Application build failed"
            exit 1
        fi
    fi

    # Verify build output exists
    if [ ! -d ".next" ]; then
        print_error "Build failed - .next directory not found"
        exit 1
    fi

    print_success "Application built (using next start)"
}

# =========================================
# Systemd Services (Linux)
# =========================================

create_systemd_services() {
    if [[ "$OS" == "macos" ]] || [[ "${OS:-}" == "wsl" ]]; then
        return 0
    fi

    if ! command_exists systemctl; then
        print_warning "systemctl not found - skipping service creation"
        return 0
    fi

    print_step "Creating systemd services..."

    local node_path=$(which node)
    local npx_path=$(which npx)
    local pnpm_path=$(which pnpm 2>/dev/null || echo "")

    # Determine the start command: prefer pnpm, fallback to npx
    local start_cmd
    if [ -n "$pnpm_path" ]; then
        start_cmd="${pnpm_path} start -- -H 0.0.0.0 -p \${PORT}"
    else
        start_cmd="${npx_path} next start -H 0.0.0.0 -p \${PORT}"
    fi

    # Main web admin service - uses 'next start' (NOT standalone)
    sudo_cmd tee /etc/systemd/system/overseer.service > /dev/null << EOF
[Unit]
Description=Overseer AI Agent - Web Admin Dashboard
Documentation=https://github.com/ErzenXz/overseer
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${OVERSEER_USER}
WorkingDirectory=${OVERSEER_DIR}
ExecStart=${npx_path} next start -H 0.0.0.0 -p ${OVERSEER_PORT}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overseer
Environment=NODE_ENV=production
Environment=PORT=${OVERSEER_PORT}
EnvironmentFile=${OVERSEER_DIR}/.env
# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${OVERSEER_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    # Telegram bot service
    sudo_cmd tee /etc/systemd/system/overseer-telegram.service > /dev/null << EOF
[Unit]
Description=Overseer AI Agent - Telegram Bot
After=network.target overseer.service
PartOf=overseer.service

[Service]
Type=simple
User=${OVERSEER_USER}
WorkingDirectory=${OVERSEER_DIR}
ExecStart=${npx_path} tsx ${OVERSEER_DIR}/src/bot/index.ts
Restart=on-failure
RestartSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overseer-telegram
Environment=NODE_ENV=production
EnvironmentFile=${OVERSEER_DIR}/.env
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${OVERSEER_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    # Discord bot service
    sudo_cmd tee /etc/systemd/system/overseer-discord.service > /dev/null << EOF
[Unit]
Description=Overseer AI Agent - Discord Bot
After=network.target overseer.service
PartOf=overseer.service

[Service]
Type=simple
User=${OVERSEER_USER}
WorkingDirectory=${OVERSEER_DIR}
ExecStart=${npx_path} tsx ${OVERSEER_DIR}/src/bot/discord.ts
Restart=on-failure
RestartSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overseer-discord
Environment=NODE_ENV=production
EnvironmentFile=${OVERSEER_DIR}/.env
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${OVERSEER_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    # WhatsApp bot service
    sudo_cmd tee /etc/systemd/system/overseer-whatsapp.service > /dev/null << EOF
[Unit]
Description=Overseer AI Agent - WhatsApp Bot
After=network.target overseer.service
PartOf=overseer.service

[Service]
Type=simple
User=${OVERSEER_USER}
WorkingDirectory=${OVERSEER_DIR}
ExecStart=${npx_path} tsx ${OVERSEER_DIR}/src/bot/whatsapp.ts
Restart=on-failure
RestartSec=15
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overseer-whatsapp
Environment=NODE_ENV=production
EnvironmentFile=${OVERSEER_DIR}/.env
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${OVERSEER_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    sudo_cmd systemctl daemon-reload

    # Enable main service
    sudo_cmd systemctl enable overseer 2>/dev/null || true
    if ! sudo_cmd systemctl restart overseer; then
        print_error "Failed to start overseer service"
        sudo_cmd journalctl -u overseer -n 50 --no-pager || true
        exit 1
    fi

    if ! sudo_cmd systemctl is-active --quiet overseer; then
        print_error "overseer service is not active after install"
        sudo_cmd journalctl -u overseer -n 50 --no-pager || true
        exit 1
    fi

    print_success "Systemd services created"
    print_info "Services: overseer, overseer-telegram, overseer-discord, overseer-whatsapp"
}

# =========================================
# macOS LaunchAgent
# =========================================

create_launchd_services() {
    if [[ "$OS" != "macos" ]]; then
        return 0
    fi

    print_step "Creating launchd services..."

    mkdir -p "$HOME/Library/LaunchAgents" "$OVERSEER_DIR/logs"

    cat > "$HOME/Library/LaunchAgents/com.overseer.web.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.overseer.web</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which npx)</string>
        <string>next</string>
        <string>start</string>
        <string>-H</string>
        <string>0.0.0.0</string>
        <string>-p</string>
        <string>${OVERSEER_PORT}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${OVERSEER_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PORT</key>
        <string>${OVERSEER_PORT}</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${OVERSEER_DIR}/logs/web.log</string>
    <key>StandardErrorPath</key>
    <string>${OVERSEER_DIR}/logs/web-error.log</string>
</dict>
</plist>
EOF

    print_success "LaunchAgent created"
}

# =========================================
# Management Script
# =========================================

create_management_script() {
    print_step "Setting up management script..."

    # The management script is tracked in git at the repo root.
    # Just ensure it's executable.
    if [ -f "$OVERSEER_DIR/overseer" ]; then
        chmod +x "$OVERSEER_DIR/overseer"
        print_success "Management script ready: ${OVERSEER_DIR}/overseer"
    else
        print_warning "Management script not found in repo - re-clone may be needed"
    fi
}

# =========================================
# Print Final Success
# =========================================

print_final_success() {
    local public_ip=$(curl -s --max-time 3 https://api.ipify.org 2>/dev/null || echo "your-server-ip")

    echo ""
    echo -e "${GREEN}"
    echo "======================================================"
    echo "       Overseer Installation Complete!"
    echo "======================================================"
    echo -e "${NC}"
    echo ""
    echo -e "  ${BOLD}Admin Dashboard:${NC}"
    echo -e "    ${CYAN}http://${public_ip}:${OVERSEER_PORT}${NC}"
    echo ""
    echo -e "  ${BOLD}Login Credentials:${NC}"
    echo -e "    Username: ${BOLD}${DEFAULT_ADMIN_USERNAME:-admin}${NC}"
    echo -e "    Password: ${BOLD}${ADMIN_PASSWORD}${NC}"
    echo ""
    echo -e "  ${BOLD}Installation Directory:${NC}"
    echo -e "    ${OVERSEER_DIR}"
    echo ""
    echo -e "  ${BOLD}Port:${NC} ${OVERSEER_PORT} (randomly assigned)"
    echo ""
    echo -e "  ${BOLD}Quick Start:${NC}"
    echo -e "    cd ${OVERSEER_DIR} && ./overseer start"
    echo ""
    echo -e "  ${BOLD}Management Commands:${NC}"
    echo "    ./overseer start    - Start services"
    echo "    ./overseer stop     - Stop services"
    echo "    ./overseer status   - Check status"
    echo "    ./overseer logs     - View logs"
    echo "    ./overseer update   - Update to latest"
    echo ""
    echo -e "  ${BOLD}Next Steps:${NC}"
    echo "    1. Open the admin dashboard"
    echo "    2. Complete the onboarding wizard"
    echo "    3. Add an LLM provider (OpenAI, Anthropic, etc.)"
    echo "    4. Connect a chat channel (Telegram, Discord, WhatsApp)"
    echo ""
    echo -e "  ${YELLOW}Security Notes:${NC}"
    echo "    - SSH (port 22) is always accessible"
    echo "    - Admin panel on random port ${OVERSEER_PORT}"
    echo "    - fail2ban is protecting SSH"
    echo "    - Change admin password after first login"
    echo ""

    # Save credentials to a file for reference
    cat > "$OVERSEER_DIR/.install-info" << EOF
# Overseer Installation Info - $(date -u +"%Y-%m-%d %H:%M:%S UTC")
# DELETE THIS FILE after saving credentials!
ADMIN_URL=http://${public_ip}:${OVERSEER_PORT}
ADMIN_USERNAME=${DEFAULT_ADMIN_USERNAME:-admin}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
PORT=${OVERSEER_PORT}
EOF
    chmod 600 "$OVERSEER_DIR/.install-info"
    print_info "Credentials saved to ${OVERSEER_DIR}/.install-info (delete after saving!)"
}

# =========================================
# Main Installation Flow
# =========================================

main() {
    parse_args "$@"
    if [ "$SHOW_HELP" -eq 1 ]; then
        usage
        exit 0
    fi

    detect_os
    print_banner

    if [ "$DRY_RUN" -eq 1 ]; then
        print_step "DRY RUN"
        print_info "No changes will be made."
        echo ""
        echo -e "  Detected: ${BOLD}${OS}${NC} $([ -n "$OS_VERSION" ] && echo "v${OS_VERSION}") | pkg: ${PKG_MANAGER}"
        echo -e "  Target dir: ${BOLD}${OVERSEER_DIR}${NC}"
        echo -e "  Repo: ${BOLD}${OVERSEER_REPO}${NC}"
        echo -e "  Version: ${BOLD}${OVERSEER_VERSION}${NC}"
        echo ""
        print_info "Planned steps:"
        print_info "  - Detect existing services (no changes)"
        print_info "  - Install prerequisites (node/pnpm/build deps)"
        print_info "  - Clone repository + configure .env + install deps"
        print_info "  - Initialize DB + build app"
        print_info "  - Set up services + optional firewall/TLS (if enabled)"
        echo ""
        exit 0
    fi

    echo -e "  Detected: ${BOLD}${OS}${NC} $([ -n "$OS_VERSION" ] && echo "v${OS_VERSION}") | pkg: ${PKG_MANAGER}"
    echo ""

    # Detect existing services (don't break them!)
    detect_existing_services

    # Check and install prerequisites
    if ! check_requirements; then
        echo ""
        if [ "$NON_INTERACTIVE" -eq 0 ] && [ -t 0 ]; then
            read -p "  Install missing dependencies? (Y/n) " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Nn]$ ]]; then
                print_error "Cannot proceed without required dependencies"
                exit 1
            fi
        fi
    fi

    install_build_deps
    install_nodejs
    install_pnpm

    # Generate port and secrets
    if [ -z "${OVERSEER_PORT:-}" ]; then
        OVERSEER_PORT=$(generate_random_port)
    fi
    generate_secrets

    # Main installation
    clone_repository
    handoff_to_repo_script
    configure_environment
    install_dependencies
    init_database
    build_app

    # Security hardening
    install_fail2ban
    configure_ufw_safe
    configure_auto_security_updates

    # Create services
    if [[ "$OS" == "macos" ]]; then
        create_launchd_services
    else
        create_systemd_services
    fi

    # Optional cloud-mode reverse proxy + TLS
    setup_nginx_proxy
    setup_letsencrypt_tls
    configure_auto_app_updates

    create_management_script
    print_final_success
}

# Run
main "$@"
