import {NextFunction, Request, Response} from 'express';
import {Config} from '../../common/config/private/Config';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import rateLimit from 'express-rate-limit';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class SecurityMWs {
  private static readonly loginAttempts = new Map<string, RateLimitEntry>();
  private static readonly rateLimitWindowMs = 15 * 60 * 1000;
  private static readonly rateLimitMaxAttempts = 20;
  private static readonly rateLimitMaxEntries = 4096;

  public static readonly apiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 2400,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: Request): boolean => req.method === 'OPTIONS',
    message: 'Too many requests',
    validate: {trustProxy: false},
  });

  public static readonly publicRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 6000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req: Request): boolean => req.method === 'OPTIONS',
    message: 'Too many requests',
    validate: {trustProxy: false},
  });

  public static securityHeaders(req: Request, res: Response, next: NextFunction): void {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');

    if (req.secure || Config.Server.publicUrl.startsWith('https://')) {
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

    if ((req.get('sec-fetch-site') || '').toLowerCase() === 'cross-site') {
      res.status(403);
      return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED, 'Cross-site request rejected'));
    }

    const originHeader = req.get('origin') || req.get('referer');
    if (!originHeader) {
      return next();
    }

    try {
      const origin = new URL(originHeader);
      const allowedOrigins = new Set<string>();
      if (Config.Server.publicUrl) {
        allowedOrigins.add(new URL(Config.Server.publicUrl).origin.toLowerCase());
      } else {
        const host = req.get('host');
        if (host) {
          allowedOrigins.add(new URL(`${req.protocol}://${host}`).origin.toLowerCase());
        }
      }

      if (allowedOrigins.has(origin.origin.toLowerCase())) {
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
    SecurityMWs.pruneLoginAttempts(now);
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

  private static pruneLoginAttempts(now: number): void {
    if (SecurityMWs.loginAttempts.size <= SecurityMWs.rateLimitMaxEntries) {
      return;
    }

    for (const [key, entry] of SecurityMWs.loginAttempts.entries()) {
      if (entry.resetAt <= now) {
        SecurityMWs.loginAttempts.delete(key);
      }
    }

    if (SecurityMWs.loginAttempts.size <= SecurityMWs.rateLimitMaxEntries) {
      return;
    }

    for (const key of SecurityMWs.loginAttempts.keys()) {
      SecurityMWs.loginAttempts.delete(key);
      if (SecurityMWs.loginAttempts.size <= SecurityMWs.rateLimitMaxEntries) {
        break;
      }
    }
  }
}
