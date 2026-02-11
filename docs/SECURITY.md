# 🔒 Security Documentation

Comprehensive security guide for Overseer - threat model, best practices, and compliance considerations.

## Table of Contents

- [Security Overview](#security-overview)
- [Threat Model](#threat-model)
- [Security Architecture](#security-architecture)
- [Authentication & Authorization](#authentication--authorization)
- [Data Encryption](#data-encryption)
- [API Security](#api-security)
- [Bot Security](#bot-security)
- [Command Execution Safety](#command-execution-safety)
- [Network Security](#network-security)
- [Audit Logging](#audit-logging)
- [Security Best Practices](#security-best-practices)
- [Incident Response](#incident-response)
- [Compliance](#compliance)
- [Security Checklist](#security-checklist)

---

## Security Overview

Overseer is designed with **security-first principles** for self-hosted deployment. Key security features:

- 🔐 **AES-256-GCM encryption** for sensitive data
- 👤 **Session-based authentication** with bcrypt password hashing
- ✅ **User whitelisting** for bot access control
- ⚠️ **Dangerous command detection** and confirmation
- 📝 **Complete audit logging** of all actions
- 🛡️ **Input validation** on all endpoints
- 🔒 **Secure defaults** out of the box

---

## Threat Model

### Assets

| Asset | Sensitivity | Protection |
|-------|-------------|------------|
| **Admin Credentials** | Critical | Bcrypt hashed, session cookies |
| **LLM API Keys** | Critical | AES-256-GCM encrypted at rest |
| **Bot Tokens** | Critical | AES-256-GCM encrypted at rest |
| **Conversation Data** | High | Database file, access controlled |
| **Server Access** | Critical | Tool execution, confirmation required |
| **Source Code** | Medium | Git repository, review process |

### Threat Actors

1. **External Attackers**
   - Goal: Unauthorized access, data theft
   - Vector: Web admin, API endpoints
   - Mitigation: Authentication, TLS, rate limiting

2. **Malicious Bot Users**
   - Goal: Execute unauthorized commands
   - Vector: Telegram/Discord bot
   - Mitigation: User whitelisting, command confirmation

3. **Compromised Dependencies**
   - Goal: Code execution, backdoor
   - Vector: npm packages
   - Mitigation: Dependency audits, pinned versions

4. **Insider Threats**
   - Goal: Data access, system compromise
   - Vector: Admin access
   - Mitigation: Audit logging, principle of least privilege

### Attack Scenarios

#### **Scenario 1: Brute Force Web Admin**

```
Attack: Automated password guessing
Impact: Unauthorized admin access
Likelihood: Medium
Severity: Critical

Mitigations:
- Rate limiting (planned)
- Strong password requirements
- Session timeout
- Fail2ban integration
- IP whitelisting
```

#### **Scenario 2: API Key Extraction**

```
Attack: Database file access
Impact: LLM API key theft
Likelihood: Low (requires server access)
Severity: High

Mitigations:
- AES-256-GCM encryption
- File permissions (600)
- Separate encryption key
- Key rotation
```

#### **Scenario 3: Malicious Command Injection**

```
Attack: Crafted bot message with shell injection
Impact: Arbitrary command execution
Likelihood: Low
Severity: Critical

Mitigations:
- Input sanitization
- Command whitelisting
- Dangerous command detection
- User confirmation required
- Non-privileged user execution
```

#### **Scenario 4: Man-in-the-Middle**

```
Attack: Intercept bot/API traffic
Impact: Credential theft, data leakage
Likelihood: Medium (if no TLS)
Severity: High

Mitigations:
- HTTPS/TLS for web admin
- Telegram/Discord use TLS
- Certificate pinning (planned)
```

---

## Security Architecture

### Defense in Depth

```
┌─────────────────────────────────────────┐
│         Layer 1: Network               │
│  - Firewall (UFW)                       │
│  - TLS/SSL (Let's Encrypt)              │
│  - Rate Limiting                        │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│         Layer 2: Application           │
│  - Session Authentication               │
│  - Input Validation (Zod)               │
│  - CSRF Protection                      │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│         Layer 3: Authorization         │
│  - User Whitelisting                    │
│  - Role-Based Access                    │
│  - Command Confirmation                 │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│         Layer 4: Data                  │
│  - Encryption at Rest (AES-256)         │
│  - Secure Key Storage                   │
│  - Database Access Control              │
└────────────┬────────────────────────────┘
             │
┌────────────▼────────────────────────────┐
│         Layer 5: Audit                 │
│  - Action Logging                       │
│  - Security Event Monitoring            │
│  - Intrusion Detection                  │
└─────────────────────────────────────────┘
```

---

## Authentication & Authorization

### Web Admin Authentication

```typescript
// Password Hashing (bcrypt, cost factor 10)
const hashedPassword = await bcrypt.hash(password, 10);

// Session Creation
const session = {
  userId: user.id,
  username: user.username,
  expiresAt: Date.now() + SESSION_TIMEOUT,
};

// Cookie Settings
setCookie('overseer-session', encryptSession(session), {
  httpOnly: true,      // Prevents JavaScript access
  secure: true,        // HTTPS only
  sameSite: 'strict',  // CSRF protection
  maxAge: SESSION_TIMEOUT,
});
```

**Security Properties:**
- ✅ Passwords never stored in plain text
- ✅ Sessions expire after inactivity
- ✅ Secure cookie flags prevent XSS/CSRF
- ✅ Session tokens are encrypted

### Bot Authorization

```typescript
// Telegram User Whitelist
const ALLOWED_USERS = process.env.TELEGRAM_ALLOWED_USERS?.split(',') || [];

function isAuthorized(userId: string): boolean {
  return ALLOWED_USERS.includes(userId);
}

// Check on every message
if (!isAuthorized(ctx.from.id.toString())) {
  return ctx.reply('Unauthorized. Contact admin.');
}
```

**Security Properties:**
- ✅ Only whitelisted users can interact
- ✅ User IDs validated on every request
- ✅ Unauthorized attempts logged

### API Authentication (Planned)

```typescript
// API Key Format: overseer_<32-byte-random>_<timestamp>
const apiKey = generateApiKey();

// Key Storage: Hashed with SHA-256
const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
db.insert('api_keys', { key_hash: keyHash, user_id: userId });

// Request Validation
const providedKey = req.headers['authorization']?.replace('Bearer ', '');
const providedHash = crypto.createHash('sha256').update(providedKey).digest('hex');

if (!db.findOne('api_keys', { key_hash: providedHash })) {
  return res.status(401).json({ error: 'Invalid API key' });
}
```

---

## Data Encryption

### Encryption at Rest

**Algorithm**: AES-256-GCM (Authenticated Encryption)

```typescript
import crypto from 'crypto';

export function encrypt(plaintext: string, key: string): string {
  const iv = crypto.randomBytes(16);  // 128-bit IV
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:ciphertext
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

export function decrypt(ciphertext: string, key: string): string {
  const parts = ciphertext.split(':');
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}
```

**Encrypted Fields:**
- ✅ LLM API keys (`providers.api_key_encrypted`)
- ✅ Bot tokens (`interfaces.config`)
- ✅ OAuth credentials
- ✅ MCP server credentials
- ✅ Skill API keys

**Key Management:**

```bash
# Generate encryption key (64-character hex = 256 bits)
openssl rand -hex 32

# Store in environment (never commit!)
ENCRYPTION_KEY=your-64-character-hex-key
```

**Best Practices:**
- 🔑 **Different key per deployment** (dev, staging, prod)
- 🔄 **Rotate keys** annually or after suspected compromise
- 💾 **Backup keys** securely (encrypted backup)
- 🚫 **Never commit keys** to version control

### Encryption in Transit

**Web Admin:**
```nginx
# TLS 1.2+ only
ssl_protocols TLSv1.2 TLSv1.3;

# Strong cipher suites
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...';
ssl_prefer_server_ciphers on;

# HSTS
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

**Telegram/Discord:**
- ✅ All API calls use HTTPS
- ✅ Telegram uses MTProto encryption
- ✅ Discord uses TLS 1.2+

---

## API Security

### Input Validation

All API endpoints use **Zod** schemas:

```typescript
import { z } from 'zod';

const ChatRequestSchema = z.object({
  message: z.string()
    .min(1, 'Message cannot be empty')
    .max(10000, 'Message too long'),
  conversationId: z.string().uuid().optional(),
  interface: z.enum(['telegram', 'discord', 'web', 'api']),
});

// Validate request
const validated = ChatRequestSchema.parse(req.body);
```

**Validation Rules:**
- ✅ Type checking (string, number, boolean)
- ✅ Length limits
- ✅ Format validation (UUID, email, URL)
- ✅ Enum constraints
- ✅ Required vs optional fields

### Output Sanitization

```typescript
import DOMPurify from 'dompurify';

// Sanitize HTML before rendering
const sanitized = DOMPurify.sanitize(userContent);

// Escape special characters
const escaped = escapeHtml(userInput);
```

### Rate Limiting (Planned)

```typescript
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,                   // 100 requests per window
  message: 'Too many requests',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', rateLimiter);
```

### CSRF Protection

```typescript
// Same-Site cookies
setCookie('overseer-session', session, {
  sameSite: 'strict',
});

// CSRF token (planned)
const csrfToken = generateCsrfToken();
res.setHeader('X-CSRF-Token', csrfToken);
```

---

## Bot Security

### Telegram Bot Security

```typescript
// 1. User Whitelist
const ALLOWED_USERS = process.env.TELEGRAM_ALLOWED_USERS?.split(',') || [];

// 2. Validate Every Message
bot.use(async (ctx, next) => {
  if (!ALLOWED_USERS.includes(ctx.from.id.toString())) {
    logger.warn('Unauthorized Telegram access attempt', {
      userId: ctx.from.id,
      username: ctx.from.username,
    });
    return ctx.reply('❌ Unauthorized');
  }
  
  return next();
});

// 3. Sanitize Input
const sanitizedMessage = sanitizeInput(ctx.message.text);

// 4. Log All Interactions
logger.info('Telegram message received', {
  userId: ctx.from.id,
  messageLength: ctx.message.text.length,
});
```

### Discord Bot Security

```typescript
// 1. Guild Whitelist
const ALLOWED_GUILDS = process.env.DISCORD_ALLOWED_GUILDS?.split(',') || [];

// 2. Role-Based Access
function hasPermission(interaction: CommandInteraction): boolean {
  if (!ALLOWED_GUILDS.includes(interaction.guildId)) {
    return false;
  }
  
  // Require specific role (optional)
  const member = interaction.member as GuildMember;
  return member.roles.cache.has(REQUIRED_ROLE_ID);
}

// 3. Slash Command Validation
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;
  
  if (!hasPermission(interaction)) {
    return interaction.reply({
      content: '❌ Unauthorized',
      ephemeral: true,
    });
  }
  
  // Process command
});
```

---

## Command Execution Safety

### Dangerous Command Detection

```typescript
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//, // rm -rf /
  /dd\s+if=/, // dd if=
  /mkfs/, // filesystem creation
  /:\(\)\{ :\|:& \};:/, // fork bomb
  /shutdown/, // system shutdown
  /reboot/, // system reboot
  /halt/, // system halt
  /init\s+0/, // shutdown
  /kill\s+-9\s+1/, // kill init
  /chmod\s+777/, // dangerous permissions
  /chown\s+.*root/, // ownership changes
  />\s*\/dev\/sda/, // disk overwrite
];

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}
```

### Confirmation Flow

```typescript
async function executeCommand(command: string, user: User): Promise<string> {
  // Check if dangerous
  if (isDangerousCommand(command)) {
    logger.warn('Dangerous command requested', { command, user: user.id });
    
    // Ask for confirmation
    const confirmed = await askConfirmation(user, {
      message: `⚠️ This command is potentially dangerous:\n\`${command}\`\n\nAre you sure?`,
      options: ['Yes', 'No'],
      timeout: 30000,
    });
    
    if (!confirmed) {
      return 'Command cancelled by user';
    }
    
    logger.info('Dangerous command confirmed', { command, user: user.id });
  }
  
  // Execute with timeout
  const result = await executeWithTimeout(command, {
    timeout: 30000,
    killSignal: 'SIGKILL',
  });
  
  // Log execution
  logger.info('Command executed', {
    command,
    user: user.id,
    exitCode: result.exitCode,
  });
  
  return result.stdout;
}
```

### Sandboxing (Future Enhancement)

```typescript
// Run commands in Docker container
async function executeInSandbox(command: string): Promise<string> {
  const containerId = await docker.createContainer({
    Image: 'alpine:latest',
    Cmd: ['sh', '-c', command],
    NetworkDisabled: true,
    HostConfig: {
      Memory: 512 * 1024 * 1024, // 512MB limit
      CpuQuota: 50000, // 50% CPU
      ReadonlyRootfs: true,
    },
  });
  
  // ...
}
```

---

## Network Security

### Firewall Configuration

```bash
# UFW (Ubuntu)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable

# Limit SSH attempts
sudo ufw limit ssh
```

### Nginx Security Headers

```nginx
# Security headers
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';" always;

# Hide Nginx version
server_tokens off;
```

---

## Audit Logging

### Logged Events

```typescript
// Security Events
logger.warn('Failed login attempt', { username, ip });
logger.error('Unauthorized API access', { apiKey: 'xxx...', ip });
logger.warn('Dangerous command requested', { command, user });
logger.info('User whitelist updated', { addedUsers, removedUsers });

// Operational Events
logger.info('Agent message processed', { conversationId, toolsUsed });
logger.info('Provider added', { provider, model });
logger.info('Skill installed', { skillId, source });

// Error Events
logger.error('Tool execution failed', { tool, error });
logger.error('Database error', { operation, error });
logger.error('Provider API error', { provider, error });
```

### Log Format

```json
{
  "timestamp": "2024-02-01T10:30:45.123Z",
  "level": "warn",
  "module": "auth",
  "message": "Failed login attempt",
  "context": {
    "username": "admin",
    "ip": "192.168.1.100",
    "userAgent": "Mozilla/5.0..."
  }
}
```

### Log Retention

```bash
# Logrotate configuration
/var/log/overseer/*.log {
    daily
    rotate 90          # Keep 90 days
    compress
    delaycompress
    notifempty
    create 0640 overseer overseer
    sharedscripts
}
```

---

## Security Best Practices

### Deployment

- [x] **Use HTTPS** for web admin (Let's Encrypt)
- [x] **Strong passwords** (min 12 chars, mixed case, numbers, symbols)
- [x] **Firewall enabled** (UFW, only required ports)
- [x] **Regular updates** (system + Overseer)
- [x] **Non-root user** (run as dedicated user)
- [x] **File permissions** (600 for database, 700 for data directory)
- [ ] **Rate limiting** (planned)
- [ ] **IP whitelisting** (optional)
- [ ] **2FA** (planned)

### Configuration

- [x] **Rotate encryption key** annually
- [x] **Rotate API keys** when compromised
- [x] **Whitelist bot users** (don't allow public access)
- [x] **Review SOUL.md** (don't allow unauthorized actions)
- [x] **Limit command execution** (use confirmation for dangerous ops)
- [x] **Backup database** regularly
- [ ] **Use secrets management** (Vault, AWS Secrets Manager)

### Monitoring

- [x] **Review logs** weekly
- [x] **Monitor failed logins**
- [x] **Track unusual command patterns**
- [x] **Set up alerts** for security events
- [ ] **Intrusion detection** (OSSEC, Fail2ban)
- [ ] **Log aggregation** (ELK stack, Graylog)

---

## Incident Response

### Security Incident Checklist

**If you suspect a security breach:**

1. **Contain**
   - [ ] Stop all Overseer services
   - [ ] Block suspicious IPs
   - [ ] Revoke compromised credentials

2. **Investigate**
   - [ ] Review audit logs
   - [ ] Check file modifications
   - [ ] Analyze network traffic
   - [ ] Identify entry point

3. **Remediate**
   - [ ] Patch vulnerabilities
   - [ ] Rotate all secrets
   - [ ] Restore from clean backup
   - [ ] Update firewall rules

4. **Recover**
   - [ ] Test in isolated environment
   - [ ] Gradually restore services
   - [ ] Monitor for anomalies
   - [ ] Document incident

5. **Learn**
   - [ ] Conduct post-mortem
   - [ ] Update security procedures
   - [ ] Improve monitoring
   - [ ] Train team

### Reporting Vulnerabilities

**Found a security issue?**

1. **DO NOT** open a public GitHub issue
2. **Email**: security@overseer.io (or your contact)
3. **Include**: 
   - Description of vulnerability
   - Steps to reproduce
   - Impact assessment
   - Suggested fix (if any)
4. **Wait** for response before disclosure
5. **Responsible disclosure**: 90 days

**We will:**
- Acknowledge within 48 hours
- Provide initial assessment within 7 days
- Work on a fix and release timeline
- Credit you (if desired) in release notes

---

## Compliance

### GDPR Considerations

Overseer processes user data. If you have EU users:

**Data Minimization:**
- Only collect necessary data (user ID, messages)
- Anonymize where possible
- Delete old conversations

**User Rights:**
- Right to access: Provide conversation export
- Right to deletion: Delete user's data on request
- Right to portability: Export in JSON format

**Security Measures:**
- Encryption at rest and in transit
- Access controls
- Audit logging
- Breach notification plan

### SOC 2 Type II (If applicable)

**Security:**
- Multi-factor authentication (planned)
- Encryption of sensitive data
- Regular security assessments
- Incident response plan

**Availability:**
- Uptime monitoring
- Backup and recovery procedures
- Disaster recovery plan

**Confidentiality:**
- Non-disclosure agreements
- Data classification
- Access restrictions

---

## Security Checklist

### Initial Setup

- [ ] Generate strong encryption key
- [ ] Set strong admin password
- [ ] Configure HTTPS/TLS
- [ ] Enable firewall
- [ ] Set up Fail2ban
- [ ] Configure bot user whitelists
- [ ] Review SOUL.md permissions
- [ ] Set up audit logging

### Regular Maintenance

- [ ] **Weekly**: Review audit logs
- [ ] **Monthly**: Update dependencies (`npm audit`)
- [ ] **Monthly**: Review user access
- [ ] **Quarterly**: Rotate API keys
- [ ] **Annually**: Rotate encryption key
- [ ] **Annually**: Security audit

### Before Production

- [ ] Penetration testing
- [ ] Code review
- [ ] Dependency audit
- [ ] Backup/restore test
- [ ] Incident response plan
- [ ] Documentation review

---

## Resources

- 📖 [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- 🔒 [CIS Benchmarks](https://www.cisecurity.org/cis-benchmarks/)
- 🛡️ [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework)
- 🔐 [Let's Encrypt](https://letsencrypt.org/)
- 📝 [Security Headers](https://securityheaders.com/)

---

**Questions?** Contact security@overseer.io or open a [private security advisory](https://github.com/ErzenXz/overseer/security/advisories/new).
