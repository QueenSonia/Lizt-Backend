import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) { }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /** Intentional error to verify Sentry is capturing. Remove after testing. */
  @Get('debug-sentry')
  debugSentry(): void {
    throw new Error('My first Sentry error!');
  }
}
