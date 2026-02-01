#!/bin/bash
################################################################################
# MyBot Backup Script
# 
# This script creates automated backups of:
# - SQLite database (with WAL checkpoint)
# - Environment configuration
# - Logs
# - Custom skills
#
# Usage:
#   ./backup.sh [destination_directory]
#
# Features:
# - Automatic retention policy (keeps last N backups)
# - Compression to save space
# - Backup verification
# - Remote backup support (rsync/scp)
################################################################################

set -euo pipefail

# ======================
# Configuration
# ======================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default settings
BACKUP_RETENTION_DAYS=30
MAX_BACKUPS=10
COMPRESS=true
VERIFY_BACKUP=true

# Paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BACKUP_ROOT="${1:-${PROJECT_ROOT}/backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"

# Load .env if exists
if [ -f "${PROJECT_ROOT}/.env" ]; then
    set -a
    source "${PROJECT_ROOT}/.env"
    set +a
fi

DATABASE_PATH="${DATABASE_PATH:-./data/mybot.db}"
DATA_DIR="$(dirname "$DATABASE_PATH")"

# ======================
# Functions
# ======================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Create backup directory
create_backup_dir() {
    log_info "Creating backup directory: ${BACKUP_DIR}"
    mkdir -p "${BACKUP_DIR}"
}

# Backup SQLite database with WAL checkpoint
backup_database() {
    log_info "Backing up SQLite database..."
    
    # Get absolute path to database
    DB_PATH="${PROJECT_ROOT}/${DATABASE_PATH}"
    
    if [ ! -f "${DB_PATH}" ]; then
        log_warn "Database file not found: ${DB_PATH}"
        return 1
    fi
    
    # Checkpoint WAL to ensure consistency
    log_info "Checkpointing WAL..."
    sqlite3 "${DB_PATH}" "PRAGMA wal_checkpoint(FULL);" 2>/dev/null || true
    
    # Create backup using SQLite backup API
    log_info "Creating database backup..."
    sqlite3 "${DB_PATH}" ".backup '${BACKUP_DIR}/mybot.db'"
    
    # Also backup WAL and SHM files if they exist
    if [ -f "${DB_PATH}-wal" ]; then
        cp "${DB_PATH}-wal" "${BACKUP_DIR}/mybot.db-wal"
    fi
    
    if [ -f "${DB_PATH}-shm" ]; then
        cp "${DB_PATH}-shm" "${BACKUP_DIR}/mybot.db-shm"
    fi
    
    log_success "Database backed up successfully"
}

# Backup environment files
backup_env() {
    log_info "Backing up environment configuration..."
    
    if [ -f "${PROJECT_ROOT}/.env" ]; then
        cp "${PROJECT_ROOT}/.env" "${BACKUP_DIR}/.env"
        log_success "Environment file backed up"
    else
        log_warn ".env file not found"
    fi
    
    if [ -f "${PROJECT_ROOT}/.env.agent" ]; then
        cp "${PROJECT_ROOT}/.env.agent" "${BACKUP_DIR}/.env.agent"
        log_success "Agent environment file backed up"
    fi
}

# Backup logs
backup_logs() {
    log_info "Backing up logs..."
    
    LOG_DIR="${PROJECT_ROOT}/logs"
    
    if [ -d "${LOG_DIR}" ]; then
        mkdir -p "${BACKUP_DIR}/logs"
        
        # Only backup recent logs (last 7 days)
        find "${LOG_DIR}" -type f -mtime -7 -exec cp {} "${BACKUP_DIR}/logs/" \;
        
        log_success "Logs backed up"
    else
        log_warn "Logs directory not found"
    fi
}

# Backup custom skills
backup_skills() {
    log_info "Backing up custom skills..."
    
    SKILLS_DIR="${PROJECT_ROOT}/skills"
    
    if [ -d "${SKILLS_DIR}" ]; then
        cp -r "${SKILLS_DIR}" "${BACKUP_DIR}/skills"
        log_success "Skills backed up"
    else
        log_warn "Skills directory not found"
    fi
}

