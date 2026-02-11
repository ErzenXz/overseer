#!/bin/bash

#################################################
# Overseer Docker Installation Script
# Installs Docker and sets up Overseer with containers
#################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Configuration
OVERSEER_DIR="${OVERSEER_DIR:-$HOME/overseer}"

# Detect OS
detect_os() {
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            OS=$ID
            OS_VERSION=$VERSION_ID
        else
            OS="linux"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        OS="macos"
    elif [[ -n "$WSL_DISTRO_NAME" ]]; then
        OS="wsl"
    else
        OS="unknown"
    fi
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
    echo -e "${CYAN}Docker Installation${NC}"
    echo ""
}

# Install Docker on Ubuntu/Debian
install_docker_debian() {
    print_substep "Installing Docker for Debian/Ubuntu..."

    # Remove old versions
    sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Install prerequisites
    sudo apt-get update
    sudo apt-get install -y \
        apt-transport-https \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker GPG key
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/$OS/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

    # Add Docker repository
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS \
        $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Add current user to docker group
    sudo usermod -aG docker "$USER"
}

# Install Docker on CentOS/RHEL/Fedora
install_docker_rhel() {
    print_substep "Installing Docker for RHEL/CentOS/Fedora..."

    # Remove old versions
    sudo yum remove -y docker docker-client docker-client-latest docker-common \
        docker-latest docker-latest-logrotate docker-logrotate docker-engine 2>/dev/null || true

    # Install prerequisites
    sudo yum install -y yum-utils

    # Add Docker repository
    sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

    # Install Docker
    sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start Docker
    sudo systemctl start docker
    sudo systemctl enable docker

    # Add current user to docker group
    sudo usermod -aG docker "$USER"
}

# Install Docker on macOS
install_docker_macos() {
    print_substep "Docker Desktop is required for macOS..."
    echo ""
    echo "Please install Docker Desktop from:"
    echo "  https://www.docker.com/products/docker-desktop"
    echo ""
    echo "Or via Homebrew:"
    echo "  brew install --cask docker"
    echo ""

    if command_exists brew; then
        read -p "Install Docker Desktop via Homebrew? (Y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            brew install --cask docker
            echo ""
            echo "Please start Docker Desktop from Applications"
            echo "Then run this script again"
            exit 0
        fi
    fi

    echo "Please install Docker Desktop and run this script again"
    exit 1
}

# Install Docker on WSL
install_docker_wsl() {
    print_substep "Installing Docker for WSL..."

    # Check if Docker Desktop is running on Windows
    if command_exists docker && docker info &>/dev/null; then
        print_success "Docker Desktop for Windows detected"
        return 0
    fi

    echo ""
    echo "For WSL2, you have two options:"
    echo ""
    echo "  1. Install Docker Desktop for Windows (Recommended)"
    echo "     - Enable WSL2 backend in Docker Desktop settings"
    echo "     - https://docs.docker.com/desktop/windows/wsl/"
    echo ""
    echo "  2. Install Docker directly in WSL (Advanced)"
    echo ""

    read -p "Install Docker directly in WSL? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        install_docker_debian
    else
        echo "Please install Docker Desktop for Windows and enable WSL2 backend"
        exit 1
    fi
}

# Install Docker based on OS
install_docker() {
    print_step "Installing Docker..."

    if command_exists docker; then
        print_success "Docker already installed ($(docker --version | cut -d' ' -f3 | tr -d ','))"

        # Check if docker daemon is running
        if docker info &>/dev/null; then
            print_success "Docker daemon is running"
        else
            print_warning "Docker daemon is not running"
            echo "Start with: sudo systemctl start docker"
        fi
        return 0
    fi

    case "$OS" in
        ubuntu|debian|pop|linuxmint)
            install_docker_debian
            ;;
        centos|rhel|fedora|rocky|almalinux)
            install_docker_rhel
            ;;
        macos)
            install_docker_macos
            ;;
        wsl)
            install_docker_wsl
            ;;
        *)
            print_error "Unsupported OS for automatic Docker installation"
            echo "Please install Docker manually: https://docs.docker.com/engine/install/"
            exit 1
            ;;
    esac

    print_success "Docker installed"

    # Start Docker service
    if [[ "$OS" != "macos" ]] && systemctl &>/dev/null; then
        sudo systemctl start docker
        sudo systemctl enable docker
        print_success "Docker service started and enabled"
    fi
}

