import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class KeepAliveService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(KeepAliveService.name);
  private intervalRef: NodeJS.Timeout | null = null;
  private initialTimeoutRef: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {}

  onApplicationBootstrap() {
    const isExplicitlyDisabled =
      this.configService.get<boolean>('app.keepAlive.enabled') === false ||
      process.env.ENABLE_KEEP_ALIVE === 'false';

    if (isExplicitlyDisabled) {
      this.logger.log('Keep-alive service is disabled (ENABLE_KEEP_ALIVE=false).');
      return;
    }

    // Determine target URL:
    // 1. KEEP_ALIVE_URL
    // 2. RENDER_EXTERNAL_URL (Automatically injected by Render in production)
    // 3. APP_URL
    const configuredUrl =
      this.configService.get<string>('app.keepAlive.url') ||
      process.env.KEEP_ALIVE_URL ||
      process.env.RENDER_EXTERNAL_URL ||
      process.env.APP_URL;

    if (!configuredUrl) {
      this.logger.log(
        'No public URL detected. Keep-alive self-ping is idle. Deploy on Render or set KEEP_ALIVE_URL to activate.',
      );
      return;
    }

    // Ignore localhost in local development unless explicitly forced with KEEP_ALIVE_URL
    const isLocalhost =
      configuredUrl.includes('localhost') ||
      configuredUrl.includes('127.0.0.1');

    if (isLocalhost && !process.env.KEEP_ALIVE_URL) {
      this.logger.log(
        'Keep-alive self-ping is inactive on local development (localhost). Set KEEP_ALIVE_URL or deploy to Render to enable.',
      );
      return;
    }

    const pingUrl = this.formatPingUrl(configuredUrl);
    const intervalMinutes =
      this.configService.get<number>('app.keepAlive.intervalMinutes') ||
      parseInt(process.env.KEEP_ALIVE_INTERVAL_MINUTES || '10', 10) ||
      10;

    // Render free tier sleeps after 15 minutes of inactivity. Keep interval safely between 1 and 14 mins.
    const safeIntervalMinutes = Math.min(Math.max(intervalMinutes, 1), 14);
    const intervalMs = safeIntervalMinutes * 60 * 1000;

    this.logger.log(
      `🚀 Render Anti-Sleep KeepAlive active! Pinging ${pingUrl} every ${safeIntervalMinutes}m to keep service awake.`,
    );

    // Initial ping after 30 seconds to allow complete app startup and proxy routing
    this.initialTimeoutRef = setTimeout(() => {
      this.executePing(pingUrl);

      // Periodic ping
      this.intervalRef = setInterval(() => {
        this.executePing(pingUrl);
      }, intervalMs);
    }, 30000);
  }

  onApplicationShutdown() {
    if (this.initialTimeoutRef) {
      clearTimeout(this.initialTimeoutRef);
      this.initialTimeoutRef = null;
    }
    if (this.intervalRef) {
      clearInterval(this.intervalRef);
      this.intervalRef = null;
    }
    this.logger.log('Keep-alive service stopped gracefully.');
  }

  private formatPingUrl(rawUrl: string): string {
    let url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    // Remove trailing slash
    url = url.replace(/\/+$/, '');

    // Check if it already targets /ping or /health
    if (url.endsWith('/ping') || url.endsWith('/health')) {
      return url;
    }

    return `${url}/health`;
  }

  private async executePing(url: string): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const startTime = Date.now();
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Render-KeepAlive-Ping/1.0',
          Accept: 'application/json, text/plain, */*',
        },
        signal: controller.signal,
      });

      const latency = Date.now() - startTime;

      if (response.ok) {
        this.logger.log(
          `💓 Anti-sleep ping successful -> ${url} [Status: ${response.status}] (${latency}ms)`,
        );
      } else {
        this.logger.warn(
          `⚠️ Anti-sleep ping returned non-200 -> ${url} [Status: ${response.status}]`,
        );
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        this.logger.warn(`⏱️ Anti-sleep ping timed out after 15s for: ${url}`);
      } else {
        this.logger.warn(
          `⚠️ Anti-sleep ping failed for: ${url} - Error: ${error?.message || error}`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
