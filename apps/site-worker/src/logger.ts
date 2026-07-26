export type SiteWorkerLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SiteWorkerLogContext {
  workerId: string;
  jobPublicReference?: string;
  jobType?: string;
  tenantPublicReference?: string;
  sitePublicReference?: string;
  attemptNumber?: number;
  failureCode?: string;
  durationMs?: number;
  event?: string;
}

export interface SiteWorkerLogger {
  debug(message: string, context: SiteWorkerLogContext): void;
  info(message: string, context: SiteWorkerLogContext): void;
  warn(message: string, context: SiteWorkerLogContext): void;
  error(message: string, context: SiteWorkerLogContext): void;
}

const levels: Readonly<Record<SiteWorkerLogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class JsonSiteWorkerLogger implements SiteWorkerLogger {
  constructor(private readonly minimumLevel: SiteWorkerLogLevel) {}

  debug(message: string, context: SiteWorkerLogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context: SiteWorkerLogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context: SiteWorkerLogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context: SiteWorkerLogContext): void {
    this.write('error', message, context);
  }

  private write(
    level: SiteWorkerLogLevel,
    message: string,
    context: SiteWorkerLogContext,
  ): void {
    if (levels[level] < levels[this.minimumLevel]) return;
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message: message.slice(0, 500),
      ...context,
    });
    if (level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

export class SilentSiteWorkerLogger implements SiteWorkerLogger {
  debug(): void {}
  info(): void {}
  warn(): void {}
  error(): void {}
}
