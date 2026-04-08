#!/usr/bin/env ts-node

/**
 * Security monitoring script
 * Run this to check for suspicious activity and manage IP blocks
 */

import { createConnection } from 'typeorm';
import { config } from 'dotenv-flow';

config({ default_node_env: 'production' });

interface SecurityEvent {
  timestamp: Date;
  ip: string;
  path: string;
  userAgent: string;
  blocked: boolean;
}

class SecurityMonitor {
  private suspiciousIPs = new Map<string, number>();

  // Add an IP to the block list (you can implement this with your cache service)
  async blockIP(ip: string, duration: number = 3600): Promise<void> {
    console.log(`🚫 Blocking IP ${ip} for ${duration} seconds`);
    // Implementation would use your cache service
    // await cacheService.setWithTtlSeconds(`ip_blocked:${ip}`, 'blocked', duration);
  }

  // Analyze log patterns for suspicious activity
  analyzeSecurityEvents(events: SecurityEvent[]): void {
    const ipCounts = new Map<string, number>();
    const pathCounts = new Map<string, number>();

    events.forEach((event) => {
      // Count requests per IP
      ipCounts.set(event.ip, (ipCounts.get(event.ip) || 0) + 1);

      // Count suspicious paths
      if (this.isSuspiciousPath(event.path)) {
        pathCounts.set(event.path, (pathCounts.get(event.path) || 0) + 1);
      }
    });

    // Report top offending IPs
    console.log('\n📊 Top requesting IPs:');
    Array.from(ipCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .forEach(([ip, count]) => {
        console.log(`  ${ip}: ${count} requests`);
        if (count > 100) {
          console.log(`    ⚠️  Consider blocking this IP`);
        }
      });

    // Report suspicious paths
    console.log('\n🎯 Most targeted suspicious paths:');
    Array.from(pathCounts.entries())
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .forEach(([path, count]) => {
        console.log(`  ${path}: ${count} attempts`);
      });
  }

  private isSuspiciousPath(path: string): boolean {
    const suspiciousPaths = [
      '/vendor/phpunit',
      '/phpunit',
      '/wp-content',
      '/wp-admin',
      'eval-stdin.php',
      '.php',
      '.asp',
      '.jsp',
    ];

    return suspiciousPaths.some((suspicious) =>
      path.toLowerCase().includes(suspicious),
    );
  }

  // Generate security report
  generateReport(): void {
    console.log('🛡️  Security Monitor Report');
    console.log('==========================');
    console.log(`Generated at: ${new Date().toISOString()}`);
    console.log('\nRecommendations:');
    console.log('1. Monitor the logs for patterns');
    console.log('2. Consider implementing fail2ban or similar');
    console.log('3. Use a WAF (Web Application Firewall) if possible');
    console.log('4. Keep security middleware updated');
  }
}

// CLI interface
async function main() {
  const monitor = new SecurityMonitor();

  const command = process.argv[2];

  switch (command) {
    case 'block':
      const ip = process.argv[3];
      if (!ip) {
        console.error('Usage: npm run security-monitor block <ip>');
        process.exit(1);
      }
      await monitor.blockIP(ip);
      break;

    case 'report':
      monitor.generateReport();
      break;

    default:
      console.log('Security Monitor Commands:');
      console.log('  block <ip>  - Block an IP address');
      console.log('  report      - Generate security report');
      console.log('');
      console.log('Example: npm run security-monitor block 192.168.1.100');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { SecurityMonitor };