# Verify Docker installation
verify_docker() {
    print_step "Verifying Docker installation..."

    # Check docker command
    if ! command_exists docker; then
        print_error "Docker command not found"
        exit 1
    fi
    print_success "Docker CLI: $(docker --version)"

    # Check docker compose
    if docker compose version &>/dev/null; then
        print_success "Docker Compose: $(docker compose version --short)"
    elif command_exists docker-compose; then
        print_success "Docker Compose (standalone): $(docker-compose --version)"
    else
        print_error "Docker Compose not found"
        exit 1
    fi

    # Check if daemon is running
    if ! docker info &>/dev/null; then
        print_error "Docker daemon is not running"
        echo ""
        echo "Try:"
        if [[ "$OS" == "macos" ]]; then
            echo "  Open Docker Desktop application"
        else
            echo "  sudo systemctl start docker"
        fi
        echo ""

        # Check if user needs to re-login for docker group
        if groups | grep -q docker; then
            echo "If you just added yourself to the docker group, try:"
            echo "  newgrp docker"
            echo "  # or log out and log back in"
        fi
        exit 1
    fi
    print_success "Docker daemon is running"
}

# Generate secrets
generate_secrets() {
    print_step "Generating secure secrets..."

    SESSION_SECRET=$(openssl rand -hex 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 16)

    print_success "Secrets generated"
}

# Create environment file
create_env_file() {
    print_step "Creating environment configuration..."

    if [ -f "$OVERSEER_DIR/.env" ]; then
        read -p "Environment file exists. Overwrite? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_warning "Keeping existing .env file"
            # Load existing env for display later
            source "$OVERSEER_DIR/.env" 2>/dev/null || true
            return 0
        fi
    fi

    # Interactive configuration
    echo ""
    echo -e "${BOLD}Configure Overseer:${NC}"
    echo ""

    read -p "Web admin port [3000]: " PORT
    PORT=${PORT:-3000}

    read -p "OpenAI API Key (optional): " OPENAI_API_KEY
    read -p "Anthropic API Key (optional): " ANTHROPIC_API_KEY
    read -p "Telegram Bot Token (optional): " TELEGRAM_BOT_TOKEN
    read -p "Telegram Allowed Users (comma-separated, optional): " TELEGRAM_ALLOWED_USERS

    cat > "$OVERSEER_DIR/.env" << EOF
# ============================================
# Overseer Docker Configuration
# Generated on $(date)
# ============================================

# Application
NODE_ENV=production
PORT=$PORT
BASE_URL=http://localhost:$PORT

# Security (AUTO-GENERATED)
SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY

# Admin
DEFAULT_ADMIN_USERNAME=admin
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
AGENT_MAX_STEPS=25
AGENT_TIMEOUT_MS=120000
ALLOW_SHELL_COMMANDS=true

# Host paths for file access (optional)
HOST_HOME=$HOME
HOST_PROJECTS=/opt/projects
EOF

    chmod 600 "$OVERSEER_DIR/.env"
    print_success "Environment file created"
}

# Create Docker volumes
create_volumes() {
    print_step "Creating Docker volumes..."

    docker volume create overseer-data 2>/dev/null || true
    docker volume create overseer-skills 2>/dev/null || true

    print_success "Volumes created: overseer-data, overseer-skills"
}

# Build and start containers
start_containers() {
    print_step "Building and starting containers..."

    cd "$OVERSEER_DIR"

    echo ""
    echo "This may take a few minutes on first run..."
    echo ""

    # Build images
    docker compose build

    # Start services
    docker compose up -d

    print_success "Containers started"
}

# Wait for services to be healthy
wait_for_health() {
    print_step "Waiting for services to be healthy..."

    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if docker compose ps | grep -q "healthy"; then
            print_success "Services are healthy"
            return 0
        fi

        if docker compose ps | grep -q "unhealthy\|Exit"; then
            print_error "Service health check failed"
            echo ""
            echo "Check logs with: docker compose logs"
            return 1
        fi

        echo "  Waiting... (attempt $attempt/$max_attempts)"
        sleep 5
        attempt=$((attempt + 1))
    done

    print_warning "Timeout waiting for health check"
    echo "Services may still be starting. Check with: docker compose ps"
}

