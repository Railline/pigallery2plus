import {NextFunction, Request, Response} from 'express';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import {Message} from '../../common/entities/Message';
import {PrivateConfigClass} from '../../common/config/private/PrivateConfigClass';
import {UserDTO, UserRoles} from '../../common/entities/UserDTO';
import {NotificationManager} from '../model/NotifocationManager';
import {Logger} from '../Logger';
import {ResponseSharingDTO} from '../../common/entities/SharingDTO';
import {Utils} from '../../common/Utils';
import {LoggerRouter} from '../routes/LoggerRouter';
import {TAGS} from '../../common/config/public/ClientConfig';
import {ExtensionConfigWrapper} from '../model/extension/ExtensionConfigWrapper';
import {SharingEntity} from '../model/database/enitites/SharingEntity';
import {Config} from '../../common/config/private/Config';
import * as path from 'path';
import {promises as fsp} from 'fs';
import {ProjectPath} from '../ProjectPath';
import {
  ConcurrencyLimitAbortedError,
  ConcurrencyLimiter,
  ConcurrencyLimitQueueFullError
} from '../model/fileaccess/ConcurrencyLimiter';

const forcedDebug = process.env['NODE_ENV'] === 'debug';

export class RenderingMWs {
  private static readonly originalMediaLimiter = new ConcurrencyLimiter(
    (): number => Config.Media.maxConcurrentOriginalMediaStreams
  );

  public static renderResult(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (typeof req.resultPipe === 'undefined') {
      return next();
    }

    return RenderingMWs.renderMessage(res, req.resultPipe);
  }

  public static renderSessionUser(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.session.context?.user) {
      return next(new ErrorDTO(ErrorCodes.GENERAL_ERROR, 'User not exists'));
    }

    const user = {
      id: req.session.context.user.id,
      name: req.session.context.user.name,
      role: req.session.context.user.role,
      usedSharingKey: req.session.context.user.usedSharingKey,
      projectionKey: req.session.context.user.projectionKey,
    } as UserDTO;


    RenderingMWs.renderMessage(res, user);
  }

  public static renderSharing(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.resultPipe) {
      return next();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {password, creator, ...sharing} = req.resultPipe as SharingEntity;
    (sharing as ResponseSharingDTO).passwordProtected = Config.Sharing.passwordRequired || !!password;
    RenderingMWs.renderMessage(res, sharing);
  }

  public static renderSharingList(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.resultPipe) {
      return next();
    }

    const shares = Utils.clone(req.resultPipe as SharingEntity[]);
    const rs = shares.map((s): ResponseSharingDTO => {
      let ret = s as unknown as ResponseSharingDTO;
      ret.passwordProtected = Config.Sharing.passwordRequired || !!s.password;
      delete s.password;
      delete s.creator.password;
      return ret;
    });
    return RenderingMWs.renderMessage(res, rs);
  }

  public static async renderFile(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (!req.resultPipe) {
      return next();
    }
    const filePath = req.resultPipe as string;
    let release: (() => void) | null = null;
    const releaseOnce = (): void => {
      if (!release) {
        return;
      }
      const currentRelease = release;
      release = null;
      res.removeListener('finish', releaseOnce);
      res.removeListener('close', releaseOnce);
      currentRelease();
    };
    if (RenderingMWs.isOriginalMedia(filePath)) {
      const abortController = new AbortController();
      const abortWhileQueued = (): void => abortController.abort();
      res.once('close', abortWhileQueued);
      try {
        release = await RenderingMWs.originalMediaLimiter.acquire(abortController.signal);
      } catch (error) {
        if (error instanceof ConcurrencyLimitAbortedError) {
          return;
        }
        if (error instanceof ConcurrencyLimitQueueFullError) {
          res.setHeader('Retry-After', '2');
          res.sendStatus(503);
          return;
        }
        return next(error);
      } finally {
        res.removeListener('close', abortWhileQueued);
      }
      if (abortController.signal.aborted || res.destroyed) {
        releaseOnce();
        return;
      }
      res.once('finish', releaseOnce);
      res.once('close', releaseOnce);

      // Validate source media only after acquiring a slot. A burst of hundreds
      // of thumbnail/original requests must not enqueue hundreds of NAS stats
      // ahead of local application files in libuv's shared worker pool.
      try {
        if ((await fsp.stat(filePath)).isDirectory()) {
          releaseOnce();
          return next();
        }
      } catch (error) {
        releaseOnce();
        return next(new ErrorDTO(
          ErrorCodes.PATH_ERROR,
          'no such file:' + (req.params['mediaPath'] || path.basename(filePath)),
          'can\'t find file: ' + filePath
        ));
      }
    }

    const fileName = path.basename(filePath);
    if (!res.hasHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    }
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Disposition', RenderingMWs.contentDispositionInline(fileName));

    try {
      res.sendFile(path.basename(filePath), {
        root: path.dirname(filePath),
        maxAge: 365 * 24 * 60 * 60 * 1000,
        immutable: true,
        dotfiles: 'allow',
        acceptRanges: true,
        lastModified: true,
      });
    } catch (error) {
      releaseOnce();
      return next(error);
    }
  }

  private static isOriginalMedia(filePath: string): boolean {
    const relative = path.relative(ProjectPath.ImageFolder, filePath);
    return relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative);
  }

  private static contentDispositionInline(fileName: string): string {
    const fallback = fileName
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(fileName)
      .replace(/[!'()*]/g, (c: string): string =>
        `%${c.charCodeAt(0).toString(16).toUpperCase()}`
      );
    return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
  }

  public static renderOK(
    req: Request,
    res: Response
  ): void {
    const message = new Message<string>(null, 'ok');
    res.json(message);
  }

  public static async renderConfig(
    req: Request,
    res: Response
  ): Promise<void> {
    const originalConf = await ExtensionConfigWrapper.original();
    // These are sensitive information, do not send to the client side
    originalConf.Server.sessionSecret = null;
    const originalConfJSON = JSON.parse(JSON.stringify(originalConf.toJSON({
      attachState: true,
      attachVolatile: true,
      skipTags: {secret: true} as TAGS
    }) as PrivateConfigClass));

    const message = new Message<PrivateConfigClass>(
      null,
      originalConfJSON
    );
    res.json(message);
  }

  public static renderError(
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (err instanceof ErrorDTO) {
      if (err.details) {
        const logFn = Logger.logLevelForError(err.code)
        LoggerRouter.log(logFn, req, res);
        // use separate rendering for detailsStr
        const d = err.detailsStr;
        delete err.detailsStr;
        logFn(err);
        err.detailsStr = d;
        delete err.details; // do not send back error object to the client side

        // hide error details for non developers
        if (
          !(
            forcedDebug ||
            (req.session &&
              req.session.context?.user &&
              req.session.context?.user.role >= UserRoles.Developer)
          )
        ) {
          delete err.detailsStr;
        }
      }
      const message = new Message<null>(err, null);
      res.json(message);
      return;
    }
    NotificationManager.error('Unknown server error', err, req);
    return next(err);
  }

  protected static renderMessage<T>(res: Response, content: T): void {
    const message = new Message<T>(null, content);
    res.json(message);
  }
}
