import {AuthenticationMWs} from '../middlewares/user/AuthenticationMWs';
import * as path from 'path';
import {Express} from 'express';
import {GalleryMWs} from '../middlewares/GalleryMWs';
import {RenderingMWs} from '../middlewares/RenderingMWs';
import {ThumbnailGeneratorMWs} from '../middlewares/thumbnail/ThumbnailGeneratorMWs';
import {UserRoles} from '../../common/entities/UserDTO';
import {ThumbnailSourceType} from '../model/fileaccess/PhotoWorker';
import {VersionMWs} from '../middlewares/VersionMWs';
import {SupportedFormats} from '../../common/SupportedFormats';
import {ServerTimingMWs} from '../middlewares/ServerTimingMWs';
import {MetaFileMWs} from '../middlewares/MetaFileMWs';
import {Config} from '../../common/config/private/Config';
import {SecurityMWs} from '../middlewares/SecurityMWs';
import {QueryParams} from '../../common/QueryParams';
import {MailMediaLink} from '../model/messenger/MailMediaLink';
import {PhotoProcessing} from '../model/fileaccess/fileprocessing/PhotoProcessing';

export class GalleryRouter {
  public static route(app: Express): void {
    this.addGetSignedMailThumbnail(app);
    this.addGetImageIcon(app);
    this.addGetVideoIcon(app);
    this.addGetResizedPhoto(app);
    this.addGetBestFitVideo(app);
    this.addGetVideoThumbnail(app);
    this.addGetImage(app);
    this.addGetVideo(app);
    this.addGetMetaFile(app);
    this.addGetBestFitMetaFile(app);
    this.addRandom(app);
    this.addDirectoryList(app);
    this.addDirectoryZip(app);

    this.addSearch(app);
    this.addAutoComplete(app);
  }

  protected static addGetSignedMailThumbnail(app: Express): void {
    app.get(
      Config.Server.apiPath + '/gallery/mail-thumbnail/:size/:expires/:signature/:mediaPath(*)',
      async (req, res, next): Promise<void> => {
        const mediaPath = req.params['mediaPath'];
        const size = parseInt(req.params['size'], 10) || Config.Media.Photo.thumbnailSizes[0];
        const safeSize = Config.Media.Photo.thumbnailSizes.indexOf(size) === -1 ?
          Config.Media.Photo.thumbnailSizes[0] :
          size;
        const expires = parseInt(req.params['expires'], 10);
        const signature = req.params['signature'];
        if (!mediaPath || !MailMediaLink.verify(mediaPath, safeSize, expires, signature)) {
          res.sendStatus(403);
          return;
        }

        const absolutePath = MailMediaLink.safeAbsoluteMediaPath(mediaPath);
        if (!absolutePath) {
          res.sendStatus(404);
          return;
        }

        const lowerExt = path.extname(absolutePath).toLowerCase().replace('.', '');
        const sourceType = SupportedFormats.Photos.indexOf(lowerExt) !== -1 ?
            ThumbnailSourceType.Photo :
          (SupportedFormats.Videos.indexOf(lowerExt) !== -1 ? ThumbnailSourceType.Video : null);
        if (sourceType === null) {
          res.sendStatus(404);
          return;
        }

        try {
          req.resultPipe = await PhotoProcessing.generateThumbnail(
            absolutePath,
            safeSize,
            sourceType,
            false
          );
          res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
          res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
          return RenderingMWs.renderFile(req, res, next);
        } catch (e) {
          return next(e);
        }
      }
    );
  }

  protected static addDirectoryList(app: Express): void {
    app.get(
      [Config.Server.apiPath + '/gallery/content/:directory(*)', Config.Server.apiPath + '/gallery/', Config.Server.apiPath + '/gallery//'],
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.authorise(UserRoles.LimitedGuest),
      AuthenticationMWs.normalizePathParam('directory'),
      VersionMWs.injectGalleryVersion,

      // specific part
      GalleryMWs.listDirectory,
      ThumbnailGeneratorMWs.addThumbnailInformation,
      GalleryMWs.cleanUpGalleryResults,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderResult
    );
  }

  protected static addDirectoryZip(app: Express): void {
    app.get(
      [Config.Server.apiPath + '/gallery/zip/:searchQueryDTO(*)'],
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.authorise(UserRoles.LimitedGuest),

      // specific part
      GalleryMWs.parseSearchQuery,
      ServerTimingMWs.addServerTiming,
      GalleryMWs.zipDirectory
    );
  }

