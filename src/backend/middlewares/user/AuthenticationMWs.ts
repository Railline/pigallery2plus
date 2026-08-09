import {NextFunction, Request, Response} from 'express';
import {ErrorCodes, ErrorDTO} from '../../../common/entities/Error';
import {UserRoles,} from '../../../common/entities/UserDTO';
import {ObjectManagers} from '../../model/ObjectManagers';
import {Config} from '../../../common/config/private/Config';
import {PasswordHelper} from '../../model/PasswordHelper';
import {Utils} from '../../../common/Utils';
import {QueryParams} from '../../../common/QueryParams';
import * as path from 'path';
import {Logger} from '../../Logger';
import {ContextUser} from '../../model/SessionContext';

const LOG_TAG = 'AuthenticationMWs';

export class AuthenticationMWs {
  private static readonly PRINCIPAL_CACHE_TTL = 30 * 1000;
  private static readonly PRINCIPAL_CACHE_MAX = 4096;
  private static readonly principalCache = new Map<string, {
    expires: number;
    user: ContextUser | null;
  }>();

  public static invalidateUser(userId: number): void {
    const prefix = 'user:' + userId + ':';
    for (const key of AuthenticationMWs.principalCache.keys()) {
      if (key.startsWith(prefix)) {
        AuthenticationMWs.principalCache.delete(key);
      }
    }
  }

  public static invalidateSharing(sharingKey: string): void {
    AuthenticationMWs.principalCache.delete('share:' + sharingKey);
  }

  public static async tryAuthenticate(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (Config.Users.authenticationRequired === false) {
      const user = ObjectManagers.getInstance().UserManager.getUnAuthenticatedUser();
      req.session.context = await ObjectManagers.getInstance().SessionManager.buildContext(user);
      return next();
    }
    if (req.session.context) {
      try {
        const persisted = await AuthenticationMWs.refreshPersistedPrincipal(req);
        if (persisted !== false) {
          return next();
        }
      } catch (err) {
        delete req.session.context;
        Logger.warn(LOG_TAG, 'Could not refresh persisted authentication context:', err);
      }
    }
    try {
      const user = await AuthenticationMWs.getSharingUser(req);
      if (user) {
        req.session.context = await ObjectManagers.getInstance().SessionManager.buildContext(user);
        return next();
      }
      // eslint-disable-next-line no-empty
    } catch (err) {
    }

    return next();
  }

  public static async authenticate(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (Config.Users.authenticationRequired === false) {
      const user = ObjectManagers.getInstance().UserManager.getUnAuthenticatedUser();
      req.session.context = await ObjectManagers.getInstance().SessionManager.buildContext(user);
      return next();
    }

    // Revalidate persisted users and shares periodically. The cookie is signed,
    // but a deleted/demoted principal must not keep stale permissions forever.
    if (typeof req.session.context !== 'undefined') {
      try {
        const persisted = await AuthenticationMWs.refreshPersistedPrincipal(req);
        if (persisted === false) {
          delete req.session.context;
        } else {
          // Projection Brackets are not serializable and disappear between calls.
          if (persisted === null && req.session.context?.user?.projectionKey && (!req.session.context?.projectionQuery || Object.keys(req.session.context?.projectionQuery || {}).length === 0)) {
            req.session.context = await ObjectManagers.getInstance().SessionManager.buildContext(req.session.context.user);
          }
          AuthenticationMWs.extendRememberedSession(req);
          return next();
        }
      } catch (err) {
        delete req.session.context;
        res.status(500);
        return next(new ErrorDTO(ErrorCodes.INTERNAL, 'Could not validate the current session', err));
      }
    }

    let user;
    try {
      user = await AuthenticationMWs.getSharingUser(req);
    } catch (err) {
    }

    // no sharing user yet (eg.: its password protected)
    if (!user) {
      res.status(401);
      return next(
        new ErrorDTO(ErrorCodes.NOT_AUTHENTICATED, 'Not authenticated')
      );
    }


    try {
      req.session.context = await ObjectManagers.getInstance().SessionManager.buildContext(user);
    } catch (err) {
      res.status(500);
      return next(new ErrorDTO(ErrorCodes.INTERNAL, null, err));
    }
    return next();
  }

  private static extendRememberedSession(req: Request): void {
    if (!req.session.rememberMe) {
      return;
    }
    req.sessionOptions.expires = new Date(
      Date.now() + Config.Server.sessionTimeout
    );
    req.session.expires = req.sessionOptions.expires.getTime();
  }

