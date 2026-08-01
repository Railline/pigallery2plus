import {NextFunction, Request, Response} from 'express';
import {CreateSharingDTO, SharingDTOKey, UpdateSharingDTO} from '../../common/entities/SharingDTO';
import {ObjectManagers} from '../model/ObjectManagers';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import {Config} from '../../common/config/private/Config';
import {QueryParams} from '../../common/QueryParams';
import * as path from 'path';
import {UserRoles} from '../../common/entities/UserDTO';
import {SearchQueryDTO, SearchQueryTypes, TextSearch, TextSearchQueryMatchTypes} from '../../common/entities/SearchQueryDTO';
import * as crypto from 'crypto';
import {SharingEntity} from '../model/database/enitites/SharingEntity';
import {UserEntity} from '../model/database/enitites/UserEntity';
import {AuthenticationMWs} from './user/AuthenticationMWs';
import {PasswordHelper} from '../model/PasswordHelper';

export class SharingMWs {
  private static readonly MAX_VALIDITY_MS = 100 * 366 * 24 * 60 * 60 * 1000;

  private static expiresFromValidity(valid: unknown): number {
    if (valid === -1) {
      return new Date(9999, 0, 1).getTime();
    }
    if (
      typeof valid !== 'number' ||
      !Number.isSafeInteger(valid) ||
      valid <= 0 ||
      valid > SharingMWs.MAX_VALIDITY_MS
    ) {
      throw new Error('Validity must be -1 or a positive duration of at most 100 years');
    }
    return Date.now() + valid;
  }

