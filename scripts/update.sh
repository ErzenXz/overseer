#!/bin/bash

#################################################
# MyBot Update Script
# Updates MyBot to the latest version
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
MYBOT_DIR="${MYBOT_DIR:-$HOME/mybot}"
BACKUP_DIR="${MYBOT_DIR}/backups"

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
    if [ -f "$MYBOT_DIR/docker-compose.yml" ] && command -v docker &>/dev/null; then
        if docker compose ps 2>/dev/null | grep -q "mybot"; then
            INSTALL_TYPE="docker"
            return
        fi
    fi

    if systemctl is-active --quiet mybot 2>/dev/null; then
        INSTALL_TYPE="systemd"
        return
    fi

    if launchctl list 2>/dev/null | grep -q "mybot"; then
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
        -C "$MYBOT_DIR" \
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
            cd "$MYBOT_DIR"
            docker compose down
            ;;
        systemd)
            sudo systemctl stop mybot mybot-telegram 2>/dev/null || true
            ;;
        launchd)
            launchctl unload ~/Library/LaunchAgents/com.mybot.web.plist 2>/dev/null || true
            launchctl unload ~/Library/LaunchAgents/com.mybot.telegram.plist 2>/dev/null || true
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

    cd "$MYBOT_DIR"

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

    cd "$MYBOT_DIR"

    if [ "$INSTALL_TYPE" == "docker" ]; then
        print_substep "Rebuilding Docker images..."
        docker compose build
    else
        if command -v pnpm &>/dev/null; then
            pnpm install
        else
            npm install
        fi
    fi

    print_success "Dependencies updated"
}

# Run database migrations
run_migrations() {
    print_step "Running database migrations..."

    cd "$MYBOT_DIR"

    if [ "$INSTALL_TYPE" == "docker" ]; then
        # Run in container
        docker compose run --rm web npm run db:init
    else
        npm run db:init
    fi

    print_success "Database updated"
}

# Build application
build_application() {
    print_step "Building application..."

    cd "$MYBOT_DIR"

    if [ "$INSTALL_TYPE" == "docker" ]; then
        # Already built during docker compose build
        print_success "Application built (Docker)"
    else
        npm run build 2>&1 | tail -5
        print_success "Application built"
    fi
}

# Start services
start_services() {
    print_step "Starting services..."

    case "$INSTALL_TYPE" in
        docker)
            cd "$MYBOT_DIR"
            docker compose up -d
            ;;
        systemd)
            sudo systemctl start mybot mybot-telegram
            ;;
        launchd)
            launchctl load ~/Library/LaunchAgents/com.mybot.web.plist 2>/dev/null || true
            launchctl load ~/Library/LaunchAgents/com.mybot.telegram.plist 2>/dev/null || true
            ;;
        *)
            print_warning "Please start services manually"
            echo "  ./mybot start"
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
            if systemctl is-active --quiet mybot; then
                print_success "Web service is running"
            else
                print_warning "Web service may not be running"
            fi
            if systemctl is-active --quiet mybot-telegram; then
                print_success "Telegram bot is running"
            else
                print_warning "Telegram bot may not be running"
            fi
            ;;
        launchd)
            if launchctl list | grep -q "mybot.web"; then
                print_success "Web service is running"
            fi
            if launchctl list | grep -q "mybot.telegram"; then
                print_success "Telegram bot is running"
            fi
            ;;
    esac

    # Try to reach the health endpoint
    local PORT=$(grep "^PORT=" "$MYBOT_DIR/.env" 2>/dev/null | cut -d'=' -f2)
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
    echo "  MyBot Update Complete!"
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
            echo "  sudo systemctl status mybot"
            echo "  sudo journalctl -u mybot -f"
            ;;
        launchd)
            echo "  ./mybot status"
            echo "  tail -f ~/mybot/logs/*.log"
            ;;
        *)
            echo "  ./mybot status"
            ;;
    esac
    echo ""
}

# Rollback function
rollback() {
    print_error "Update failed, attempting rollback..."

    if [ -n "$BACKUP_FILE" ] && [ -f "$BACKUP_FILE" ]; then
        cd "$MYBOT_DIR"
        tar -xzf "$BACKUP_FILE"
        print_warning "Restored from backup: $BACKUP_FILE"
    fi

    start_services
    exit 1
}

# Main
main() {
    echo ""
    echo -e "${BOLD}MyBot Update Script${NC}"
    echo ""

    # Check if in correct directory
    if [ ! -d "$MYBOT_DIR" ]; then
        print_error "MyBot directory not found: $MYBOT_DIR"
        exit 1
    fi

    cd "$MYBOT_DIR"

    # Detect installation type
    detect_installation
    echo "Installation type: $INSTALL_TYPE"
    echo ""

    # Confirm update
    read -p "Continue with update? (Y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        echo "Update cancelled"
        exit 0
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