# Backup data directory (excluding database already backed up)
backup_data() {
    log_info "Backing up data directory..."
    
    DATA_DIR="${PROJECT_ROOT}/data"
    
    if [ -d "${DATA_DIR}" ]; then
        mkdir -p "${BACKUP_DIR}/data"
        
        # Copy everything except SQLite files (already backed up)
        find "${DATA_DIR}" -type f ! -name '*.db*' -exec cp {} "${BACKUP_DIR}/data/" \; 2>/dev/null || true
        
        log_success "Data directory backed up"
    fi
}

# Create backup manifest
create_manifest() {
    log_info "Creating backup manifest..."
    
    cat > "${BACKUP_DIR}/MANIFEST.txt" <<EOF
MyBot Backup Manifest
=====================
Created: $(date)
Hostname: $(hostname)
User: $(whoami)
MyBot Version: $(cat "${PROJECT_ROOT}/package.json" | grep '"version"' | head -1 | awk -F: '{ print $2 }' | sed 's/[", ]//g')

Backup Contents:
EOF
    
    # List all files with sizes
    find "${BACKUP_DIR}" -type f -exec ls -lh {} \; | awk '{print $9, "(" $5 ")"}' >> "${BACKUP_DIR}/MANIFEST.txt"
    
    log_success "Manifest created"
}

# Verify backup integrity
verify_backup() {
    if [ "$VERIFY_BACKUP" != "true" ]; then
        return 0
    fi
    
    log_info "Verifying backup integrity..."
    
    # Verify database can be opened
    if [ -f "${BACKUP_DIR}/mybot.db" ]; then
        sqlite3 "${BACKUP_DIR}/mybot.db" "PRAGMA integrity_check;" > /dev/null 2>&1
        
        if [ $? -eq 0 ]; then
            log_success "Database integrity verified"
        else
            log_error "Database integrity check failed!"
            return 1
        fi
    fi
    
    # Verify essential files exist
    if [ ! -f "${BACKUP_DIR}/.env" ]; then
        log_warn "Environment file missing from backup"
    fi
    
    log_success "Backup verification complete"
}

# Compress backup
compress_backup() {
    if [ "$COMPRESS" != "true" ]; then
        return 0
    fi
    
    log_info "Compressing backup..."
    
    cd "${BACKUP_ROOT}"
    tar -czf "${TIMESTAMP}.tar.gz" "${TIMESTAMP}"
    
    if [ $? -eq 0 ]; then
        # Remove uncompressed directory
        rm -rf "${BACKUP_DIR}"
        
        COMPRESSED_SIZE=$(du -h "${TIMESTAMP}.tar.gz" | cut -f1)
        log_success "Backup compressed: ${TIMESTAMP}.tar.gz (${COMPRESSED_SIZE})"
    else
        log_error "Compression failed"
        return 1
    fi
}

# Clean old backups
cleanup_old_backups() {
    log_info "Cleaning up old backups..."
    
    # Remove backups older than retention period
    find "${BACKUP_ROOT}" -type f -name "*.tar.gz" -mtime +${BACKUP_RETENTION_DAYS} -delete
    find "${BACKUP_ROOT}" -type d -mtime +${BACKUP_RETENTION_DAYS} -exec rm -rf {} + 2>/dev/null || true
    
    # Keep only last N backups
    BACKUP_COUNT=$(find "${BACKUP_ROOT}" -maxdepth 1 -type f -name "*.tar.gz" | wc -l)
    
    if [ "$BACKUP_COUNT" -gt "$MAX_BACKUPS" ]; then
        REMOVE_COUNT=$((BACKUP_COUNT - MAX_BACKUPS))
        
        find "${BACKUP_ROOT}" -maxdepth 1 -type f -name "*.tar.gz" -printf '%T+ %p\n' | \
            sort | head -n ${REMOVE_COUNT} | cut -d' ' -f2 | xargs rm -f
        
        log_info "Removed ${REMOVE_COUNT} old backup(s)"
    fi
    
    log_success "Cleanup complete"
}

# Remote backup (optional)
remote_backup() {
    if [ -z "${REMOTE_BACKUP_HOST:-}" ]; then
        return 0
    fi
    
    log_info "Uploading backup to remote server..."
    
    REMOTE_PATH="${REMOTE_BACKUP_PATH:-/backups/mybot}"
    BACKUP_FILE="${TIMESTAMP}.tar.gz"
    
    if [ -f "${BACKUP_ROOT}/${BACKUP_FILE}" ]; then
        rsync -avz "${BACKUP_ROOT}/${BACKUP_FILE}" \
            "${REMOTE_BACKUP_USER}@${REMOTE_BACKUP_HOST}:${REMOTE_PATH}/"
        
        if [ $? -eq 0 ]; then
            log_success "Remote backup uploaded successfully"
        else
            log_error "Remote backup upload failed"
            return 1
        fi
    fi
}