  /**
   * @returns true when refreshed, false when revoked, null for non-persisted contexts.
   */
  private static async refreshPersistedPrincipal(req: Request): Promise<boolean | null> {
    const sessionUser = req.session.context?.user;
    if (!sessionUser) {
      return false;
    }

    let cacheKey: string;
    let loader: () => Promise<{user: ContextUser | null; expires?: number}>;
    if (sessionUser.usedSharingKey) {
      const sharingKey = sessionUser.usedSharingKey;
      cacheKey = 'share:' + sharingKey;
      loader = async () => {
        const sharing = await ObjectManagers.getInstance().SharingManager.findOne(sharingKey);
        if (!sharing || sharing.expires <= Date.now()) {
          return {user: null};
        }
        return {
          expires: sharing.expires,
          user: {
            id: null,
            name: 'Guest',
            role: UserRoles.LimitedGuest,
            usedSharingKey: sharing.sharingKey,
            overrideAllowBlockList: true,
            allowQuery: ObjectManagers.getInstance().SessionManager.buildAllowListForSharing(sharing),
          } as ContextUser,
        };
      };
    } else if (Number.isInteger(sessionUser.id)) {
      // Bind the cache entry to both immutable identity claims stored in the
      // signed cookie. SQL engines may reuse a deleted numeric ID; an old
      // session must never silently become the replacement account.
      cacheKey = 'user:' + sessionUser.id + ':' + sessionUser.name;
      loader = async () => {
        const user = await ObjectManagers.getInstance().UserManager.findOne({id: sessionUser.id});
        return {user: user?.name === sessionUser.name ? user : null};
      };
    } else {
      // Unauthenticated and test contexts are derived from configuration, not DB rows.
      return null;
    }

    const now = Date.now();
    let cached = AuthenticationMWs.principalCache.get(cacheKey);
    if (!cached || cached.expires <= now) {
      const loaded = await loader();
      cached = {
        user: loaded.user,
        expires: Math.min(
          now + AuthenticationMWs.PRINCIPAL_CACHE_TTL,
          loaded.expires ?? Number.MAX_SAFE_INTEGER
        ),
      };
      AuthenticationMWs.principalCache.set(cacheKey, cached);
      AuthenticationMWs.trimPrincipalCache();
    }

    if (!cached.user) {
      return false;
    }
    req.session.context = await ObjectManagers.getInstance().SessionManager.buildContext(cached.user);
    return true;
  }

  private static trimPrincipalCache(): void {
    while (AuthenticationMWs.principalCache.size > AuthenticationMWs.PRINCIPAL_CACHE_MAX) {
      const oldest = AuthenticationMWs.principalCache.keys().next().value as string | undefined;
      if (!oldest) {
        return;
      }
      AuthenticationMWs.principalCache.delete(oldest);
    }
  }

  public static normalizePathParam(
    paramName: string
  ): (req: Request, res: Response, next: NextFunction) => void {
    return function normalizePathParam(
      req: Request,
      res: Response,
      next: NextFunction
    ): void {
      if (!req.params[paramName]) {
        req.params[paramName] = path.sep;
        return next();
      }
      const originalPath = req.params[paramName].replace(/\\/g, '/');
      if (originalPath.split('/').includes('..')) {
        res.status(400);
        return next(new ErrorDTO(ErrorCodes.PATH_ERROR, 'Invalid path'));
      }
      const normalizedPath = path.posix.normalize(originalPath);
      if (
        path.posix.isAbsolute(normalizedPath) ||
        normalizedPath === '..' ||
        normalizedPath.startsWith('../')
      ) {
        res.status(400);
        return next(new ErrorDTO(ErrorCodes.PATH_ERROR, 'Invalid path'));
      }
      req.params[paramName] = normalizedPath === '.' ? path.sep : normalizedPath;
      return next();
    };
  }


  public static authoriseMetaFiles(
    paramName: string
  ): (req: Request, res: Response, next: NextFunction) => Promise<void> {
    return async function authoriseMetaFiles(
      req: Request,
      res: Response,
      next: NextFunction
    ): Promise<void> {
      try {
        const p: string = req.params[paramName];

        if (!await ObjectManagers.getInstance().GalleryManager.authoriseMetaFile(req.session.context, p)) {
          res.sendStatus(403);
          return;
        }

        return next();
      } catch (e) {
        // On error, fail closed to be safe
        Logger.warn(LOG_TAG, 'authoriseMedia error:', e);
        res.sendStatus(403);
        return;
      }
    };
  }

  public static authoriseMedia(
    paramName: string
  ): (req: Request, res: Response, next: NextFunction) => Promise<void> {
    return async function authoriseMedia(
      req: Request,
      res: Response,
      next: NextFunction
    ): Promise<void> {
      try {
        const mediaRelPath: string = req.params[paramName];

        if (!await ObjectManagers.getInstance().GalleryManager.authoriseMedia(req.session.context, mediaRelPath)) {
          res.sendStatus(403);
          return;
        }


        return next();
      } catch (e) {
        // On error, fail closed to be safe
        Logger.warn(LOG_TAG, 'authoriseMedia error:', e);
        res.sendStatus(403);
        return;
      }
    };
  }