  private static validatePassword(password: unknown): void {
    if (typeof password === 'undefined' || password === null || password === '') {
      return;
    }
    if (
      typeof password !== 'string' ||
      Buffer.byteLength(password, 'utf8') > PasswordHelper.MAX_BCRYPT_PASSWORD_BYTES
    ) {
      throw new Error(`Password must not exceed ${PasswordHelper.MAX_BCRYPT_PASSWORD_BYTES} UTF-8 bytes`);
    }
  }
  public static async getSharing(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (Config.Sharing.enabled === false) {
        return next();
      }
      const sharingKey = req.params[QueryParams.gallery.sharingKey_params];

      req.resultPipe =
        await ObjectManagers.getInstance().SharingManager.findOne(sharingKey);
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error during retrieving sharing link',
          err
        )
      );
    }
  }

  public static async getSharingKey(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (Config.Sharing.enabled === false) {
        return next();
      }
      const sharingKey = req.params[QueryParams.gallery.sharingKey_params];

      req.resultPipe =
        {sharingKey: (await ObjectManagers.getInstance().SharingManager.findOne(sharingKey)).sharingKey} as SharingDTOKey;
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error during retrieving sharing key',
          err
        )
      );
    }
  }

  public static async createSharing(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (Config.Sharing.enabled === false) {
        return next();
      }
      if (
        typeof req.body === 'undefined' ||
        typeof req.body.createSharing === 'undefined'
      ) {
        return next(
          new ErrorDTO(ErrorCodes.INPUT_ERROR, 'createSharing filed is missing')
        );
      }
      const createSharing: CreateSharingDTO = req.body.createSharing;

      try {
        SharingMWs.validatePassword(createSharing.password);
        SharingMWs.expiresFromValidity(createSharing.valid);
      } catch (e) {
        return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, (e as Error).message));
      }

      if (Config.Sharing.passwordRequired && !createSharing.password) {

        return next(
          new ErrorDTO(ErrorCodes.INPUT_ERROR, 'Password is required.')
        );
      }

      let sharingKey = SharingMWs.generateKey(Config.Sharing.sharingKeyLength);

      // create one not yet used
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          await ObjectManagers.getInstance().SharingManager.findOne(sharingKey);
          sharingKey = this.generateKey(Config.Sharing.sharingKeyLength);
        } catch (err) {
          break;
        }
      }

      const directoryName = path.normalize(req.params['directory'] || '/');

      // Prefer provided searchQuery; otherwise fallback to strict directory exact-match query for compatibility
      const searchQuery = createSharing.searchQuery || ({
        type: SearchQueryTypes.directory,
        value: directoryName,
        matchType: TextSearchQueryMatchTypes.exact_match,
        negate: false
      } as TextSearch);

      const sharing: SharingEntity = {
        id: null,
        sharingKey,
        searchQuery,
        password: createSharing.password,
        defaultSearchView: null,
        defaultDirectoryView: null,
        creator: req.session.context?.user as UserEntity, // only the user id is used
        expires: SharingMWs.expiresFromValidity(createSharing.valid),
        timeStamp: Date.now(),
      };

      if (createSharing.defaultDirectoryView) {
        sharing.defaultDirectoryView = createSharing.defaultDirectoryView;
      }
      if (createSharing.defaultSearchView) {
        sharing.defaultSearchView = createSharing.defaultSearchView;
      }

      req.resultPipe =
        await ObjectManagers.getInstance().SharingManager.createSharing(
          sharing
        );
      return next();
    } catch (err) {
      console.warn(err);
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error during creating sharing link',
          err
        )
      );
    }
  }

  public static async updateSharing(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (Config.Sharing.enabled === false) {
        return next();
      }
      if (
        typeof req.body === 'undefined' ||
        typeof req.body.updateSharing === 'undefined'
      ) {
        return next(
          new ErrorDTO(ErrorCodes.INPUT_ERROR, 'updateSharing filed is missing')
        );
      }
      const updateSharing: CreateSharingDTO = req.body.updateSharing;
      try {
        SharingMWs.validatePassword(updateSharing.password);
        SharingMWs.expiresFromValidity(updateSharing.valid);
      } catch (e) {
        return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, (e as Error).message));
      }
      if (!Number.isSafeInteger(updateSharing.id) || updateSharing.id <= 0) {
        return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, 'Invalid sharing id'));
      }
      const directoryName = path.normalize(req.params['directory'] || '/');

      const searchQuery = updateSharing.searchQuery || ({
        type: SearchQueryTypes.directory,
        value: directoryName,
        matchType: TextSearchQueryMatchTypes.exact_match,
        negate: false
      } as TextSearch);

      const sharing: UpdateSharingDTO = {
        id: updateSharing.id,
        searchQuery,
        sharingKey: '',
        creator: req.session.context?.user,
        expires: SharingMWs.expiresFromValidity(updateSharing.valid),
        timeStamp: Date.now(),
      };

      if (Object.prototype.hasOwnProperty.call(updateSharing, 'password')) {
        sharing.password =
          updateSharing.password && updateSharing.password !== ''
            ? updateSharing.password
            : null;
      }

      if (Object.prototype.hasOwnProperty.call(updateSharing, 'defaultDirectoryView')) {
        sharing.defaultDirectoryView = updateSharing.defaultDirectoryView || null;
      }
      if (Object.prototype.hasOwnProperty.call(updateSharing, 'defaultSearchView')) {
        sharing.defaultSearchView = updateSharing.defaultSearchView || null;
      }


      const forceUpdate = req.session.context.user.role >= UserRoles.Admin;
      const updated = await ObjectManagers.getInstance().SharingManager.updateSharing(
        sharing,
        forceUpdate
      );
      req.resultPipe = updated;
      AuthenticationMWs.invalidateSharing(updated.sharingKey);
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error during updating sharing link',
          err
        )
      );
    }
  }

  public static async deleteSharing(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (Config.Sharing.enabled === false) {
        return next();
      }
      if (
        typeof req.params === 'undefined' ||
        typeof req.params['sharingKey'] === 'undefined'
      ) {
        return next(
          new ErrorDTO(ErrorCodes.INPUT_ERROR, 'sharingKey is missing')
        );
      }
      const sharingKey: string = req.params['sharingKey'];

      // Check if user has the right to delete sharing.
      if (req.session.context?.user.role < UserRoles.Admin) {
        const s = await ObjectManagers.getInstance().SharingManager.findOne(sharingKey);
        if (s.creator.id !== req.session.context?.user.id) {
          res.status(401);
          return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED, 'Can\'t delete sharing.'));
        }
      }
      req.resultPipe =
        await ObjectManagers.getInstance().SharingManager.deleteSharing(
          sharingKey
        );
      AuthenticationMWs.invalidateSharing(sharingKey);
      req.resultPipe = 'ok';
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error during deleting sharing',
          err
        )
      );
    }
  }

  public static async listSharing(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (Config.Sharing.enabled === false) {
        return next();
      }
      req.resultPipe =
        await ObjectManagers.getInstance().SharingManager.listAll();
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error during listing shares',
          err
        )
      );
    }
  }

  public static async listOwnSharing(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (Config.Sharing.enabled === false) {
        return next();
      }
      req.resultPipe =
        await ObjectManagers.getInstance().SharingManager.listOwn(req.session.context?.user);
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error during listing own shares',
          err
        )
      );
    }
  }

  public static async listSharingForQuery(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (Config.Sharing.enabled === false) {
        return next();
      }
      if (!req.resultPipe) {
        return next();
      }
      const query: SearchQueryDTO = req.resultPipe as any;
      if (req.session.context?.user.role >= UserRoles.Admin) {
        req.resultPipe =
          await ObjectManagers.getInstance().SharingManager.listAllForQuery(query);
      } else {
        req.resultPipe =
          await ObjectManagers.getInstance().SharingManager.listAllForQuery(query, req.session.context?.user);
      }
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error during listing shares',
          err
        )
      );
    }
  }

  private static generateKey(length: number): string {
    return crypto.randomBytes(Math.ceil(length * 3 / 4))
      .toString('base64url')
      .slice(0, length);
  }
}