# ======================
# Main Script
# ======================

main() {
    echo ""
    echo "╔════════════════════════════════════════╗"
    echo "║       MyBot Backup Script              ║"
    echo "╚════════════════════════════════════════╝"
    echo ""
    
    log_info "Starting backup process..."
    log_info "Backup destination: ${BACKUP_DIR}"
    echo ""
    
    # Check if SQLite is installed
    if ! command -v sqlite3 &> /dev/null; then
        log_error "sqlite3 is not installed. Please install it first."
        exit 1
    fi
    
    # Create backup
    create_backup_dir
    backup_database
    backup_env
    backup_logs
    backup_skills
    backup_data
    create_manifest
    verify_backup
    
    # Compress if enabled
    compress_backup
    
    # Remote backup if configured
    remote_backup
    
    # Cleanup old backups
    cleanup_old_backups
    
    echo ""
    log_success "✨ Backup completed successfully!"
    
    if [ "$COMPRESS" = "true" ]; then
        BACKUP_SIZE=$(du -h "${BACKUP_ROOT}/${TIMESTAMP}.tar.gz" 2>/dev/null | cut -f1 || echo "unknown")
        echo ""
        echo "Backup file: ${BACKUP_ROOT}/${TIMESTAMP}.tar.gz"
        echo "Size: ${BACKUP_SIZE}"
    else
        BACKUP_SIZE=$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1 || echo "unknown")
        echo ""
        echo "Backup directory: ${BACKUP_DIR}"
        echo "Size: ${BACKUP_SIZE}"
    fi
    
    echo ""
}

# ======================
# Restore Function (bonus)
# ======================

restore_backup() {
    BACKUP_FILE="$1"
    
    if [ -z "$BACKUP_FILE" ]; then
        log_error "Please specify a backup file to restore"
        echo "Usage: $0 restore <backup_file.tar.gz>"
        exit 1
    fi
    
    if [ ! -f "$BACKUP_FILE" ]; then
        log_error "Backup file not found: $BACKUP_FILE"
        exit 1
    fi
    
    log_warn "⚠️  This will restore from backup and overwrite existing data!"
    read -p "Are you sure you want to continue? (yes/no): " -r
    
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log_info "Restore cancelled"
        exit 0
    fi
    
    log_info "Extracting backup..."
    RESTORE_DIR="/tmp/mybot_restore_$$"
    mkdir -p "$RESTORE_DIR"
    tar -xzf "$BACKUP_FILE" -C "$RESTORE_DIR"
    
    # Find the extracted directory
    EXTRACTED_DIR=$(find "$RESTORE_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)
    
    if [ -z "$EXTRACTED_DIR" ]; then
        log_error "Failed to extract backup"
        exit 1
    fi
    
    log_info "Stopping MyBot services..."
    systemctl stop mybot.service mybot-telegram.service mybot-discord.service 2>/dev/null || true
    
    log_info "Restoring database..."
    if [ -f "$EXTRACTED_DIR/mybot.db" ]; then
        cp "$EXTRACTED_DIR/mybot.db" "${PROJECT_ROOT}/${DATABASE_PATH}"
    fi
    
    log_info "Restoring environment..."
    if [ -f "$EXTRACTED_DIR/.env" ]; then
        cp "$EXTRACTED_DIR/.env" "${PROJECT_ROOT}/.env"
    fi
    
    log_info "Restoring skills..."
    if [ -d "$EXTRACTED_DIR/skills" ]; then
        cp -r "$EXTRACTED_DIR/skills" "${PROJECT_ROOT}/"
    fi
    
    # Cleanup
    rm -rf "$RESTORE_DIR"
    
    log_success "Restore completed successfully!"
    log_info "Please restart MyBot services manually"
}

# ======================
# Script Entry Point
# ======================

if [ "${1:-}" = "restore" ]; then
    restore_backup "${2:-}"
else
    main
fi
