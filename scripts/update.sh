#!/bin/bash

#################################################
# Overseer Update Script
# Updates Overseer to the latest version
#################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Configuration
OVERSEER_DIR="${OVERSEER_DIR:-$HOME/overseer}"
BACKUP_DIR="${OVERSEER_DIR}/backups"

# Flags
SHOW_HELP=0
DRY_RUN=0
ASSUME_YES=0

usage() {
    cat <<'EOF'
Overseer Update Script

Usage:
  bash update.sh [--help] [--dry-run] [--yes]

Options:
  -h, --help       Show this help and exit
  --dry-run        Print what would happen, without making changes
  -y, --yes        Skip interactive confirmation prompt

Environment:
  OVERSEER_DIR=/path/to/overseer (default: $HOME/overseer)
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
                ASSUME_YES=1
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

# Detect installation type
detect_installation() {
    if [ -f "$OVERSEER_DIR/docker-compose.yml" ] && command -v docker &>/dev/null; then
        if docker compose ps 2>/dev/null | grep -q "overseer"; then
            INSTALL_TYPE="docker"
            return
        fi
    fi

    if systemctl is-active --quiet overseer 2>/dev/null; then
        INSTALL_TYPE="systemd"
        return
    fi

    if launchctl list 2>/dev/null | grep -q "overseer"; then
        INSTALL_TYPE="launchd"
        return
    fi

    INSTALL_TYPE="manual"
}

# Create backup
create_backup() {
    print_step "Creating backup..."

    mkdir -p "$BACKUP_DIR"
    BACKUP_FILE="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).tar.gz"

    # Backup database and .env
    tar -czf "$BACKUP_FILE" \
        -C "$OVERSEER_DIR" \
        data/ \
        .env \
        2>/dev/null || true

    print_success "Backup created: $BACKUP_FILE"
}

# Stop services
stop_services() {
    print_step "Stopping services..."

    case "$INSTALL_TYPE" in
        docker)
            cd "$OVERSEER_DIR"
            docker compose down
            ;;
        systemd)
            sudo systemctl stop overseer overseer-telegram 2>/dev/null || true
            ;;
        launchd)
            launchctl unload ~/Library/LaunchAgents/com.overseer.web.plist 2>/dev/null || true
            launchctl unload ~/Library/LaunchAgents/com.overseer.telegram.plist 2>/dev/null || true
            ;;
        *)
            print_warning "Could not detect service manager, please stop services manually"
            ;;
    esac

    print_success "Services stopped"
}

# Pull latest changes
pull_updates() {
    print_step "Pulling latest changes..."

    cd "$OVERSEER_DIR"

    if [ -d ".git" ]; then
        # Stash any local changes
        git stash 2>/dev/null || true

        # Pull latest
        git pull origin main

        # Try to restore local changes
        git stash pop 2>/dev/null || true

        print_success "Repository updated"
    else
        print_warning "Not a git repository, skipping git pull"
    fi
}

# Update dependencies
update_dependencies() {
    print_step "Updating dependencies..."

    cd "$OVERSEER_DIR"

    if [ "$INSTALL_TYPE" == "docker" ]; then
        print_substep "Rebuilding Docker images..."
        docker compose build
    else
        if command -v pnpm &>/dev/null; then
            pnpm install --no-frozen-lockfile
        else
            npm install
        fi
    fi

    print_success "Dependencies updated"
}

# Run database migrations
run_migrations() {
    print_step "Running database migrations..."

    cd "$OVERSEER_DIR"

    if [ "$INSTALL_TYPE" == "docker" ]; then
        # Run in container
        docker compose run --rm web npm run db:init
    else
        if command -v pnpm &>/dev/null; then
            pnpm run db:init
        else
            npm run db:init
        fi
    fi

    print_success "Database updated"
}

# Build application
build_application() {
    print_step "Building application..."

    cd "$OVERSEER_DIR"

    if [ "$INSTALL_TYPE" == "docker" ]; then
        # Already built during docker compose build
        print_success "Application built (Docker)"
    else
        print_substep "Cleaning previous build..."
        rm -rf .next
        if command -v pnpm &>/dev/null; then
            pnpm run build 2>&1 | tail -10
        else
            npm run build 2>&1 | tail -10
        fi

        # Verify build output exists
        if [ ! -d ".next" ]; then
            print_error "Build failed - .next directory not found"
            exit 1
        fi

        print_success "Application built (using next start)"
    fi
}

