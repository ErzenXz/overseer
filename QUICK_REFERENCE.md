# 🚀 Overseer Deployment - Quick Reference Card

## One-Line Installation
```bash
curl -fsSL https://raw.githubusercontent.com/ErzenXz/Overseer/main/scripts/install.sh | bash
```

## Essential Commands

### Setup & Configuration
```bash
node scripts/setup.js              # Interactive setup wizard
npm run db:init                    # Initialize database
npm run build                      # Build for production
```

### Docker
```bash
docker-compose up -d               # Start all services
docker-compose logs -f             # View logs
docker-compose down                # Stop services
docker-compose restart overseer-web   # Restart specific service
```

### Systemd
```bash
sudo systemctl start overseer.service              # Start web server
sudo systemctl status overseer.service             # Check status
sudo journalctl -u overseer.service -f             # View logs
sudo systemctl restart overseer-telegram.service   # Restart Telegram bot
```

### PM2
```bash
pm2 start ecosystem.config.js --env production  # Start all
pm2 monit                                       # Monitor
pm2 logs                                        # View logs
pm2 restart all                                 # Restart all
pm2 save                                        # Save process list
```

### Backup & Restore
```bash
./scripts/backup.sh                        # Create backup
./scripts/backup.sh /custom/path           # Custom location
./scripts/backup.sh restore backup.tar.gz  # Restore from backup
```

### Health Monitoring
```bash
./scripts/health-check.sh                  # Basic check
./scripts/health-check.sh --verbose        # Detailed output
./scripts/health-check.sh --alert          # With alerts
```

### Nginx
```bash
sudo nginx -t                              # Test config
sudo systemctl reload nginx                # Reload
sudo certbot --nginx -d yourdomain.com     # Setup SSL
sudo certbot renew --dry-run               # Test renewal
```

### Logs
```bash
tail -f logs/*.log                         # Application logs
sudo tail -f /var/log/nginx/overseer*.log     # Nginx logs
pm2 logs overseer-web                         # PM2 logs
```

### Troubleshooting
```bash
curl http://localhost:3000/api/health      # Check health endpoint
sudo lsof -i :3000                         # Check port usage
ps aux | grep node                         # Find Node processes
free -h                                    # Check memory
df -h                                      # Check disk space
```

## Automated Tasks (Cron)

Add to crontab (`crontab -e`):

```bash
# Daily backups at 2 AM
0 2 * * * /opt/overseer/scripts/backup.sh >> /opt/overseer/logs/backup.log 2>&1

# Health checks every 5 minutes
*/5 * * * * /opt/overseer/scripts/health-check.sh --alert >> /opt/overseer/logs/health-cron.log 2>&1
```

## Important Files

```
.env                       # Environment configuration
ecosystem.config.js        # PM2 process config
nginx/overseer.conf          # Nginx configuration
systemd/*.service         # Systemd service files
scripts/setup.js          # Setup wizard
scripts/backup.sh         # Backup script
scripts/health-check.sh   # Health monitoring
```

## Common Issues

**Service won't start:**
```bash
sudo systemctl status overseer.service
sudo journalctl -u overseer.service -n 50
```

**Database locked:**
```bash
sudo systemctl stop overseer.service overseer-telegram.service overseer-discord.service
rm -f data/overseer.db-wal data/overseer.db-shm
sudo systemctl start overseer.service
```

**Can't access web UI:**
```bash
curl http://localhost:3000/api/health
sudo ufw status
sudo systemctl status nginx
```

## Documentation

- **Full Deployment Guide:** `docs/DEPLOYMENT.md`
- **Scripts Documentation:** `scripts/README.md`
- **Completion Summary:** `DEPLOYMENT_COMPLETE.md`
- **Main README:** `README.md`

## Access Points

- **Web UI:** `https://yourdomain.com` or `http://server-ip:3000`
- **API Health:** `https://yourdomain.com/api/health`
- **Telegram Bot:** Search for bot on Telegram
- **Discord Bot:** Invite to your server

---

**Need help?** Check the documentation or open an issue on GitHub!
