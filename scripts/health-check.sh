#!/bin/bash
################################################################################
# MyBot Health Check & Monitoring Script
# 
# This script monitors the health of MyBot services and alerts on issues:
# - Web server API health
# - Telegram bot status
# - Discord bot status
# - Agent runner status
# - Database integrity
# - Disk space
# - Memory usage
# - Process monitoring
#
# Usage:
#   ./health-check.sh [--verbose] [--alert]
#
# Can be run via cron for continuous monitoring:
#   */5 * * * * /opt/mybot/scripts/health-check.sh --alert
################################################################################

set -euo pipefail

# ======================
# Configuration
# ======================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Script settings
VERBOSE=false
ALERT=false
EXIT_CODE=0

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="${PROJECT_ROOT}/logs/health-check.log"

# Load environment
if [ -f "${PROJECT_ROOT}/.env" ]; then
    set -a
    source "${PROJECT_ROOT}/.env"
    set +a
fi

PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://localhost:${PORT}}"
DATABASE_PATH="${DATABASE_PATH:-./data/mybot.db}"

# Thresholds
DISK_SPACE_WARN=80
DISK_SPACE_CRIT=90
MEMORY_WARN=80
MEMORY_CRIT=90

# Parse arguments
for arg in "$@"; do
    case $arg in
        --verbose|-v)
            VERBOSE=true
            ;;
        --alert|-a)
            ALERT=true
            ;;
        --help|-h)
            echo "Usage: $0 [--verbose] [--alert]"
            echo ""
            echo "Options:"
            echo "  --verbose, -v    Show detailed output"
            echo "  --alert, -a      Send alerts on failures"
            echo "  --help, -h       Show this help message"
            exit 0
            ;;
    esac
done

# ======================
# Functions
# ======================

log() {
    local level="$1"
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Ensure log directory exists
    mkdir -p "$(dirname "$LOG_FILE")"
    
    echo "[$timestamp] [$level] $message" >> "$LOG_FILE"
    
    if [ "$VERBOSE" = true ] || [ "$level" = "ERROR" ] || [ "$level" = "WARN" ]; then
        case $level in
            ERROR)
                echo -e "${RED}✗ [ERROR]${NC} $message"
                ;;
            WARN)
                echo -e "${YELLOW}⚠ [WARN]${NC} $message"
                ;;
            OK)
                echo -e "${GREEN}✓ [OK]${NC} $message"
                ;;
            INFO)
                echo -e "${BLUE}ℹ [INFO]${NC} $message"
                ;;
        esac
    fi
}

check_web_server() {
    log INFO "Checking web server health..."
    
    # Check if port is listening
    if ! nc -z localhost "$PORT" 2>/dev/null; then
        log ERROR "Web server not listening on port $PORT"
        EXIT_CODE=1
        return 1
    fi
    
    # Check health endpoint
    local response=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/health" 2>/dev/null || echo "000")
    
    if [ "$response" = "200" ]; then
        log OK "Web server is healthy (HTTP $response)"
        return 0
    else
        log ERROR "Web server health check failed (HTTP $response)"
        EXIT_CODE=1
        return 1
    fi
}

check_telegram_bot() {
    log INFO "Checking Telegram bot..."
    
    # Check if Telegram bot token is configured
    if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
        log INFO "Telegram bot not configured (skipping)"
        return 0
    fi
    
    # Check if process is running
    if pgrep -f "tsx.*bot/index.ts" > /dev/null || pgrep -f "node.*bot/index.js" > /dev/null; then
        log OK "Telegram bot process is running"
        return 0
    else
        log ERROR "Telegram bot process not found"
        EXIT_CODE=1
        return 1
    fi
}

check_discord_bot() {
    log INFO "Checking Discord bot..."
    
    # Check if Discord bot token is configured
    if [ -z "${DISCORD_BOT_TOKEN:-}" ]; then
        log INFO "Discord bot not configured (skipping)"
        return 0
    fi
    
    # Check if process is running
    if pgrep -f "tsx.*bot/discord.ts" > /dev/null || pgrep -f "node.*bot/discord.js" > /dev/null; then
        log OK "Discord bot process is running"
        return 0
    else
        log ERROR "Discord bot process not found"
        EXIT_CODE=1
        return 1
    fi
}

check_agent_runner() {
    log INFO "Checking agent runner..."
    
    # Check if process is running
    if pgrep -f "tsx.*agent/runner.ts" > /dev/null || pgrep -f "node.*agent/runner.js" > /dev/null; then
        log OK "Agent runner process is running"
        return 0
    else
        log WARN "Agent runner process not found (may be optional)"
        return 0
    fi
}

check_database() {
    log INFO "Checking database integrity..."
    
    local db_path="${PROJECT_ROOT}/${DATABASE_PATH}"
    
    if [ ! -f "$db_path" ]; then
        log ERROR "Database file not found: $db_path"
        EXIT_CODE=1
        return 1
    fi
    
    # Check if sqlite3 is available
    if ! command -v sqlite3 &> /dev/null; then
        log WARN "sqlite3 not installed, skipping database integrity check"
        return 0
    fi
    
    # Run integrity check
    local integrity=$(sqlite3 "$db_path" "PRAGMA integrity_check;" 2>&1)
    
    if [ "$integrity" = "ok" ]; then
        log OK "Database integrity check passed"
        
        # Get database size
        local db_size=$(du -h "$db_path" | cut -f1)
        log INFO "Database size: $db_size"
        
        return 0
    else
        log ERROR "Database integrity check failed: $integrity"
        EXIT_CODE=1
        return 1
    fi
}