# Start services
start_services() {
    print_step "Starting services..."

    # If systemd, update the service file to use next start (in case upgrading from standalone)
    if [ "$INSTALL_TYPE" == "systemd" ]; then
        local npx_path=$(which npx)
        local PORT=$(grep "^PORT=" "$OVERSEER_DIR/.env" 2>/dev/null | cut -d'=' -f2)
        PORT=${PORT:-3000}

        sudo tee /etc/systemd/system/overseer.service > /dev/null << SVCEOF
[Unit]
Description=Overseer AI Agent - Web Admin Dashboard
Documentation=https://github.com/ErzenXz/overseer
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${OVERSEER_DIR}
ExecStart=${npx_path} next start -H 0.0.0.0 -p ${PORT}
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=overseer
Environment=NODE_ENV=production
Environment=PORT=${PORT}
EnvironmentFile=${OVERSEER_DIR}/.env
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=${OVERSEER_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SVCEOF
        sudo systemctl daemon-reload
        print_success "Systemd service updated to use next start"
    fi

    case "$INSTALL_TYPE" in
        docker)
            cd "$OVERSEER_DIR"
            docker compose up -d
            ;;
        systemd)
            sudo systemctl start overseer overseer-telegram
            ;;
        launchd)
            launchctl load ~/Library/LaunchAgents/com.overseer.web.plist 2>/dev/null || true
            launchctl load ~/Library/LaunchAgents/com.overseer.telegram.plist 2>/dev/null || true
            ;;
        *)
            print_warning "Please start services manually"
            echo "  ./overseer start"
            ;;
    esac

    print_success "Services started"
}

# Verify update
verify_update() {
    print_step "Verifying update..."

    sleep 3  # Wait for services to start

    case "$INSTALL_TYPE" in
        docker)
            if docker compose ps | grep -q "healthy\|running"; then
                print_success "Containers are running"
            else
                print_warning "Some containers may not be healthy"
                docker compose ps
            fi
            ;;
        systemd)
            if systemctl is-active --quiet overseer; then
                print_success "Web service is running"
            else
                print_warning "Web service may not be running"
            fi
            if systemctl is-active --quiet overseer-telegram; then
                print_success "Telegram bot is running"
            else
                print_warning "Telegram bot may not be running"
            fi
            ;;
        launchd)
            if launchctl list | grep -q "overseer.web"; then
                print_success "Web service is running"
            fi
            if launchctl list | grep -q "overseer.telegram"; then
                print_success "Telegram bot is running"
            fi
            ;;
    esac

    # Try to reach the health endpoint
    local PORT=$(grep "^PORT=" "$OVERSEER_DIR/.env" 2>/dev/null | cut -d'=' -f2)
    PORT=${PORT:-3000}

    if curl -sf "http://localhost:$PORT/api/health" &>/dev/null; then
        print_success "Health check passed"
    else
        print_warning "Health check not available yet (service may still be starting)"
    fi
}

# Print completion message
print_completion() {
    echo ""
    echo -e "${GREEN}"
    echo "=============================================="
    echo "  Overseer Update Complete!"
    echo "=============================================="
    echo -e "${NC}"
    echo ""

    if [ -n "$BACKUP_FILE" ]; then
        echo "Backup: $BACKUP_FILE"
        echo ""
    fi

    echo "Check status with:"
    case "$INSTALL_TYPE" in
        docker)
            echo "  docker compose ps"
            echo "  docker compose logs -f"
            ;;
        systemd)
            echo "  sudo systemctl status overseer"
            echo "  sudo journalctl -u overseer -f"
            ;;
        launchd)
            echo "  ./overseer status"
            echo "  tail -f ~/overseer/logs/*.log"
            ;;
        *)
            echo "  ./overseer status"
            ;;
    esac
    echo ""
}

# Rollback function
rollback() {
    print_error "Update failed, attempting rollback..."

    if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
        cd "$OVERSEER_DIR"
        tar -xzf "$BACKUP_FILE"
        print_warning "Restored from backup: $BACKUP_FILE"
    fi

    start_services
    exit 1
}

# Main
main() {
    echo ""
    echo -e "${BOLD}Overseer Update Script${NC}"
    echo ""

    parse_args "$@"
    if [ "$SHOW_HELP" -eq 1 ]; then
        usage
        exit 0
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        print_step "DRY RUN"
        echo "Overseer dir: $OVERSEER_DIR"
        echo ""
        echo "Planned steps:"
        echo "  - Create backup (data/ + .env)"
        echo "  - Stop services (docker/systemd/launchd/manual)"
        echo "  - Pull updates (git pull origin main)"
        echo "  - Update dependencies (pnpm/npm or docker build)"
        echo "  - Run migrations (db:init)"
        echo "  - Build app (next build)"
        echo "  - Start services and verify health"
        echo ""
        exit 0
    fi

    # Check if in correct directory
    if [ ! -d "$OVERSEER_DIR" ]; then
        print_error "Overseer directory not found: $OVERSEER_DIR"
        exit 1
    fi

    cd "$OVERSEER_DIR"

    # Detect installation type
    detect_installation
    echo "Installation type: $INSTALL_TYPE"
    echo ""

    # Confirm update
    if [ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]; then
        read -p "Continue with update? (Y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Nn]$ ]]; then
            echo "Update cancelled"
            exit 0
        fi
    fi

    # Set up error handling for rollback
    trap rollback ERR

    # Run update steps
    create_backup
    stop_services
    pull_updates
    update_dependencies
    run_migrations
    build_application
    start_services
    verify_update
    print_completion
}

# Run
main "$@"
