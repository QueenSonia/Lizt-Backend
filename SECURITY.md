# Security Features

This document outlines the security measures implemented to protect against automated attacks and malicious requests.

## 🛡️ Security Layers

### 1. Security Middleware

- **Path Blocking**: Automatically blocks requests to suspicious paths (PHPUnit, WordPress, etc.)
- **File Extension Filtering**: Blocks requests for dangerous file types (.php, .asp, etc.)
- **Query Parameter Validation**: Prevents code injection attempts
- **Auto-Ban Integration**: Records suspicious activity for automatic IP banning

### 2. IP Rate Limiting

- **Per-IP Limits**: 100 requests per minute per IP
- **Automatic Blocking**: IPs exceeding limits are blocked for 5 minutes
- **Bypass Protection**: Uses multiple IP detection methods (Cloudflare, X-Forwarded-For, etc.)

### 3. Auto-Ban System

- **Suspicious Activity Tracking**: Monitors and counts suspicious requests per IP
- **Automatic Banning**: Bans IPs after 10 suspicious requests within 5 minutes
- **Ban Duration**: Default 1-hour bans for repeat offenders
- **Manual Override**: Ability to manually ban/unban IPs

### 4. Enhanced Security Headers

- **Helmet.js**: Comprehensive security headers
- **Content Security Policy**: Prevents XSS attacks
- **HSTS**: Forces HTTPS connections
- **CORS**: Controlled cross-origin requests

## 🚨 Attack Patterns Blocked

The system automatically blocks these common attack patterns:

### Suspicious Paths

- `/vendor/phpunit/*` - PHPUnit RCE attempts
- `/wp-content/*` - WordPress exploitation
- `/wp-admin/*` - WordPress admin access
- `/laravel/*` - Laravel framework attacks
- `/.env` - Environment file access
- `/.git/*` - Git repository access
- `/phpmyadmin/*` - Database admin tools

### Dangerous File Extensions

- `.php`, `.asp`, `.jsp` - Server-side scripts
- `.sh`, `.bat`, `.cmd` - System scripts
- `.py`, `.rb`, `.pl` - Scripting languages

### Malicious Query Parameters

- `eval`, `exec`, `system` - Code execution attempts

## 📊 Monitoring & Management

### Security Monitor Script

```bash
# Generate security report
npm run security-monitor report

# Manually block an IP
npm run security-monitor block 192.168.1.100
```

### Log Analysis

Security events are logged with the following format:

```
🚫 Blocked suspicious request: /vendor/phpunit/eval-stdin.php from IP: 1.2.3.4 (POST)
```

### Cache Keys Used

- `ip_rate_limit:{ip}` - Rate limiting counters
- `ip_blocked:{ip}` - Blocked IP addresses
- `ip_banned:{ip}` - Auto-banned IP addresses
- `suspicious_activity:{ip}` - Suspicious activity counters

## ⚙️ Configuration

### Rate Limiting (IpRateLimitGuard)

```typescript
maxRequests = 100; // Max requests per window
windowSeconds = 60; // 1 minute window
blockDurationSeconds = 300; // 5 minutes block
```

### Auto-Ban (AutoBanService)

```typescript
SUSPICIOUS_REQUESTS_THRESHOLD = 10; // 10 suspicious requests
TIME_WINDOW_SECONDS = 300; // within 5 minutes
BAN_DURATION_SECONDS = 3600; // ban for 1 hour
```

## 🔧 Customization

### Adding New Blocked Paths

Edit `SecurityMiddleware.blockedPaths`:

```typescript
private readonly blockedPaths = [
  '/your-custom-path',
  // ... existing paths
];
```

### Adjusting Thresholds

Modify the constants in the respective service classes to adjust sensitivity.

### Whitelisting IPs

To whitelist specific IPs, modify the middleware to check against a whitelist before applying security rules.

## 🚀 Deployment Recommendations

1. **Use a WAF**: Consider Cloudflare or AWS WAF for additional protection
2. **Monitor Logs**: Set up log aggregation and alerting
3. **Regular Updates**: Keep security rules updated based on new attack patterns
4. **Backup Strategy**: Ensure security configurations are backed up
5. **Testing**: Test security rules in staging before production deployment

## 📈 Performance Impact

- **Minimal Overhead**: Security checks add ~1-2ms per request
- **Cache Dependency**: Requires Redis/cache service for IP tracking
- **Memory Usage**: Negligible additional memory usage
- **CPU Impact**: Low CPU overhead for pattern matching

## 🆘 Emergency Procedures

### If Legitimate Traffic is Blocked

1. Check the logs for the blocked IP/pattern
2. Use the unban command: `npm run security-monitor unban <ip>`
3. Adjust security rules if needed
4. Monitor for false positives

### If Under Heavy Attack

1. Lower the rate limiting thresholds temporarily
2. Enable additional logging
3. Consider enabling fail2ban at the server level
4. Contact your hosting provider if needed

## 📝 Maintenance

- **Weekly**: Review security logs for new attack patterns
- **Monthly**: Update blocked paths based on threat intelligence
- **Quarterly**: Review and adjust rate limiting thresholds
- **As Needed**: Update security rules based on application changes