check_disk_space() {
    log INFO "Checking disk space..."
    
    local usage=$(df -h "${PROJECT_ROOT}" | awk 'NR==2 {print $5}' | sed 's/%//')
    
    if [ -z "$usage" ]; then
        log WARN "Could not determine disk usage"
        return 0
    fi
    
    if [ "$usage" -ge "$DISK_SPACE_CRIT" ]; then
        log ERROR "Disk space critical: ${usage}% used"
        EXIT_CODE=1
        return 1
    elif [ "$usage" -ge "$DISK_SPACE_WARN" ]; then
        log WARN "Disk space warning: ${usage}% used"
        return 0
    else
        log OK "Disk space OK: ${usage}% used"
        return 0
    fi
}

check_memory() {
    log INFO "Checking memory usage..."
    
    # Try different methods to get memory usage
    local usage=""
    
    if command -v free &> /dev/null; then
        usage=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
    elif [ -f /proc/meminfo ]; then
        local total=$(grep MemTotal /proc/meminfo | awk '{print $2}')
        local available=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
        usage=$(awk "BEGIN {print int((($total - $available) / $total) * 100)}")
    else
        log WARN "Could not determine memory usage"
        return 0
    fi
    
    if [ -n "$usage" ]; then
        if [ "$usage" -ge "$MEMORY_CRIT" ]; then
            log ERROR "Memory usage critical: ${usage}%"
            EXIT_CODE=1
            return 1
        elif [ "$usage" -ge "$MEMORY_WARN" ]; then
            log WARN "Memory usage warning: ${usage}%"
            return 0
        else
            log OK "Memory usage OK: ${usage}%"
            return 0
        fi
    fi
}

check_log_files() {
    log INFO "Checking log files..."
    
    local log_dir="${PROJECT_ROOT}/logs"
    
    if [ ! -d "$log_dir" ]; then
        log INFO "No logs directory found"
        return 0
    fi
    
    # Check for recent errors
    local error_count=0
    
    if [ -d "$log_dir" ]; then
        # Count errors in the last hour
        error_count=$(find "$log_dir" -type f -name "*.log" -mmin -60 -exec grep -i "error\|exception\|fatal" {} \; 2>/dev/null | wc -l)
    fi
    
    if [ "$error_count" -gt 100 ]; then
        log WARN "Found $error_count errors in logs in the last hour"
    elif [ "$error_count" -gt 0 ]; then
        log INFO "Found $error_count errors in logs in the last hour"
    else
        log OK "No recent errors in logs"
    fi
    
    # Check log file sizes
    local large_logs=$(find "$log_dir" -type f -size +100M 2>/dev/null)
    
    if [ -n "$large_logs" ]; then
        log WARN "Large log files detected (>100MB):"
        echo "$large_logs" | while read -r file; do
            local size=$(du -h "$file" | cut -f1)
            log WARN "  $file ($size)"
        done
    fi
}

check_systemd_services() {
    log INFO "Checking systemd services..."
    
    # Only check if systemd is available
    if ! command -v systemctl &> /dev/null; then
        log INFO "systemd not available, skipping service checks"
        return 0
    fi
    
    local services=(
        "mybot.service"
        "mybot-telegram.service"
        "mybot-discord.service"
    )
    
    for service in "${services[@]}"; do
        if systemctl list-unit-files | grep -q "$service"; then
            if systemctl is-active --quiet "$service"; then
                log OK "Service $service is active"
            else
                local status=$(systemctl is-active "$service" || true)
                log ERROR "Service $service is $status"
                EXIT_CODE=1
            fi
        fi
    done
}

send_alert() {
    if [ "$ALERT" != true ] || [ "$EXIT_CODE" -eq 0 ]; then
        return 0
    fi
    
    log INFO "Sending alert notification..."
    
    # Email alert (if configured)
    if [ -n "${ALERT_EMAIL:-}" ] && command -v mail &> /dev/null; then
        echo "MyBot health check failed on $(hostname) at $(date)" | \
            mail -s "MyBot Health Check Alert" "$ALERT_EMAIL"
        log INFO "Alert sent to $ALERT_EMAIL"
    fi
    
    # Webhook alert (if configured)
    if [ -n "${ALERT_WEBHOOK:-}" ]; then
        curl -X POST "$ALERT_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "{\"text\":\"MyBot health check failed on $(hostname)\",\"timestamp\":\"$(date -Iseconds)\"}" \
            &>/dev/null || true
        log INFO "Alert sent to webhook"
    fi
}

generate_report() {
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║   MyBot Health Check Report            ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    echo "Time: $(date)"
    echo "Host: $(hostname)"
    echo ""
    echo "Status: $([ $EXIT_CODE -eq 0 ] && echo -e "${GREEN}HEALTHY${NC}" || echo -e "${RED}UNHEALTHY${NC}")"
    echo ""
    
    if [ "$VERBOSE" = true ]; then
        echo "Recent log entries:"
        echo "-------------------"
        tail -n 20 "$LOG_FILE" 2>/dev/null || echo "No logs available"
        echo ""
    fi
}

# ======================
# Main Health Checks
# ======================

main() {
    if [ "$VERBOSE" = true ]; then
        echo ""
        echo "╔════════════════════════════════════════╗"
        echo "║   MyBot Health Check                   ║"
        echo "╚════════════════════════════════════════╝"
        echo ""
    fi
    
    log INFO "Starting health check..."
    
    # Run all checks
    check_web_server
    check_telegram_bot
    check_discord_bot
    check_agent_runner
    check_database
    check_disk_space
    check_memory
    check_log_files
    check_systemd_services
    
    # Send alerts if needed
    send_alert
    
    # Generate report
    if [ "$VERBOSE" = true ]; then
        generate_report
    fi
    
    log INFO "Health check completed with exit code $EXIT_CODE"
    
    exit $EXIT_CODE
}

# ======================
# Run Health Check
# ======================

main
