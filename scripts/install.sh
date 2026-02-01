#!/bin/bash

#################################################
# MyBot Installation Script
# Self-hosted AI Agent with Full VPS Access
#
# Supports: Ubuntu/Debian, CentOS/RHEL/Fedora,
#           macOS, Windows (via WSL2)
#################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Configuration
MYBOT_VERSION="${MYBOT_VERSION:-main}"
MYBOT_DIR="${MYBOT_DIR:-$HOME/mybot}"
MYBOT_PORT="${MYBOT_PORT:-3000}"
MYBOT_REPO="${MYBOT_REPO:-https://github.com/yourusername/mybot.git}"
MYBOT_USER="${MYBOT_USER:-$USER}"
NODE_VERSION="20"

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            OS=$ID
            OS_VERSION=$VERSION_ID
            OS_FAMILY=$ID_LIKE
        elif [ -f /etc/redhat-release ]; then
            OS="rhel"
        elif [ -f /etc/debian_version ]; then
            OS="debian"
        else
            OS="linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
        OS_VERSION=$(sw_vers -productVersion)
    elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ -n "$WSL_DISTRO_NAME" ]]; then
        OS="wsl"
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            OS_BASE=$ID
        fi
    else
        OS="unknown"
    fi
}

# Print banner
print_banner() {
    echo -e "${PURPLE}"
    echo "  __  __       ____        _   "
    echo " |  \/  |_   _| __ )  ___ | |_ "
    echo " | |\/| | | | |  _ \ / _ \| __|"
    echo " | |  | | |_| | |_) | (_) | |_ "
    echo " |_|  |_|\__, |____/ \___/ \__|"
    echo "         |___/                  "
    echo -e "${NC}"
    echo -e "${CYAN}Self-hosted AI Agent with Full VPS Access${NC}"
    echo ""
    echo -e "Detected OS: ${BOLD}$OS${NC} $([ -n "$OS_VERSION" ] && echo "v$OS_VERSION")"
    echo ""
}

# Print helpers
print_step() {
    echo -e "${BLUE}==>${NC} ${GREEN}$1${NC}"
}

print_substep() {
    echo -e "    ${CYAN}→${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}Warning:${NC} $1"
}

print_error() {
    echo -e "${RED}Error:${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check if running as root
is_root() {
    [ "$EUID" -eq 0 ]
}

# Get package manager
get_package_manager() {
    if command_exists apt-get; then
        PKG_MANAGER="apt"
        PKG_INSTALL="apt-get install -y"
        PKG_UPDATE="apt-get update"
    elif command_exists dnf; then
        PKG_MANAGER="dnf"
        PKG_INSTALL="dnf install -y"
        PKG_UPDATE="dnf check-update || true"
    elif command_exists yum; then
        PKG_MANAGER="yum"
        PKG_INSTALL="yum install -y"
        PKG_UPDATE="yum check-update || true"
    elif command_exists pacman; then
        PKG_MANAGER="pacman"
        PKG_INSTALL="pacman -S --noconfirm"
        PKG_UPDATE="pacman -Sy"
    elif command_exists brew; then
        PKG_MANAGER="brew"
        PKG_INSTALL="brew install"
        PKG_UPDATE="brew update"
    else
        PKG_MANAGER="unknown"
    fi
}

# Install Node.js
install_nodejs() {
    print_step "Installing Node.js $NODE_VERSION..."

    if command_exists node; then
        CURRENT_NODE=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
            print_success "Node.js $(node -v) already installed"
            return 0
        fi
        print_warning "Node.js version too old, upgrading..."
    fi

    case "$OS" in
        ubuntu|debian|pop|linuxmint)
            print_substep "Installing via NodeSource..."
            if is_root; then
                curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
                apt-get install -y nodejs
            else
                curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
                sudo apt-get install -y nodejs
            fi
            ;;
        centos|rhel|fedora|rocky|almalinux)
            print_substep "Installing via NodeSource..."
            if is_root; then
                curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash -
                $PKG_INSTALL nodejs
            else
                curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | sudo bash -
                sudo $PKG_INSTALL nodejs
            fi
            ;;
        macos)
            if command_exists brew; then
                print_substep "Installing via Homebrew..."
                brew install node@${NODE_VERSION}
                brew link node@${NODE_VERSION} --force --overwrite
            else
                print_substep "Installing Homebrew first..."
                /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
                brew install node@${NODE_VERSION}
            fi
            ;;
        wsl)
            print_substep "Installing via NodeSource for WSL..."
            curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
            sudo apt-get install -y nodejs
            ;;
        *)
            print_error "Unsupported OS for automatic Node.js installation"
            echo "Please install Node.js $NODE_VERSION manually:"
            echo "  https://nodejs.org/en/download/"
            exit 1
            ;;
    esac

    print_success "Node.js $(node -v) installed"
}

