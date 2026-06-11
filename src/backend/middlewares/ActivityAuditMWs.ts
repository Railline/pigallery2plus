import {NextFunction, Request, Response} from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {ProjectPath} from '../ProjectPath';
import {Config} from '../../common/config/private/Config';

const MAX_LOG_SIZE = 50 * 1024 * 1024;
const REDACTED_QUERY_KEYS = new Set([
  'sk',
  'sharingKey',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'code',
]);

export class ActivityAuditMWs {
  private static logPath: string = null;
  private static rotating = false;

  public static audit(req: Request, res: Response, next: NextFunction): void {
    const start = Date.now();
    const shouldAudit = ActivityAuditMWs.shouldAudit(req);
    if (!shouldAudit) {
      return next();
    }

    res.on('finish', () => {
      ActivityAuditMWs.write({
        time: new Date().toISOString(),
        action: ActivityAuditMWs.actionFor(req),
        method: req.method,
        url: ActivityAuditMWs.redactUrl(req.originalUrl || req.url),
        status: res.statusCode,
        durationMs: Date.now() - start,
        user: ActivityAuditMWs.userFor(req),
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
        referer: ActivityAuditMWs.redactUrl(req.get('referer') || ''),
        loginUser: ActivityAuditMWs.loginUserFor(req),
      });
    });

    return next();
  }

  private static shouldAudit(req: Request): boolean {
    const url = req.originalUrl || req.url || '';
    if (url.startsWith('/assets/') ||
      url.startsWith('/node_modules/') ||
      url.startsWith('/favicon') ||
      url.includes('/thumbnail/') ||
      url.includes('/icon/')) {
      return false;
    }

    if (url.startsWith(Config.Server.apiPath)) {
      return true;
    }

    return /^\/(?:gallery|login|share|admin|search|albums|faces|random)(?:\/|$|\?)/.test(url);
  }

  private static actionFor(req: Request): string {
    const url = req.originalUrl || req.url || '';
    if (url.includes('/user/login') || url.includes('/share/login')) {
      return 'login';
    }
    if (url.includes('/user/logout')) {
      return 'logout';
    }
    if (url.includes('/gallery/random/')) {
      return 'random-image';
    }
    if (url.includes('/share') || url.includes('/sharing')) {
      return 'share';
    }
    if (url.includes('/gallery/content')) {
      return 'gallery-list';
    }
    if (url.includes('/gallery/search')) {
      return 'search';
    }
    if (url.includes('/gallery')) {
      return 'gallery';
    }
    return 'request';
  }

  private static userFor(req: Request): { name: string, role: unknown } {
    const sessionUser = (req.session as any)?.context?.user;
    if (sessionUser?.name) {
      return {
        name: sessionUser.name,
        role: sessionUser.role,
      };
    }
    return {
      name: 'guest',
      role: 'guest',
    };
  }

  private static loginUserFor(req: Request): string | undefined {
    const username = (req.body as any)?.loginCredential?.username;
    return typeof username === 'string' ? username.slice(0, 160) : undefined;
  }

  private static redactUrl(value: string): string {
    if (!value) {
      return '';
    }

    try {
      const parsed = new URL(value, 'http://audit.local');
      for (const key of REDACTED_QUERY_KEYS) {
        if (parsed.searchParams.has(key)) {
          parsed.searchParams.set(key, '[redacted]');
        }
      }
      const url = parsed.pathname + parsed.search + parsed.hash;
      return url.slice(0, 4096);
    } catch {
      return value.replace(/([?&](?:sk|sharingKey|password|token|access_token|refresh_token|code)=)[^&\s]+/gi, '$1[redacted]').slice(0, 4096);
    }
  }

  private static write(entry: Record<string, unknown>): void {
    const logPath = ActivityAuditMWs.getLogPath();
    ActivityAuditMWs.rotateIfNeeded(logPath);
    fs.appendFile(logPath, JSON.stringify(entry) + '\n', () => undefined);
  }

  private static getLogPath(): string {
    if (!ActivityAuditMWs.logPath) {
      fs.mkdirSync(ProjectPath.DBFolder, {recursive: true});
      ActivityAuditMWs.logPath = path.join(ProjectPath.DBFolder, 'activity-audit.log');
    }
    return ActivityAuditMWs.logPath;
  }

  private static rotateIfNeeded(logPath: string): void {
    if (ActivityAuditMWs.rotating) {
      return;
    }
    ActivityAuditMWs.rotating = true;
    fs.stat(logPath, (err, stat) => {
      if (!err && stat.size >= MAX_LOG_SIZE) {
        fs.rename(logPath, logPath + '.1', () => {
          ActivityAuditMWs.rotating = false;
        });
        return;
      }
      ActivityAuditMWs.rotating = false;
    });
  }
}
