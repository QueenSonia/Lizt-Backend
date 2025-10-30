import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PerformanceMonitor {
  private readonly logger = new Logger(PerformanceMonitor.name);

  /**
   * Decorator to monitor method execution time
   */
  static MonitorPerformance(threshold: number = 1000) {
    return function (
      target: any,
      propertyName: string,
      descriptor: PropertyDescriptor,
    ) {
      const method = descriptor.value;

      descriptor.value = async function (...args: any[]) {
        const start = Date.now();
        const result = await method.apply(this, args);
        const duration = Date.now() - start;

        if (duration > threshold) {
          Logger.warn(
            `Slow query detected: ${target.constructor.name}.${propertyName} took ${duration}ms (threshold: ${threshold}ms)`,
            'PerformanceMonitor',
          );
        } else {
          Logger.debug(
            `${target.constructor.name}.${propertyName} completed in ${duration}ms`,
            'PerformanceMonitor',
          );
        }

        return result;
      };
    };
  }

  /**
   * Manual performance tracking
   */
  static async track<T>(
    operation: string,
    fn: () => Promise<T>,
    threshold: number = 1000,
  ): Promise<T> {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;

    if (duration > threshold) {
      Logger.warn(
        `Slow operation: ${operation} took ${duration}ms (threshold: ${threshold}ms)`,
        'PerformanceMonitor',
      );
    } else {
      Logger.debug(
        `${operation} completed in ${duration}ms`,
        'PerformanceMonitor',
      );
    }

    return result;
  }
}