# Install pnpm
install_pnpm() {
    print_step "Installing pnpm..."

    if command_exists pnpm; then
        print_success "pnpm already installed ($(pnpm -v))"
        return 0
    fi

    npm install -g pnpm
    print_success "pnpm $(pnpm -v) installed"
}

# Install build dependencies
install_build_deps() {
    print_step "Installing build dependencies..."

    case "$OS" in
        ubuntu|debian|pop|linuxmint|wsl)
            DEPS="build-essential python3 git curl openssl"
            if is_root; then
                apt-get update
                apt-get install -y $DEPS
            else
                sudo apt-get update
                sudo apt-get install -y $DEPS
            fi
            ;;
        centos|rhel|rocky|almalinux)
            DEPS="gcc-c++ make python3 git curl openssl"
            if is_root; then
                yum groupinstall -y "Development Tools"
                yum install -y $DEPS
            else
                sudo yum groupinstall -y "Development Tools"
                sudo yum install -y $DEPS
            fi
            ;;
        fedora)
            DEPS="gcc-c++ make python3 git curl openssl"
            if is_root; then
                dnf groupinstall -y "Development Tools"
                dnf install -y $DEPS
            else
                sudo dnf groupinstall -y "Development Tools"
                sudo dnf install -y $DEPS
            fi
            ;;
        macos)
            # Xcode command line tools
            if ! xcode-select -p &>/dev/null; then
                xcode-select --install || true
            fi
            # Additional tools via brew
            if command_exists brew; then
                brew install git openssl
            fi
            ;;
    esac

    print_success "Build dependencies installed"
}

# Check system requirements
check_requirements() {
    print_step "Checking system requirements..."

    local errors=0

    # Check Node.js
    if command_exists node; then
        NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VER" -ge "$NODE_VERSION" ]; then
            print_success "Node.js $(node -v)"
        else
            print_warning "Node.js $(node -v) - upgrade recommended"
        fi
    else
        print_error "Node.js not installed"
        errors=$((errors + 1))
    fi

    # Check npm
    if command_exists npm; then
        print_success "npm $(npm -v)"
    else
        print_error "npm not installed"
        errors=$((errors + 1))
    fi

    # Check git
    if command_exists git; then
        print_success "git $(git --version | cut -d' ' -f3)"
    else
        print_error "git not installed"
        errors=$((errors + 1))
    fi

    # Check openssl
    if command_exists openssl; then
        print_success "openssl available"
    else
        print_warning "openssl not found - needed for key generation"
    fi

    # Check available memory
    if [[ "$OS" == "macos" ]]; then
        MEM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
    else
        MEM_GB=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024 ))
    fi

    if [ "$MEM_GB" -ge 2 ]; then
        print_success "Memory: ${MEM_GB}GB available"
    else
        print_warning "Memory: ${MEM_GB}GB (2GB+ recommended)"
    fi

    # Check disk space
    DISK_FREE=$(df -BG "$HOME" | tail -1 | awk '{print $4}' | tr -d 'G')
    if [ "$DISK_FREE" -ge 2 ]; then
        print_success "Disk: ${DISK_FREE}GB free"
    else
        print_warning "Disk: ${DISK_FREE}GB free (2GB+ recommended)"
    fi

    echo ""

    if [ $errors -gt 0 ]; then
        return 1
    fi
    return 0
}

