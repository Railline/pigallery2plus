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

export interface ActivityAuditQuery {
  limit: number;
  user?: string;
  action?: string;
  ip?: string;
  status?: number;
  text?: string;
  from?: number;
  to?: number;
}

export class ActivityAuditMWs {
  private static logPath: string = null;
  private static rotating = false;

  public static async readRecent(query: ActivityAuditQuery): Promise<Record<string, unknown>[]> {
    const logPath = ActivityAuditMWs.getLogPath();
    return new Promise((resolve, reject) => {
      fs.readFile(logPath, 'utf8', (err, content) => {
        if (err) {
          if (err.code === 'ENOENT') {
            return resolve([]);
          }
          return reject(err);
        }

        const entries = content
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return {
                time: null,
                action: 'parse-error',
                method: '',
                url: line.slice(0, 4096),
                status: 0,
                durationMs: 0,
                user: {name: 'unknown', role: 'unknown'},
              };
            }
          })
          .filter((entry) => ActivityAuditMWs.matchesQuery(entry, query))
          .slice(-query.limit)
          .reverse();
        resolve(entries);
      });
    });
  }

  private static matchesQuery(entry: Record<string, unknown>, query: ActivityAuditQuery): boolean {
    const userName = String((entry.user as { name?: unknown } | undefined)?.name || '').toLowerCase();
    const loginUser = String(entry.loginUser || '').toLowerCase();
    const action = String(entry.action || '').toLowerCase();
    const ip = String(entry.ip || '').toLowerCase();
    const url = String(entry.url || '').toLowerCase();
    const referer = String(entry.referer || '').toLowerCase();
    const status = Number(entry.status);
    const entryTime = Date.parse(String(entry.time || ''));

    if (query.user && !userName.includes(query.user) && !loginUser.includes(query.user)) {
      return false;
    }
    if (query.action && action !== query.action) {
      return false;
    }
    if (query.ip && !ip.includes(query.ip)) {
      return false;
    }
    if (typeof query.status === 'number' && status !== query.status) {
      return false;
    }
    if (query.text && !url.includes(query.text) && !referer.includes(query.text)) {
      return false;
    }
    if (query.from && (!entryTime || entryTime < query.from)) {
      return false;
    }
    if (query.to && (!entryTime || entryTime > query.to)) {
      return false;
    }
    return true;
  }

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
    if (url.includes('/gallery/random/') || url.includes('/gallery/random-link/')) {
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
