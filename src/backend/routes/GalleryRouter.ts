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
    this.addGetSignedMailViewer(app);
    this.addGetSignedMailMedia(app);
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

  protected static addGetSignedMailViewer(app: Express): void {
    app.get(
      Config.Server.apiPath + '/gallery/mail-view/:expires/:signature/:mediaPath(*)',
      async (req, res): Promise<void> => {
        const mediaPath = req.params['mediaPath'];
        const expires = parseInt(req.params['expires'], 10);
        const signature = req.params['signature'];
        if (!mediaPath || !MailMediaLink.verify(mediaPath, 0, expires, signature)) {
          res.sendStatus(403);
          return;
        }

        const absolutePath = MailMediaLink.safeAbsoluteMediaPath(mediaPath);
        if (!absolutePath) {
          res.sendStatus(404);
          return;
        }

        const lowerExt = path.extname(absolutePath).toLowerCase().replace('.', '');
        const isPhoto = SupportedFormats.Photos.indexOf(lowerExt) !== -1;
        const isVideo = SupportedFormats.Videos.indexOf(lowerExt) !== -1;
        if (!isPhoto && !isVideo) {
          res.sendStatus(404);
          return;
        }

        const directoryPath = mediaPath.split('/').slice(0, -1).join('/');
        const fileName = mediaPath.split('/').pop() || mediaPath;
        const mediaUrl = MailMediaLink.signedMediaPath(mediaPath, expires);
        const galleryUrl = this.galleryUrl(directoryPath, fileName);
        const directoryUrl = this.galleryUrl(directoryPath);
        const title = this.escapeHtml(fileName);
        const mediaTag = isVideo ?
          `<video class="media" src="${this.escapeHtml(mediaUrl)}" controls autoplay playsinline></video>` :
          `<img class="media" src="${this.escapeHtml(mediaUrl)}" alt="${title}">`;

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(`<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>${title}</title>
  <style>
    html,body{margin:0;height:100%;background:#05070a;color:#f5f7fb;font-family:Arial,sans-serif}
    body{display:flex;flex-direction:column;overflow:hidden}
    .bar{height:48px;display:flex;align-items:center;gap:10px;padding:0 12px;background:#10141c;border-bottom:1px solid #232a36;box-sizing:border-box}
    .title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;color:#d9e2ef}
    a{color:#f5f7fb;text-decoration:none}
    .button{display:inline-flex;align-items:center;height:32px;padding:0 10px;border-radius:6px;background:#263143;border:1px solid #3a4658;font-size:13px}
    .stage{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
    .media{max-width:100vw;max-height:calc(100vh - 48px);object-fit:contain}
    video.media{width:100vw;height:calc(100vh - 48px);background:#000}
  </style>
</head>
<body>
  <div class="bar">
    <a class="button" href="${this.escapeHtml(directoryUrl)}">Fermer</a>
    <div class="title">${title}</div>
    <a class="button" href="${this.escapeHtml(galleryUrl)}">PiGallery</a>
  </div>
  <div class="stage">${mediaTag}</div>
</body>
</html>`);
      }
    );
  }

  protected static addGetSignedMailMedia(app: Express): void {
    app.get(
      Config.Server.apiPath + '/gallery/mail-media/:expires/:signature/:mediaPath(*)',
      async (req, res, next): Promise<void> => {
        const mediaPath = req.params['mediaPath'];
        const expires = parseInt(req.params['expires'], 10);
        const signature = req.params['signature'];
        if (!mediaPath || !MailMediaLink.verify(mediaPath, 0, expires, signature)) {
          res.sendStatus(403);
          return;
        }

        const absolutePath = MailMediaLink.safeAbsoluteMediaPath(mediaPath);
        if (!absolutePath) {
          res.sendStatus(404);
          return;
        }

        const lowerExt = path.extname(absolutePath).toLowerCase().replace('.', '');
        if (SupportedFormats.Photos.indexOf(lowerExt) === -1 && SupportedFormats.Videos.indexOf(lowerExt) === -1) {
          res.sendStatus(404);
          return;
        }

        req.resultPipe = absolutePath;
        res.setHeader('Cache-Control', 'private, max-age=604800, immutable');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        return RenderingMWs.renderFile(req, res, next);
      }
    );
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

  private static galleryUrl(directoryPath: string, fileName?: string): string {
    const encodedDirectory = directoryPath
      .split('/')
      .filter(p => p.length > 0)
      .map(p => encodeURIComponent(p).replace(/[!'()*]/g, c =>
        '%' + c.charCodeAt(0).toString(16).toUpperCase()
      ))
      .join('/');
    const galleryPath = encodedDirectory ? '/gallery/' + encodedDirectory : '/gallery';
    if (!fileName) {
      return galleryPath;
    }
    const encodedFileName = encodeURIComponent(fileName).replace(/[!'()*]/g, c =>
      '%' + c.charCodeAt(0).toString(16).toUpperCase()
    );
    return galleryPath + '?p=' + encodedFileName;
  }

  private static escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