# Clone or update repository
clone_repository() {
    print_step "Setting up MyBot at $MYBOT_DIR..."

    if [ -d "$MYBOT_DIR" ]; then
        print_warning "Directory $MYBOT_DIR already exists"
        echo ""
        echo "Options:"
        echo "  1) Update existing installation"
        echo "  2) Remove and reinstall"
        echo "  3) Cancel"
        echo ""
        read -p "Choose option [1]: " choice
        choice=${choice:-1}

        case $choice in
            1)
                print_substep "Updating existing installation..."
                cd "$MYBOT_DIR"
                if [ -d ".git" ]; then
                    git pull origin "$MYBOT_VERSION" || true
                fi
                ;;
            2)
                print_substep "Removing existing installation..."
                rm -rf "$MYBOT_DIR"
                mkdir -p "$MYBOT_DIR"
                cd "$MYBOT_DIR"
                if [ -n "$MYBOT_LOCAL" ] && [ -d "$MYBOT_LOCAL" ]; then
                    cp -r "$MYBOT_LOCAL"/* .
                else
                    git clone --branch "$MYBOT_VERSION" "$MYBOT_REPO" .
                fi
                ;;
            *)
                echo "Installation cancelled."
                exit 0
                ;;
        esac
    else
        mkdir -p "$MYBOT_DIR"
        cd "$MYBOT_DIR"

        if [ -n "$MYBOT_LOCAL" ] && [ -d "$MYBOT_LOCAL" ]; then
            print_substep "Copying from local directory..."
            cp -r "$MYBOT_LOCAL"/* .
        else
            print_substep "Cloning repository..."
            git clone --branch "$MYBOT_VERSION" "$MYBOT_REPO" .
        fi
    fi

    print_success "Repository ready"
}

# Generate secure secrets
generate_secrets() {
    print_step "Generating secure secrets..."

    SESSION_SECRET=$(openssl rand -hex 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)

    print_success "Secrets generated"
}

# Interactive environment configuration
configure_environment() {
    print_step "Configuring environment..."

    # Check if .env already exists
    if [ -f "$MYBOT_DIR/.env" ]; then
        read -p "Environment file exists. Overwrite? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_warning "Keeping existing .env file"
            return 0
        fi
    fi

    echo ""
    echo -e "${BOLD}Let's configure MyBot:${NC}"
    echo ""

    # Port
    read -p "Web admin port [$MYBOT_PORT]: " input_port
    MYBOT_PORT=${input_port:-$MYBOT_PORT}

    # Base URL
    DEFAULT_URL="http://localhost:$MYBOT_PORT"
    read -p "Base URL [$DEFAULT_URL]: " input_url
    BASE_URL=${input_url:-$DEFAULT_URL}

    # Admin username
    read -p "Admin username [admin]: " input_admin
    ADMIN_USERNAME=${input_admin:-admin}

    # LLM Provider (optional)
    echo ""
    echo "Optional: Configure LLM provider (can be done later via web UI)"
    read -p "OpenAI API Key (press Enter to skip): " OPENAI_API_KEY
    read -p "Anthropic API Key (press Enter to skip): " ANTHROPIC_API_KEY

    # Telegram (optional)
    echo ""
    echo "Optional: Configure Telegram bot (can be done later via web UI)"
    read -p "Telegram Bot Token (press Enter to skip): " TELEGRAM_BOT_TOKEN
    read -p "Telegram Allowed User IDs (comma-separated, Enter for all): " TELEGRAM_ALLOWED_USERS

    # Write environment file
    cat > "$MYBOT_DIR/.env" << EOF
# ============================================
# MyBot Configuration
# Generated on $(date)
# ============================================

# Application
NODE_ENV=production
PORT=$MYBOT_PORT
BASE_URL=$BASE_URL

# Security (AUTO-GENERATED - DO NOT SHARE)
SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

# Database
DATABASE_PATH=./data/mybot.db

# Default Admin Credentials
DEFAULT_ADMIN_USERNAME=$ADMIN_USERNAME
DEFAULT_ADMIN_PASSWORD=$ADMIN_PASSWORD

# LLM Providers
OPENAI_API_KEY=$OPENAI_API_KEY
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
GOOGLE_API_KEY=

# Telegram Bot
TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_ALLOWED_USERS=$TELEGRAM_ALLOWED_USERS

# Discord Bot
DISCORD_BOT_TOKEN=

# Agent Settings
AGENT_MAX_RETRIES=3
AGENT_MAX_STEPS=25
AGENT_TIMEOUT_MS=120000

# Tool Settings
ALLOW_SHELL_COMMANDS=true
REQUIRE_CONFIRMATION_FOR_DESTRUCTIVE=true
SHELL_TIMEOUT_MS=30000
MAX_FILE_SIZE_MB=10
EOF

    chmod 600 "$MYBOT_DIR/.env"
    print_success "Environment configured"
}

# Install dependencies
install_dependencies() {
    print_step "Installing dependencies..."

    cd "$MYBOT_DIR"

    # Use pnpm if available, otherwise npm
    if command_exists pnpm; then
        pnpm install 2>&1 | tail -10
    else
        npm install 2>&1 | tail -10
    fi

    print_success "Dependencies installed"
}

# Initialize database
init_database() {
    print_step "Initializing database..."

    cd "$MYBOT_DIR"
    mkdir -p data

    npm run db:init 2>&1 | grep -E "(✅|Created|admin|Success)" || true

    print_success "Database initialized"
}

# Build application
build_app() {
    print_step "Building application..."

    cd "$MYBOT_DIR"
    npm run build 2>&1 | tail -10

    print_success "Application built"
}

# Create systemd services (Linux)
create_systemd_services() {
    if [[ "$OS" == "macos" ]] || [[ "$OS" == "wsl" ]]; then
        return 0
    fi

    print_step "Creating systemd services..."

    if ! is_root && ! command_exists sudo; then
        print_warning "Cannot create systemd services without sudo access"
        return 0
    fi

    local SUDO_CMD=""
    if ! is_root; then
        SUDO_CMD="sudo"
    fi

    # Create mybot user if doesn't exist
    if ! id "mybot" &>/dev/null; then
        $SUDO_CMD useradd -r -s /bin/false -m -d /opt/mybot mybot 2>/dev/null || true
    fi

    # Web service
    $SUDO_CMD tee /etc/systemd/system/mybot.service > /dev/null << EOF
[Unit]
Description=MyBot AI Agent - Web Admin Panel
After=network.target

[Service]
Type=simple
User=$MYBOT_USER
WorkingDirectory=$MYBOT_DIR
ExecStart=$(which node) $MYBOT_DIR/.next/standalone/server.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=$MYBOT_PORT
EnvironmentFile=$MYBOT_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

    # Telegram bot service
    $SUDO_CMD tee /etc/systemd/system/mybot-telegram.service > /dev/null << EOF
[Unit]
Description=MyBot AI Agent - Telegram Bot
After=network.target mybot.service
BindsTo=mybot.service

[Service]
Type=simple
User=$MYBOT_USER
WorkingDirectory=$MYBOT_DIR
ExecStart=$(which npx) tsx $MYBOT_DIR/src/bot/index.ts
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=$MYBOT_DIR/.env

[Install]
WantedBy=multi-user.target
EOF

    $SUDO_CMD systemctl daemon-reload

    print_success "Systemd services created"
    echo "    Services: mybot.service, mybot-telegram.service"
}

# Create launchd services (macOS)
create_launchd_services() {
    if [[ "$OS" != "macos" ]]; then
        return 0
    fi

    print_step "Creating launchd services..."

    mkdir -p "$HOME/Library/LaunchAgents"

    # Web service
    cat > "$HOME/Library/LaunchAgents/com.mybot.web.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mybot.web</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$MYBOT_DIR/.next/standalone/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$MYBOT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>PORT</key>
        <string>$MYBOT_PORT</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$MYBOT_DIR/logs/web.log</string>
    <key>StandardErrorPath</key>
    <string>$MYBOT_DIR/logs/web-error.log</string>
</dict>
</plist>
EOF

    # Telegram bot service
    cat > "$HOME/Library/LaunchAgents/com.mybot.telegram.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mybot.telegram</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which npx)</string>
        <string>tsx</string>
        <string>$MYBOT_DIR/src/bot/index.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$MYBOT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$MYBOT_DIR/logs/telegram.log</string>
    <key>StandardErrorPath</key>
    <string>$MYBOT_DIR/logs/telegram-error.log</string>
</dict>
</plist>
EOF

    mkdir -p "$MYBOT_DIR/logs"

    print_success "LaunchAgent plists created"
    echo "    Load with: launchctl load ~/Library/LaunchAgents/com.mybot.*.plist"
}

# Create management script
create_management_script() {
    print_step "Creating management script..."

    cat > "$MYBOT_DIR/mybot" << 'SCRIPT'
#!/bin/bash

# ============================================
# MyBot Management Script
# ============================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment
if [ -f ".env" ]; then
    set -a
    source .env
    set +a
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
else
    OS="linux"
fi

# Command handlers
cmd_start() {
    echo -e "${GREEN}Starting MyBot services...${NC}"
    if [[ "$OS" == "macos" ]]; then
        launchctl load ~/Library/LaunchAgents/com.mybot.web.plist 2>/dev/null
        launchctl load ~/Library/LaunchAgents/com.mybot.telegram.plist 2>/dev/null
    else
        sudo systemctl start mybot mybot-telegram
    fi
    echo "Started!"
}

cmd_stop() {
    echo -e "${YELLOW}Stopping MyBot services...${NC}"
    if [[ "$OS" == "macos" ]]; then
        launchctl unload ~/Library/LaunchAgents/com.mybot.web.plist 2>/dev/null
        launchctl unload ~/Library/LaunchAgents/com.mybot.telegram.plist 2>/dev/null
    else
        sudo systemctl stop mybot mybot-telegram
    fi
    echo "Stopped!"
}

cmd_restart() {
    echo -e "${CYAN}Restarting MyBot services...${NC}"
    if [[ "$OS" == "macos" ]]; then
        cmd_stop
        sleep 2
        cmd_start
    else
        sudo systemctl restart mybot mybot-telegram
    fi
    echo "Restarted!"
}

cmd_status() {
    echo -e "${CYAN}=== MyBot Status ===${NC}"
    echo ""
    if [[ "$OS" == "macos" ]]; then
        echo "Web Admin:"
        launchctl list | grep mybot.web || echo "  Not running"
        echo ""
        echo "Telegram Bot:"
        launchctl list | grep mybot.telegram || echo "  Not running"
    else
        echo "Web Admin:"
        systemctl status mybot --no-pager -l 2>/dev/null || echo "  Not running"
        echo ""
        echo "Telegram Bot:"
        systemctl status mybot-telegram --no-pager -l 2>/dev/null || echo "  Not running"
    fi
}

cmd_logs() {
    local service="$1"
    if [[ "$OS" == "macos" ]]; then
        case "$service" in
            web)
                tail -f "$SCRIPT_DIR/logs/web.log"
                ;;
            telegram|bot)
                tail -f "$SCRIPT_DIR/logs/telegram.log"
                ;;
            *)
                tail -f "$SCRIPT_DIR/logs/"*.log
                ;;
        esac
    else
        case "$service" in
            web)
                sudo journalctl -u mybot -f
                ;;
            telegram|bot)
                sudo journalctl -u mybot-telegram -f
                ;;
            *)
                sudo journalctl -u mybot -u mybot-telegram -f
                ;;
        esac
    fi
}

cmd_dev() {
    echo -e "${CYAN}Starting in development mode...${NC}"
    npm run dev
}

cmd_bot() {
    echo -e "${CYAN}Starting bot only...${NC}"
    npm run bot
}

cmd_update() {
    echo -e "${CYAN}Updating MyBot...${NC}"
    if [ -d ".git" ]; then
        git pull
    fi
    npm install
    npm run build
    cmd_restart
    echo "Updated!"
}

cmd_help() {
    echo "MyBot Management Script"
    echo ""
    echo "Usage: ./mybot <command> [options]"
    echo ""
    echo "Commands:"
    echo "  start     Start all services"
    echo "  stop      Stop all services"
    echo "  restart   Restart all services"
    echo "  status    Show service status"
    echo "  logs      View logs (logs web, logs bot, or all)"
    echo "  update    Update to latest version"
    echo "  dev       Start in development mode"
    echo "  bot       Start bot only"
    echo "  help      Show this help"
}

# Main
case "${1:-help}" in
    start)   cmd_start ;;
    stop)    cmd_stop ;;
    restart) cmd_restart ;;
    status)  cmd_status ;;
    logs)    cmd_logs "$2" ;;
    update)  cmd_update ;;
    dev)     cmd_dev ;;
    bot)     cmd_bot ;;
    help|*)  cmd_help ;;
esac
SCRIPT

    chmod +x "$MYBOT_DIR/mybot"

    # Add to PATH suggestion
    if ! grep -q "mybot" "$HOME/.bashrc" 2>/dev/null && ! grep -q "mybot" "$HOME/.zshrc" 2>/dev/null; then
        echo ""
        echo "Add to your shell profile for global access:"
        echo "  echo 'export PATH=\"\$PATH:$MYBOT_DIR\"' >> ~/.bashrc"
    fi

    print_success "Management script created: $MYBOT_DIR/mybot"
}

# Security hardening suggestions
print_security_tips() {
    echo ""
    echo -e "${BOLD}Security Recommendations:${NC}"
    echo ""
    echo "  1. ${YELLOW}Change admin password${NC} after first login"
    echo "  2. ${YELLOW}Restrict Telegram users${NC} by setting TELEGRAM_ALLOWED_USERS"
    echo "  3. ${YELLOW}Use a firewall${NC} to limit access to port $MYBOT_PORT"
    echo "  4. ${YELLOW}Set up SSL${NC} with nginx and Let's Encrypt"
    echo "  5. ${YELLOW}Regular backups${NC} of $MYBOT_DIR/data/"
    echo ""
    echo "  Firewall commands (UFW):"
    echo "    sudo ufw allow ssh"
    echo "    sudo ufw allow $MYBOT_PORT/tcp"
    echo "    sudo ufw enable"
    echo ""
}

# Print final success message
print_final_success() {
    echo ""
    echo -e "${GREEN}"
    echo "=============================================="
    echo "  MyBot Installation Complete!"
    echo "=============================================="
    echo -e "${NC}"
    echo ""
    echo "Installation Directory: $MYBOT_DIR"
    echo ""
    echo -e "${BOLD}Admin Credentials:${NC}"
    echo "  Username: $ADMIN_USERNAME"
    echo "  Password: $ADMIN_PASSWORD"
    echo ""
    echo -e "${BOLD}Quick Start:${NC}"
    echo ""
    echo "  1. Start the services:"
    echo -e "     ${CYAN}cd $MYBOT_DIR && ./mybot start${NC}"
    echo ""
    echo "  2. Open the admin panel:"
    echo -e "     ${CYAN}http://localhost:$MYBOT_PORT${NC}"
    echo ""
    echo "  3. Add your LLM provider (OpenAI, Anthropic, etc.)"
    echo ""
    echo "  4. Configure your Telegram bot"
    echo ""
    echo -e "${BOLD}Commands:${NC}"
    echo "  ./mybot start    - Start services"
    echo "  ./mybot stop     - Stop services"
    echo "  ./mybot status   - Check status"
    echo "  ./mybot logs     - View logs"
    echo "  ./mybot update   - Update to latest"
    echo ""

    print_security_tips
}

# Main installation flow
main() {
    detect_os
    get_package_manager
    print_banner

    # Install prerequisites
    if ! check_requirements; then
        echo ""
        read -p "Install missing dependencies? (Y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            install_build_deps
            install_nodejs
            install_pnpm
        else
            print_error "Cannot proceed without required dependencies"
            exit 1
        fi
    fi

    echo ""

    # Main installation
    clone_repository
    generate_secrets
    configure_environment
    install_dependencies
    init_database
    build_app

    # Create services based on OS
    if [[ "$OS" == "macos" ]]; then
        create_launchd_services
    elif [[ "$OS" != "wsl" ]]; then
        create_systemd_services
    fi

    create_management_script
    print_final_success
}

# Run main
main "$@"
