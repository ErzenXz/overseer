# 🚀 Deployment Guide

Complete guide for deploying MyBot to production environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Deploy](#quick-deploy)
- [VPS Deployment](#vps-deployment)
  - [DigitalOcean](#digitalocean)
  - [AWS EC2](#aws-ec2)
  - [Hetzner](#hetzner)
  - [Linode](#linode)
- [Docker Deployment](#docker-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Systemd Service](#systemd-service)
- [Reverse Proxy Setup](#reverse-proxy-setup)
- [SSL/TLS Configuration](#ssltls-configuration)
- [Environment-Specific Notes](#environment-specific-notes)
- [Performance Tuning](#performance-tuning)
- [Security Hardening](#security-hardening)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Server Requirements**:
  - OS: Ubuntu 22.04+, Debian 11+, CentOS 8+, or Windows Server 2019+
  - RAM: 2GB minimum, 4GB recommended
  - CPU: 2 cores minimum
  - Disk: 10GB minimum
  - Node.js: 20.0.0 or higher

- **Access Requirements**:
  - SSH access to server
  - sudo/administrator privileges
  - Domain name (optional but recommended)

---

## Quick Deploy

### One-Line Production Install

```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/mybot/main/scripts/install.sh | bash -s -- --production
```

This script will:
1. ✅ Install Node.js 20+ if needed
2. ✅ Clone MyBot repository
3. ✅ Install dependencies
4. ✅ Configure environment variables
5. ✅ Set up systemd services
6. ✅ Configure firewall
7. ✅ Start services

---

## VPS Deployment

### DigitalOcean

#### 1. Create Droplet

```bash
# Using doctl CLI
doctl compute droplet create mybot \
  --image ubuntu-22-04-x64 \
  --size s-2vcpu-4gb \
  --region nyc3 \
  --ssh-keys YOUR_SSH_KEY_ID
```

Or use the web interface:
- **Image**: Ubuntu 22.04 LTS
- **Plan**: Basic, $24/month (2 vCPU, 4GB RAM)
- **Datacenter**: Closest to your users
- **SSH Keys**: Add your public key

#### 2. Initial Server Setup

```bash
# Connect to your droplet
ssh root@YOUR_DROPLET_IP

# Update system
apt update && apt upgrade -y

# Create non-root user
adduser mybot
usermod -aG sudo mybot

# Switch to mybot user
su - mybot
```

#### 3. Install MyBot

```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone repository
git clone https://github.com/yourusername/mybot.git
cd mybot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env  # Edit configuration

# Initialize database
npm run db:init

# Build for production
npm run build
```

#### 4. Set Up systemd Services

```bash
# Copy service files
sudo cp systemd/mybot-web.service /etc/systemd/system/
sudo cp systemd/mybot-telegram.service /etc/systemd/system/
sudo cp systemd/mybot-discord.service /etc/systemd/system/

# Edit service files to match your paths
sudo nano /etc/systemd/system/mybot-web.service

# Enable and start services
sudo systemctl daemon-reload
sudo systemctl enable mybot-web mybot-telegram mybot-discord
sudo systemctl start mybot-web mybot-telegram mybot-discord

# Check status
sudo systemctl status mybot-web
```

#### 5. Configure Firewall

```bash
# Install UFW
sudo apt install ufw

# Allow SSH, HTTP, HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable
```

---

### AWS EC2

#### 1. Launch EC2 Instance

```bash
# Using AWS CLI
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \  # Ubuntu 22.04 AMI
  --instance-type t3.medium \
  --key-name YOUR_KEY_PAIR \
  --security-group-ids YOUR_SECURITY_GROUP \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=MyBot}]'
```

#### 2. Configure Security Group

Allow inbound traffic:
- **SSH**: Port 22 (your IP only)
- **HTTP**: Port 80 (0.0.0.0/0)
- **HTTPS**: Port 443 (0.0.0.0/0)

#### 3. Connect and Install

```bash
# Connect via SSH
ssh -i your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP

# Follow the same installation steps as DigitalOcean
```

#### 4. Elastic IP (Recommended)

```bash
# Allocate Elastic IP
aws ec2 allocate-address --domain vpc

# Associate with instance
aws ec2 associate-address \
  --instance-id YOUR_INSTANCE_ID \
  --allocation-id YOUR_ALLOCATION_ID
```

---

### Hetzner

#### 1. Create Server

Via Hetzner Cloud Console:
- **Location**: Nuremberg, Germany (or closest)
- **Image**: Ubuntu 22.04
- **Type**: CX21 (2 vCPU, 4GB RAM) - €5.83/month
- **SSH Key**: Add your public key

#### 2. Install MyBot

```bash
# Connect
ssh root@YOUR_SERVER_IP

# Install Node.js and MyBot (same as DigitalOcean steps)
```

**Cost-effective option**: Hetzner offers great performance at lower cost than AWS/DO.

---

### Linode

#### 1. Create Linode

```bash
# Using Linode CLI
linode-cli linodes create \
  --image linode/ubuntu22.04 \
  --region us-east \
  --type g6-standard-2 \
  --root_pass YOUR_ROOT_PASSWORD
```

#### 2. Follow Standard Setup

Same installation steps as DigitalOcean.

---

## Docker Deployment

### Using Docker Compose (Recommended)

```bash
# 1. Clone repository
git clone https://github.com/yourusername/mybot.git
cd mybot

# 2. Configure environment
cp .env.example .env
nano .env

# 3. Start services
docker-compose up -d

# 4. View logs
docker-compose logs -f

# 5. Stop services
docker-compose down
```

### Manual Docker Build

```bash
# Build image
docker build -t mybot:latest .

# Run container
docker run -d \
  --name mybot \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  --env-file .env \
  mybot:latest
```

### Docker Compose Configuration

```yaml
version: '3.8'

services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
    depends_on:
      - telegram-bot

  telegram-bot:
    build: .
    command: npm run bot
    environment:
      NODE_ENV: production
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped

  discord-bot:
    build: .
    command: npm run discord
    environment:
      NODE_ENV: production
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
    restart: unless-stopped
```

---

## Kubernetes Deployment

### Using Helm Chart

```bash
# 1. Add Helm repository
helm repo add mybot https://charts.mybot.io
helm repo update

# 2. Create values file
cat > values.yaml <<EOF
image:
  repository: mybot/mybot
  tag: latest

env:
  ADMIN_USERNAME: admin
  ADMIN_PASSWORD: your-password
  ENCRYPTION_KEY: your-encryption-key

telegram:
  enabled: true
  token: your-telegram-token
  allowedUsers: "123456789"

discord:
  enabled: true
  token: your-discord-token

ingress:
  enabled: true
  hosts:
    - host: mybot.example.com
      paths:
        - path: /
  tls:
    - secretName: mybot-tls
      hosts:
        - mybot.example.com

persistence:
  enabled: true
  size: 10Gi
EOF

# 3. Install chart
helm install mybot mybot/mybot -f values.yaml

# 4. Check status
kubectl get pods
kubectl logs -f deployment/mybot-web
```

### Manual Kubernetes Deployment

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mybot-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: mybot-web
  template:
    metadata:
      labels:
        app: mybot-web
    spec:
      containers:
      - name: mybot
        image: mybot/mybot:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        volumeMounts:
        - name: data
          mountPath: /app/data
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: mybot-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: mybot-web
spec:
  selector:
    app: mybot-web
  ports:
  - port: 80
    targetPort: 3000
  type: LoadBalancer

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mybot-pvc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
```

Apply:
```bash
kubectl apply -f deployment.yaml
```

---

## Systemd Service

### Service Files

**Web Admin** (`/etc/systemd/system/mybot-web.service`):

```ini
[Unit]
Description=MyBot Web Admin
After=network.target

[Service]
Type=simple
User=mybot
WorkingDirectory=/home/mybot/mybot
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/mybot/web.log
StandardError=append:/var/log/mybot/web-error.log

Environment=NODE_ENV=production
EnvironmentFile=/home/mybot/mybot/.env

[Install]
WantedBy=multi-user.target
```

**Telegram Bot** (`/etc/systemd/system/mybot-telegram.service`):

```ini
[Unit]
Description=MyBot Telegram Bot
After=network.target mybot-web.service

[Service]
Type=simple
User=mybot
WorkingDirectory=/home/mybot/mybot
ExecStart=/usr/bin/npm run bot
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/mybot/telegram.log
StandardError=append:/var/log/mybot/telegram-error.log

Environment=NODE_ENV=production
EnvironmentFile=/home/mybot/mybot/.env

[Install]
WantedBy=multi-user.target
```

**Discord Bot** (`/etc/systemd/system/mybot-discord.service`):

```ini
[Unit]
Description=MyBot Discord Bot
After=network.target mybot-web.service

[Service]
Type=simple
User=mybot
WorkingDirectory=/home/mybot/mybot
ExecStart=/usr/bin/npm run discord
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/mybot/discord.log
StandardError=append:/var/log/mybot/discord-error.log

Environment=NODE_ENV=production
EnvironmentFile=/home/mybot/mybot/.env

[Install]
WantedBy=multi-user.target
```

### Managing Services

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable services (start on boot)
sudo systemctl enable mybot-web mybot-telegram mybot-discord

# Start services
sudo systemctl start mybot-web mybot-telegram mybot-discord

# Check status
sudo systemctl status mybot-web
sudo systemctl status mybot-telegram
sudo systemctl status mybot-discord

# View logs
sudo journalctl -u mybot-web -f
sudo journalctl -u mybot-telegram -f

# Restart services
sudo systemctl restart mybot-web

# Stop services
sudo systemctl stop mybot-web mybot-telegram mybot-discord
```

---

## Reverse Proxy Setup

### Nginx

#### Installation

```bash
sudo apt install nginx
```

#### Configuration

`/etc/nginx/sites-available/mybot`:

```nginx
# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name mybot.example.com;
    
    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name mybot.example.com;

    # SSL configuration
    ssl_certificate /etc/letsencrypt/live/mybot.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mybot.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Logging
    access_log /var/log/nginx/mybot-access.log;
    error_log /var/log/nginx/mybot-error.log;

    # Proxy to Next.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts for long-running requests
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # API routes (higher timeout for streaming)
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        proxy_connect_timeout 120s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }

    # Static files (cache for 1 year)
    location /_next/static/ {
        proxy_pass http://localhost:3000;
        expires 365d;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/mybot /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Apache

```apache
<VirtualHost *:80>
    ServerName mybot.example.com
    Redirect permanent / https://mybot.example.com/
</VirtualHost>

<VirtualHost *:443>
    ServerName mybot.example.com
    
    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/mybot.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/mybot.example.com/privkey.pem
    
    ProxyPreserveHost On
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    
    # WebSocket support
    RewriteEngine on
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) "ws://localhost:3000/$1" [P,L]
</VirtualHost>
```

### Caddy (Easiest - Auto SSL)

```caddy
mybot.example.com {
    reverse_proxy localhost:3000
    
    header {
        Strict-Transport-Security "max-age=31536000;"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
    }
}
```

---

## SSL/TLS Configuration

### Let's Encrypt (Free SSL)

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d mybot.example.com

# Auto-renewal (already set up)
sudo certbot renew --dry-run

# Check renewal timer
sudo systemctl status certbot.timer
```

### Manual SSL Certificate

```bash
# Generate private key
openssl genrsa -out private.key 2048

# Generate CSR
openssl req -new -key private.key -out certificate.csr

# Get certificate from your provider
# Install in Nginx/Apache config
```

---

## Environment-Specific Notes

### Windows Server

```powershell
# Install Node.js
winget install OpenJS.NodeJS.LTS

# Install MyBot
git clone https://github.com/yourusername/mybot.git
cd mybot
npm install

# Run as Windows Service using NSSM
nssm install MyBotWeb "C:\Program Files\nodejs\node.exe" "C:\mybot\node_modules\.bin\next" "start"
nssm set MyBotWeb AppDirectory "C:\mybot"
nssm start MyBotWeb
```

### Linux (systemd)

See [Systemd Service](#systemd-service) section above.

### macOS

```bash
# Using launchd
cat > ~/Library/LaunchAgents/com.mybot.web.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.mybot.web</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/mybot/node_modules/.bin/next</string>
        <string>start</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/mybot</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.mybot.web.plist
```

---

## Performance Tuning

### Node.js Optimization

```bash
# Increase memory limit
NODE_OPTIONS="--max-old-space-size=4096" npm start

# Enable production mode
NODE_ENV=production npm start
```

### Database Optimization

```sql
-- SQLite optimization
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;  -- 64MB cache
PRAGMA temp_store = MEMORY;
```

Add to database initialization:

```javascript
// src/database/db.ts
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');
```

### PM2 for Process Management

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start npm --name "mybot-web" -- start
pm2 start npm --name "mybot-telegram" -- run bot
pm2 start npm --name "mybot-discord" -- run discord

# Auto-start on boot
pm2 startup
pm2 save

# Monitoring
pm2 monit

# Logs
pm2 logs mybot-web
```

---

## Security Hardening

### 1. Firewall Configuration

```bash
# UFW (Ubuntu/Debian)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Limit SSH attempts
sudo ufw limit ssh
```

### 2. SSH Hardening

```bash
# /etc/ssh/sshd_config
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AllowUsers mybot

sudo systemctl restart sshd
```

### 3. Automatic Security Updates

```bash
# Ubuntu/Debian
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

### 4. Fail2ban

```bash
# Install
sudo apt install fail2ban

# Configure
sudo nano /etc/fail2ban/jail.local
```

```ini
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600

[nginx-limit-req]
enabled = true
port = http,https
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
maxretry = 5
```

### 5. Rate Limiting

Add to `.env`:

```env
# Rate limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000  # 1 minute
```

---

## Monitoring

### System Monitoring

```bash
# Install monitoring tools
sudo apt install htop iotop nethogs

# Monitor in real-time
htop           # CPU/Memory
iotop          # Disk I/O
nethogs        # Network
```

### Application Monitoring

```bash
# PM2 monitoring
pm2 monit

# Custom health checks
curl http://localhost:3000/api/health
```

### Log Management

```bash
# Logrotate configuration
sudo nano /etc/logrotate.d/mybot
```

```
/var/log/mybot/*.log {
    daily
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 mybot mybot
    sharedscripts
    postrotate
        systemctl reload mybot-web > /dev/null
    endscript
}
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check service status
sudo systemctl status mybot-web

# Check logs
sudo journalctl -u mybot-web -n 50

# Check if port is in use
sudo lsof -i :3000

# Check permissions
ls -la /home/mybot/mybot/data
sudo chown -R mybot:mybot /home/mybot/mybot
```

### Database Locked

```bash
# Check for other processes using database
lsof data/mybot.db

# Stop all services
sudo systemctl stop mybot-web mybot-telegram mybot-discord

# Remove lock files
rm -f data/mybot.db-shm data/mybot.db-wal

# Restart services
sudo systemctl start mybot-web mybot-telegram mybot-discord
```

### High Memory Usage

```bash
# Check memory
free -h

# Restart services
sudo systemctl restart mybot-web

# Reduce Node.js memory
NODE_OPTIONS="--max-old-space-size=2048" npm start
```

### Nginx 502 Bad Gateway

```bash
# Check if MyBot is running
curl http://localhost:3000

# Check Nginx error log
sudo tail -f /var/log/nginx/error.log

# Test Nginx config
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### Can't Connect to Bot

```bash
# Check if bot service is running
sudo systemctl status mybot-telegram

# Check Telegram token
echo $TELEGRAM_BOT_TOKEN

# Test bot manually
curl https://api.telegram.org/bot<TOKEN>/getMe

# Check allowed users
echo $TELEGRAM_ALLOWED_USERS
```

---

## Backup & Recovery

### Automated Backups

```bash
#!/bin/bash
# /home/mybot/backup.sh

BACKUP_DIR="/home/mybot/backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
cp /home/mybot/mybot/data/mybot.db $BACKUP_DIR/mybot_$DATE.db

# Backup environment
cp /home/mybot/mybot/.env $BACKUP_DIR/.env_$DATE

# Delete backups older than 30 days
find $BACKUP_DIR -type f -mtime +30 -delete

echo "Backup completed: mybot_$DATE.db"
```

Set up cron:

```bash
crontab -e
# Add: 0 2 * * * /home/mybot/backup.sh
```

### Restore from Backup

```bash
# Stop services
sudo systemctl stop mybot-web mybot-telegram mybot-discord

# Restore database
cp /home/mybot/backups/mybot_20240201_020000.db /home/mybot/mybot/data/mybot.db

# Start services
sudo systemctl start mybot-web mybot-telegram mybot-discord
```

---

## Cost Estimates

| Provider | Configuration | Monthly Cost |
|----------|---------------|--------------|
| **DigitalOcean** | 2 vCPU, 4GB RAM | $24 |
| **AWS EC2** | t3.medium | ~$30 |
| **Hetzner** | CX21 | €5.83 (~$6) |
| **Linode** | 2GB RAM | $12 |
| **Oracle Cloud** | Always Free Tier | $0 |

**Recommended**: Hetzner for best price/performance ratio.

---

## Next Steps

- ✅ [Configure SSL](#ssltls-configuration)
- ✅ [Set up monitoring](#monitoring)
- ✅ [Configure backups](#backup--recovery)
- ✅ [Harden security](#security-hardening)
- ✅ [Read User Guide](USER_GUIDE.md)

---

**Need help?** Join our [Discord community](https://discord.gg/mybot) or [open an issue](https://github.com/yourusername/mybot/issues).
