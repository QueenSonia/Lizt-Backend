import { Injectable } from '@nestjs/common';
import * as winston from 'winston';
import DailyRotateFile = require('winston-daily-rotate-file');
import * as path from 'path';

@Injectable()
export class PaystackLogger {
  private logger: winston.Logger;
  private lastLogDate: string;

  constructor() {
    // Create logs directory path
    const logsDir = path.join(process.cwd(), 'logs');

    // Ensure logs directory exists
    const fs = require('fs');
    if (!fs.existsSync(logsDir)) {
      try {
        fs.mkdirSync(logsDir, { recursive: true });
        console.log(`[PaystackLogger] Created logs directory: ${logsDir}`);
      } catch (err) {
        console.error(`[PaystackLogger] Failed to create logs directory: ${err.message}`);
      }
    }

    console.log('[PaystackLogger] Initializing DailyRotateFile transport...');

    // Configure daily rotate file transport
    const dailyRotateTransport = new DailyRotateFile({
      filename: path.join(logsDir, 'paystack-payments-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '90d',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length
            ? `\n${JSON.stringify(meta, null, 2)}`
            : '';
          return `[${timestamp}] ${level.toUpperCase()}: ${message}${metaStr}`;
        }),
      ),
    });

    // Create Winston logger
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
      ),
      transports: [
        dailyRotateTransport,
        // ALWAYS log to console in production too, to aid debugging since we have issues
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple(),
          ),
        }),
      ],
    });

    // Initialize last log date
    this.lastLogDate = new Date().toISOString().split('T')[0];
    this.logDaySeparator();
    console.log('[PaystackLogger] Initialization complete.');
  }

  /**
   * Log info level message
   */
  info(message: string, meta?: any) {
    this.checkAndLogDaySeparator();
    this.logger.info(message, meta);
  }

  /**
   * Log error level message
   */
  error(message: string, meta?: any) {
    this.checkAndLogDaySeparator();
    this.logger.error(message, meta);
  }

  /**
   * Log debug level message
   */
  debug(message: string, meta?: any) {
    this.checkAndLogDaySeparator();
    this.logger.debug(message, meta);
  }

  /**
   * Log warning level message
   */
  warn(message: string, meta?: any) {
    this.checkAndLogDaySeparator();
    this.logger.warn(message, meta);
  }

  /**
   * Log day separator if date has changed
   */
  private checkAndLogDaySeparator() {
    const currentDate = new Date().toISOString().split('T')[0];
    if (currentDate !== this.lastLogDate) {
      this.lastLogDate = currentDate;
      this.logDaySeparator();
    }
  }

  /**
   * Log date separator
   */
  logDaySeparator() {
    const date = new Date().toISOString().split('T')[0];
    const separator = `========== ${date} ==========`;
    this.logger.info(separator);
  }
}