  public static authorise(
    role: UserRoles
  ): (req: Request, res: Response, next: NextFunction) => void {
    return function authorise(
      req: Request,
      res: Response,
      next: NextFunction
    ): void {
      if (req.session.context?.user.role < role) {
        res.status(401);
        return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED));
      }
      return next();
    };
  }

  public static async shareLogin(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (Config.Sharing.enabled === false) {
      return next();
    }
    // not enough parameter
    if (
      !req.query[QueryParams.gallery.sharingKey_query] &&
      !req.params[QueryParams.gallery.sharingKey_params]
    ) {
      return next(
        new ErrorDTO(ErrorCodes.INPUT_ERROR, 'no sharing key provided')
      );
    }

    try {
      const password = (req.body ? req.body.password : null) || null;
      const sharingKey: string =
        (req.query[QueryParams.gallery.sharingKey_query] as string) ||
        (req.params[QueryParams.gallery.sharingKey_params] as string);
      const sharing = await ObjectManagers.getInstance().SharingManager.findOne(sharingKey);

      if (
        !sharing ||
        sharing.expires < Date.now() ||
        ((Config.Sharing.passwordRequired === true ||
            sharing.password) &&
          !PasswordHelper.comparePassword(password, sharing.password))
      ) {
        Logger.warn(LOG_TAG, 'Failed sharing login from IP `' + req.ip + '`, invalid key or password');
        res.status(401);
        return next(new ErrorDTO(ErrorCodes.CREDENTIAL_NOT_FOUND));
      }

      const user = {
        name: 'Guest',
        role: UserRoles.LimitedGuest,
        usedSharingKey: sharing.sharingKey,
        overrideAllowBlockList: true,
        allowQuery: ObjectManagers.getInstance().SessionManager.buildAllowListForSharing(sharing)
      } as ContextUser;
      req.session.context = await ObjectManagers.getInstance().SessionManager.buildContext(user);
      return next();
    } catch (err) {
      return next(new ErrorDTO(ErrorCodes.GENERAL_ERROR, null, err));
    }
  }

  public static inverseAuthenticate(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (typeof req.session.context?.user !== 'undefined') {
      return next(new ErrorDTO(ErrorCodes.ALREADY_AUTHENTICATED));
    }
    return next();
  }

  public static async login(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void | Response> {
    if (Config.Users.authenticationRequired === false) {
      return res.sendStatus(404);
    }

    // not enough parameters
    if (
      typeof req.body === 'undefined' ||
      typeof req.body.loginCredential === 'undefined' ||
      typeof req.body.loginCredential.username !== 'string' ||
      typeof req.body.loginCredential.password !== 'string' ||
      req.body.loginCredential.username.length === 0 ||
      req.body.loginCredential.password.length === 0
    ) {
      Logger.warn(LOG_TAG, 'Failed login from IP `' + req.ip + '` no user or password provided');
      return next(
        new ErrorDTO(
          ErrorCodes.INPUT_ERROR,
          'not all parameters are included for loginCredential'
        )
      );
    }
    try {
      // let's find the user
      const user = Utils.clone(
        await ObjectManagers.getInstance().UserManager.findOne({
          name: req.body.loginCredential.username,
          password: req.body.loginCredential.password,
        })
      );
      delete user.password;
      req.session.context = await ObjectManagers.getInstance().SessionManager.buildContext(user);
      req.session.rememberMe = req.body.loginCredential.rememberMe;
      if (req.session.rememberMe) {
        req.sessionOptions.expires = new Date(
          Date.now() + Config.Server.sessionTimeout
        );
        req.session.expires = req.sessionOptions.expires.getTime();
      }
      return next();
    } catch (err) {
      Logger.warn(LOG_TAG, 'Failed login from IP `' + req.ip + '` for user:' + req.body.loginCredential.username
        + ', bad password');
      return next(
        new ErrorDTO(
          ErrorCodes.CREDENTIAL_NOT_FOUND,
          'credentials not found during login',
          err
        )
      );
    }
  }

  public static logout(req: Request, res: Response, next: NextFunction): void {
    delete req.session.context;
    return next();
  }

  private static async getSharingUser(req: Request): Promise<ContextUser> {
    if (
      Config.Sharing.enabled === true &&
      (!!req.query[QueryParams.gallery.sharingKey_query] ||
        !!req.params[QueryParams.gallery.sharingKey_params])
    ) {
      const sharingKey: string =
        (req.query[QueryParams.gallery.sharingKey_query] as string) ||
        (req.params[QueryParams.gallery.sharingKey_params] as string);
      const sharing = await ObjectManagers.getInstance().SharingManager.findOne(sharingKey);
      if (!sharing || sharing.expires < Date.now()) {
        return null;
      }

      // no 'free login' if passwords are required, or it is set
      if (
        Config.Sharing.passwordRequired === true ||
        sharing.password
      ) {
        return null;
      }

      return {
        name: 'Guest',
        role: UserRoles.LimitedGuest,
        usedSharingKey: sharing.sharingKey,
        overrideAllowBlockList: true,
        allowQuery: ObjectManagers.getInstance().SessionManager.buildAllowListForSharing(sharing)
      } as ContextUser;
    }
    return null;
  }
}