  protected static addGetImage(app: Express): void {
    app.get(
      [
        Config.Server.apiPath + '/gallery/content/:mediaPath(*\\.(' +
        SupportedFormats.Photos.join('|') +
        '))',
      ],
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.normalizePathParam('mediaPath'),
      AuthenticationMWs.authoriseMedia('mediaPath'),

      // specific part
      GalleryMWs.loadFile,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  protected static addGetVideo(app: Express): void {
    app.get(
      [
        Config.Server.apiPath + '/gallery/content/:mediaPath(*\\.(' +
        SupportedFormats.Videos.join('|') +
        '))',
      ],
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.normalizePathParam('mediaPath'),
      AuthenticationMWs.authoriseMedia('mediaPath'),

      // specific part
      GalleryMWs.loadFile,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  protected static addGetBestFitVideo(app: Express): void {
    app.get(
      [
        Config.Server.apiPath + '/gallery/content/:mediaPath(*\\.(' +
        SupportedFormats.Videos.join('|') +
        '))/bestFit',
      ],
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.normalizePathParam('mediaPath'),
      AuthenticationMWs.authoriseMedia('mediaPath'),

      // specific part
      GalleryMWs.loadFile,
      GalleryMWs.loadBestFitVideo,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  protected static addGetMetaFile(app: Express): void {
    app.get(
      [
        Config.Server.apiPath + '/gallery/content/:mediaPath(*\\.(' +
        SupportedFormats.MetaFiles.join('|') +
        '))',
      ],
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.normalizePathParam('mediaPath'),
      AuthenticationMWs.authoriseMetaFiles('mediaPath'),

      // specific part
      GalleryMWs.loadFile,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  protected static addGetBestFitMetaFile(app: Express): void {
    app.get(
      [
        Config.Server.apiPath + '/gallery/content/:mediaPath(*\\.(' +
        SupportedFormats.MetaFiles.join('|') +
        '))/bestFit',
      ],
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.normalizePathParam('mediaPath'),
      AuthenticationMWs.authoriseMetaFiles('mediaPath'),

      // specific part
      GalleryMWs.loadFile,
      MetaFileMWs.compressGPX,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  protected static addRandom(app: Express): void {
    app.options(
      [
        Config.Server.apiPath + '/gallery/random/:searchQueryDTO(*)',
        Config.Server.apiPath + '/gallery/random-link/:' + QueryParams.gallery.sharingKey_params,
      ],
      SecurityMWs.crossOriginRandomResource
    );
    app.get(
      [Config.Server.apiPath + '/gallery/random/:searchQueryDTO(*)'],
      // common part
      SecurityMWs.crossOriginRandomResource,
      AuthenticationMWs.authenticate,
      AuthenticationMWs.authorise(UserRoles.LimitedGuest),
      VersionMWs.injectGalleryVersion,

      // specific part
      GalleryMWs.parseSearchQuery,
      GalleryMWs.getRandomImage,
      GalleryMWs.loadFile,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
    app.get(
      [Config.Server.apiPath + '/gallery/random-link/:' + QueryParams.gallery.sharingKey_params],
      // common part
      SecurityMWs.crossOriginRandomResource,
      GalleryMWs.setRandomSharingKeyParam,

      // specific part
      GalleryMWs.loadRandomLinkQuery,
      VersionMWs.injectGalleryVersion,
      GalleryMWs.getRandomImage,
      GalleryMWs.loadFile,
      GalleryMWs.clearTemporaryRandomLinkContext,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  /**
   * Used for serving photo thumbnails and previews
   * @param app
   * @protected
   */
  protected static addGetResizedPhoto(app: Express): void {
    app.get(
      Config.Server.apiPath + '/gallery/content/:mediaPath(*\\.(' +
      SupportedFormats.Photos.join('|') +
      '))/:size',
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.normalizePathParam('mediaPath'),
      AuthenticationMWs.authoriseMedia('mediaPath'),

      // specific part
      GalleryMWs.loadFile,
      ThumbnailGeneratorMWs.generateThumbnailFactory(ThumbnailSourceType.Photo),
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  protected static addGetVideoThumbnail(app: Express): void {
    app.get(
      Config.Server.apiPath + '/gallery/content/:mediaPath(*\\.(' +
      SupportedFormats.Videos.join('|') +
      '))/:size',
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.normalizePathParam('mediaPath'),
      AuthenticationMWs.authoriseMedia('mediaPath'),

      // specific part
      GalleryMWs.loadFile,
      ThumbnailGeneratorMWs.generateThumbnailFactory(ThumbnailSourceType.Video),
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  protected static addGetVideoIcon(app: Express): void {
    app.get(
      Config.Server.apiPath + '/gallery/content/:mediaPath(*\\.(' +
      SupportedFormats.Videos.join('|') +
      '))/icon',
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.normalizePathParam('mediaPath'),
      AuthenticationMWs.authoriseMedia('mediaPath'),

      // specific part
      GalleryMWs.loadFile,
      ThumbnailGeneratorMWs.generateIconFactory(ThumbnailSourceType.Video),
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  protected static addGetImageIcon(app: Express): void {
    app.get(
      Config.Server.apiPath + '/gallery/content/:mediaPath(*\\.(' +
      SupportedFormats.Photos.join('|') +
      '))/icon',
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.normalizePathParam('mediaPath'),
      AuthenticationMWs.authoriseMedia('mediaPath'),

      // specific part
      GalleryMWs.loadFile,
      ThumbnailGeneratorMWs.generateIconFactory(ThumbnailSourceType.Photo),
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderFile
    );
  }

  protected static addSearch(app: Express): void {
    app.get(
      Config.Server.apiPath + '/search/:searchQueryDTO(*)',
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.authorise(UserRoles.LimitedGuest),
      VersionMWs.injectGalleryVersion,

      // specific part
      GalleryMWs.parseSearchQuery,
      GalleryMWs.search,
      ThumbnailGeneratorMWs.addThumbnailInformation,
      GalleryMWs.cleanUpGalleryResults,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderResult
    );
  }

  protected static addAutoComplete(app: Express): void {
    app.get(
      Config.Server.apiPath + '/autocomplete/:value(*)',
      // common part
      AuthenticationMWs.authenticate,
      AuthenticationMWs.authorise(UserRoles.LimitedGuest),
      VersionMWs.injectGalleryVersion,

      // specific part
      GalleryMWs.autocomplete,
      ServerTimingMWs.addServerTiming,
      RenderingMWs.renderResult
    );
  }
}
