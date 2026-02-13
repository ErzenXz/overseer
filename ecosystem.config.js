/**
 * PM2 Ecosystem Configuration for Overseer
 * 
 * This configuration defines all Overseer processes for production deployment.
 * 
 * Features:
 * - Cluster mode for web server (multi-core support)
 * - Auto-restart on failure
 * - Log management with rotation
 * - Environment-specific configs
 * - Memory limits
 * - Graceful shutdown
 * 
 * Usage:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 stop ecosystem.config.js
 *   pm2 restart ecosystem.config.js
 *   pm2 logs
 *   pm2 monit
 */

module.exports = {
  apps: [
    // ======================
    // Web Server (Next.js)
    // ======================
    {
      name: 'overseer-web',
      script: 'npm',
      args: 'run start',
      instances: 'max', // Use all CPU cores
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      restart_delay: 4000,
      
      // Logs
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      
      // Advanced
      kill_timeout: 5000,
      listen_timeout: 10000,
      wait_ready: true,
      
      // Monitoring
      instance_var: 'INSTANCE_ID',
      
      // Auto-restart on file changes (development only)
      watch: false,
    },

    // ======================
    // Telegram Bot
    // ======================
    {
      name: 'overseer-telegram',
      script: 'npx',
      args: 'tsx src/bot/index.ts',
      instances: 1, // Single instance (bot requires one process)
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '300M',
      restart_delay: 4000,
      
      // Logs
      error_file: './logs/telegram-error.log',
      out_file: './logs/telegram-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Advanced
      kill_timeout: 5000,
      
      // Auto-restart on crashes
      autorestart: true,
      // If the bot exits cleanly (e.g., not configured / disabled), don't keep restarting it.
      stop_exit_codes: [0],
      
      // Watch (development only)
      watch: false,
      
      // Only start if TELEGRAM_BOT_TOKEN is configured
      // Note: PM2 doesn't support conditional start, handle this in startup script
    },

    // ======================
    // Discord Bot
    // ======================
    {
      name: 'overseer-discord',
      script: 'npx',
      args: 'tsx src/bot/discord.ts',
      instances: 1, // Single instance
      exec_mode: 'fork',
      // Optional interface: only start when explicitly enabled/configured.
      autostart: false,
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '300M',
      restart_delay: 4000,
      
      // Logs
      error_file: './logs/discord-error.log',
      out_file: './logs/discord-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Advanced
      kill_timeout: 5000,
      autorestart: true,
      watch: false,
      // If the bot exits cleanly (e.g., not configured / disabled), don't keep restarting it.
      stop_exit_codes: [0],
    },

    // ======================
    // Slack Bot (Optional)
    // ======================
    {
      name: 'overseer-slack',
      script: 'npx',
      args: 'tsx src/bot/slack.ts',
      instances: 1,
      exec_mode: 'fork',
      autostart: false,
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '300M',
      restart_delay: 4000,
      error_file: './logs/slack-error.log',
      out_file: './logs/slack-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      autorestart: true,
      watch: false,
      stop_exit_codes: [0],
    },

    // ======================
    // WhatsApp Bot (Optional)
    // ======================
    {
      name: 'overseer-whatsapp',
      script: 'npx',
      args: 'tsx src/bot/whatsapp.ts',
      instances: 1,
      exec_mode: 'fork',
      autostart: false,
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '400M',
      restart_delay: 4000,
      error_file: './logs/whatsapp-error.log',
      out_file: './logs/whatsapp-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      autorestart: true,
      watch: false,
      stop_exit_codes: [0],
    },

    // ======================
    // Matrix Bot (Optional)
    // ======================
    {
      name: 'overseer-matrix',
      script: 'npx',
      args: 'tsx src/bot/matrix.ts',
      instances: 1,
      exec_mode: 'fork',
      autostart: false,
      env: {
        NODE_ENV: 'production',
      },
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '400M',
      restart_delay: 4000,
      error_file: './logs/matrix-error.log',
      out_file: './logs/matrix-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000,
      autorestart: true,
      watch: false,
      stop_exit_codes: [0],
    },

    // ======================
    // Agent Runner (Optional)
    // ======================
    {
      name: 'overseer-agent',
      script: 'npx',
      args: 'tsx src/agent/runner.ts',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      env_production: {
        NODE_ENV: 'production',
      },
      env_development: {
        NODE_ENV: 'development',
      },
      // Restart policy
      max_restarts: 10,
      min_uptime: '10s',
      max_memory_restart: '500M',
      restart_delay: 4000,
      
      // Logs
      error_file: './logs/agent-error.log',
      out_file: './logs/agent-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Advanced
      kill_timeout: 10000, // Agent needs more time for graceful shutdown
      autorestart: true,
      watch: false,
      
      // Start only if explicitly needed
      // Can be disabled in production if running agent within web/bots
      // autorestart: false,
    },
  ],

  // ======================
  // Deployment Configuration
  // ======================
  deploy: {
    production: {
      user: 'deploy',
      host: ['your-server.com'],
      ref: 'origin/main',
      repo: 'git@github.com:ErzenXz/overseer.git',
      path: '/opt/overseer',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env production',
      'pre-setup': '',
      'ssh_options': 'StrictHostKeyChecking=no',
    },
    
    staging: {
      user: 'deploy',
      host: ['staging-server.com'],
      ref: 'origin/develop',
      repo: 'git@github.com:ErzenXz/overseer.git',
      path: '/opt/overseer-staging',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js --env staging',
      env: {
        NODE_ENV: 'staging',
      },
    },
  },
};
