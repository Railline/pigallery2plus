import {NextFunction, Request, Response} from 'express';
import {Config} from '../../common/config/private/Config';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class SecurityMWs {
  private static readonly loginAttempts = new Map<string, RateLimitEntry>();
  private static readonly rateLimitWindowMs = 15 * 60 * 1000;
  private static readonly rateLimitMaxAttempts = 20;

  public static securityHeaders(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    const forwardedProto = (req.headers['x-forwarded-proto'] || '').toString().split(',')[0].trim();
    if (req.secure || forwardedProto === 'https' || Config.Server.publicUrl.startsWith('https://')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return next();
  }

  public static crossOriginRandomResource(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    return next();
  }

  public static csrfOriginCheck(req: Request, res: Response, next: NextFunction): void {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    const originHeader = req.get('origin') || req.get('referer');
    if (!originHeader) {
      return next();
    }

    try {
      const origin = new URL(originHeader);
      const allowedHosts = new Set<string>();
      if (req.headers.host) {
        allowedHosts.add(req.headers.host.toString().toLowerCase());
      }
      if (req.headers['x-forwarded-host']) {
        allowedHosts.add(req.headers['x-forwarded-host'].toString().split(',')[0].trim().toLowerCase());
      }
      if (Config.Server.publicUrl) {
        allowedHosts.add(new URL(Config.Server.publicUrl).host.toLowerCase());
      }

      if (allowedHosts.has(origin.host.toLowerCase())) {
        return next();
      }
    } catch (e) {
      // Invalid Origin/Referer should fail closed.
    }

    res.status(403);
    return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED, 'Invalid request origin'));
  }

  public static loginRateLimit(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = req.ip + ':' + req.path;
    const current = SecurityMWs.loginAttempts.get(key);

    if (!current || current.resetAt <= now) {
      SecurityMWs.loginAttempts.set(key, {count: 1, resetAt: now + SecurityMWs.rateLimitWindowMs});
      return next();
    }

    current.count++;
    if (current.count > SecurityMWs.rateLimitMaxAttempts) {
      res.status(429);
      return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED, 'Too many login attempts'));
    }
    return next();
  }
}