# Create management script
create_docker_script() {
    print_step "Creating Docker management script..."

    cat > "$OVERSEER_DIR/overseer-docker" << 'SCRIPT'
#!/bin/bash

# Overseer Docker Management Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

case "${1:-help}" in
    start)
        echo -e "${GREEN}Starting Overseer containers...${NC}"
        docker compose up -d
        ;;
    stop)
        echo -e "${YELLOW}Stopping Overseer containers...${NC}"
        docker compose down
        ;;
    restart)
        echo -e "${CYAN}Restarting Overseer containers...${NC}"
        docker compose restart
        ;;
    status)
        docker compose ps
        ;;
    logs)
        if [ -n "$2" ]; then
            docker compose logs -f "$2"
        else
            docker compose logs -f
        fi
        ;;
    build)
        echo -e "${CYAN}Rebuilding Overseer containers...${NC}"
        docker compose build --no-cache
        docker compose up -d
        ;;
    update)
        echo -e "${CYAN}Updating Overseer...${NC}"
        git pull
        docker compose build
        docker compose up -d
        ;;
    shell)
        service="${2:-web}"
        docker compose exec "$service" /bin/sh
        ;;
    db)
        echo "Opening database..."
        docker compose exec web sqlite3 /app/data/overseer.db
        ;;
    clean)
        echo -e "${YELLOW}Cleaning up unused Docker resources...${NC}"
        docker system prune -f
        ;;
    help|*)
        echo "Overseer Docker Management Script"
        echo ""
        echo "Usage: ./overseer-docker <command> [options]"
        echo ""
        echo "Commands:"
        echo "  start              Start all containers"
        echo "  stop               Stop all containers"
        echo "  restart            Restart all containers"
        echo "  status             Show container status"
        echo "  logs [service]     View logs (web, telegram-bot)"
        echo "  build              Rebuild containers"
        echo "  update             Pull and rebuild"
        echo "  shell [service]    Open shell in container"
        echo "  db                 Open SQLite database"
        echo "  clean              Clean unused Docker resources"
        echo "  help               Show this help"
        ;;
esac
SCRIPT

    chmod +x "$OVERSEER_DIR/overseer-docker"
    print_success "Management script created: $OVERSEER_DIR/overseer-docker"
}

# Print final success message
print_success_message() {
    echo ""
    echo -e "${GREEN}"
    echo "=============================================="
    echo "  Overseer Docker Installation Complete!"
    echo "=============================================="
    echo -e "${NC}"
    echo ""
    echo "Installation Directory: $OVERSEER_DIR"
    echo ""
    echo -e "${BOLD}Admin Credentials:${NC}"
    echo "  Username: admin"
    echo "  Password: $ADMIN_PASSWORD"
    echo ""
    echo -e "${BOLD}Container Status:${NC}"
    docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null || docker compose ps
    echo ""
    echo -e "${BOLD}Access:${NC}"
    echo "  Web Admin: http://localhost:${PORT:-3000}"
    echo ""
    echo -e "${BOLD}Commands:${NC}"
    echo "  ./overseer-docker start     - Start containers"
    echo "  ./overseer-docker stop      - Stop containers"
    echo "  ./overseer-docker status    - Show status"
    echo "  ./overseer-docker logs      - View logs"
    echo "  ./overseer-docker update    - Update and rebuild"
    echo ""
    echo -e "${BOLD}Useful Docker Commands:${NC}"
    echo "  docker compose logs -f                    # Follow all logs"
    echo "  docker compose logs -f telegram-bot      # Follow bot logs"
    echo "  docker compose exec web /bin/sh          # Shell into web container"
    echo ""
}

# Main
main() {
    detect_os
    print_banner

    # Check if in Overseer directory
    if [ ! -f "$OVERSEER_DIR/docker-compose.yml" ]; then
        print_error "docker-compose.yml not found in $OVERSEER_DIR"
        echo "Please run this script from the Overseer directory"
        exit 1
    fi

    cd "$OVERSEER_DIR"

    install_docker
    verify_docker

    # Check if user needs to re-login
    if ! docker info &>/dev/null; then
        echo ""
        print_warning "You may need to log out and back in for Docker group permissions"
        echo "Then run this script again"
        exit 0
    fi

    generate_secrets
    create_env_file
    create_volumes
    start_containers
    wait_for_health
    create_docker_script
    print_success_message
}

# Run
main "$@"
