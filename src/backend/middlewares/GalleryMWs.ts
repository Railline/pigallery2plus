import * as path from 'path';
import {promises as fsp} from 'fs';
import archiver = require('archiver');
import {NextFunction, Request, Response} from 'express';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import {ParentDirectoryDTO,} from '../../common/entities/DirectoryDTO';
import {ObjectManagers} from '../model/ObjectManagers';
import {ContentWrapper, ContentWrapperUtils} from '../../common/entities/ContentWrapper';
import {ProjectPath} from '../ProjectPath';
import {Config} from '../../common/config/private/Config';
import {MediaDTO, MediaDTOUtils} from '../../common/entities/MediaDTO';
import {VideoDTO} from '../../common/entities/VideoDTO';
import {QueryParams} from '../../common/QueryParams';
import {VideoProcessing} from '../model/fileaccess/fileprocessing/VideoProcessing';
import {SearchQueryDTO, SearchQueryTypes,} from '../../common/entities/SearchQueryDTO';
import {SearchQueryUtils} from '../../common/SearchQueryUtils';
import {LocationLookupException} from '../exceptions/LocationLookupException';
import {ServerTime} from './ServerTimingMWs';
import {Logger} from '../Logger';
import {UserRoles} from '../../common/entities/UserDTO';
import {ContextUser, SessionContext} from '../model/SessionContext';
import {SortingMethod} from '../../common/entities/SortingMethods';
import {PhotoProcessing} from '../model/fileaccess/fileprocessing/PhotoProcessing';
import {ThumbnailSourceType} from '../model/fileaccess/PhotoWorker';

export class GalleryMWs {
  private static readonly MAX_SEARCH_PAGE_SIZE = 1000;
  private static readonly RANDOM_CACHE_TTL = 15 * 60 * 1000;
  private static readonly RANDOM_CACHE_MAX = 64;
  private static readonly RANDOM_BATCH_SIZE = 15;
  private static readonly RANDOM_REFILL_THRESHOLD = 5;
  private static readonly RANDOM_DEFAULT_PREVIEW_SIZE = 1080;
  private static readonly randomMediaPathCache = new Map<string, {
    paths: string[],
    expires: number,
    created: number,
    hits: number,
    refill?: Promise<void>,
  }>();

  /**
   * Middleware to safely parse searchQueryDTO from URL parameters
   * Handles URL decoding and JSON parsing with proper error handling
   */
  public static parseSearchQuery(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    try {
      if (!req.params['searchQueryDTO']) {
        return next();
      }

      let rawQueryParam = req.params['searchQueryDTO'] as string;

      let query: SearchQueryDTO;
      try {
        query = SearchQueryUtils.parseURLifiedQuery(rawQueryParam);
      } catch (parseError) {
        try {
          query = SearchQueryUtils.parseURLifiedQuery(decodeURIComponent(rawQueryParam));
        } catch (decodeParseError) {
          return next(
            new ErrorDTO(
              ErrorCodes.INPUT_ERROR,
              'Invalid search query JSON: ' + decodeParseError.message,
              decodeParseError
            )
          );
        }
      }

      try {
        SearchQueryUtils.validateSearchQuery(query);
      } catch (validationError) {
        return next(
          new ErrorDTO(
            ErrorCodes.INPUT_ERROR,
            'Invalid search query: ' + (validationError as Error).message,
            validationError
          )
        );
      }

      // Store the parsed query for use by subsequent middlewares
      req.resultPipe = query;
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(ErrorCodes.GENERAL_ERROR, 'Error parsing search query', err)
      );
    }
  }

  @ServerTime('1.db', 'List Directory')
  public static async listDirectory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const directoryName = req.params['directory'] || '/';
    const absoluteDirectoryName = ProjectPath.resolveMediaPath(directoryName);
    if (!absoluteDirectoryName) {
      return next();
    }
    try {
      if ((await fsp.stat(absoluteDirectoryName)).isDirectory() === false) {
        return next();
      }
    } catch (e) {
      return next();
    }

    try {
      const directory =
        await ObjectManagers.getInstance().GalleryManager.listDirectory(
          req.session.context,
          directoryName,
          parseInt(
            req.query[QueryParams.gallery.knownLastModified] as string,
            10
          ),
          parseInt(
            req.query[QueryParams.gallery.knownLastScanned] as string,
            10
          ),
          parseInt(req.query[QueryParams.gallery.mediaOffset] as string, 10),
          parseInt(req.query[QueryParams.gallery.mediaLimit] as string, 10),
          parseInt(req.query[QueryParams.gallery.mediaSortMethod] as string, 10),
          req.query[QueryParams.gallery.mediaSortAscending] !== '0'
        );

      if (directory == null) {
        req.resultPipe = ContentWrapperUtils.build(null, null, true);
        return next();
      }
      req.resultPipe = ContentWrapperUtils.build(directory, null);
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error during listing the directory',
          err
        )
      );
    }
  }

  @ServerTime('1.zip', 'Zip Directory')
  public static async zipDirectory(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (Config.Gallery.NavBar.enableDownloadZip === false) {
      return next();
    }

    if (Config.Search.enabled === false || !req.resultPipe) {
      return next();
    }

    // Handle search-query-based zip
    try {
      const query: SearchQueryDTO = req.resultPipe as any;

      // Get all media items from search
      const searchResult = await ObjectManagers.getInstance().SearchManager.search(
        req.session.context, query);

      if (!searchResult.media || searchResult.media.length === 0) {
        return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, 'No media found for zip'));
      }

      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', 'attachment; filename=SearchResults.zip');

      const archive = archiver('zip', {
        store: true, // disable compression
      });

      res.on('close', () => {
        console.log('zip ' + archive.pointer() + ' bytes');
      });

      archive.on('error', (err: Error) => {
        throw err;
      });

      archive.pipe(res);

      // Track used filenames (case insensitive)
      const usedNames = new Map<string, number>();

      // Add each media file to the archive with unique names
      for (const media of searchResult.media) {
        const mediaPath = ProjectPath.resolveMediaPath(path.join(
          media.directory.path,
          media.directory.name,
          media.name
        ));
        if (!mediaPath) {
          continue;
        }

        // Get file extension and base name
        const ext = path.extname(media.name);
        const baseName = path.basename(media.name, ext);
        const lowerName = media.name.toLowerCase();

        // Check if this name was used before
        let uniqueName = media.name;
        if (usedNames.has(lowerName)) {
          const count = usedNames.get(lowerName) + 1;
          usedNames.set(lowerName, count);
          uniqueName = baseName + '_' + count + ext;
        } else {
          usedNames.set(lowerName, 1);
        }

        archive.file(mediaPath, {name: uniqueName});
      }

      await archive.finalize();
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(ErrorCodes.GENERAL_ERROR, 'Error creating search results zip', err)
      );
    }
  }

  @ServerTime('3.pack', 'pack result')
  public static cleanUpGalleryResults(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (!req.resultPipe) {
      return next();
    }

    const cw = req.resultPipe as ContentWrapper;
    if (cw.notModified === true) {
      return next();
    }

    if (Config.Media.Video.enabled === false) {
      if (cw.directory) {
        const removeVideos = (dir: ParentDirectoryDTO): void => {
          dir.media = dir.media.filter(
            (m): boolean => !MediaDTOUtils.isVideo(m)
          );
        };
        removeVideos(cw.directory);
      }
      if (cw.searchResult) {
        cw.searchResult.media = cw.searchResult.media.filter(
          (m): boolean => !MediaDTOUtils.isVideo(m)
        );
      }
    }

    if (Config.Media.LivePhoto.enabled) {
      const pairLivePhotos = (mediaList: MediaDTO[], parentDir?: ParentDirectoryDTO): MediaDTO[] => {
        // Build a map of (contentIdentifier + dirPath) → video for companion videos
        const companionMap = new Map<string, MediaDTO>();
        for (const m of mediaList) {
          if (
            MediaDTOUtils.isVideo(m) &&
            m.metadata?.contentIdentifier
          ) {
            const dir = m.directory || parentDir;
            const dirPath = path.join(dir?.path || '', dir?.name || '');
            companionMap.set(m.metadata.contentIdentifier + '|' + dirPath, m);
          }
        }

        // Pair photos with their companion videos, remove paired videos from list
        const pairedVideoKeys = new Set<string>();
        for (const m of mediaList) {
          if (
            !MediaDTOUtils.isVideo(m) &&
            m.metadata?.contentIdentifier
          ) {
            const dir = m.directory || parentDir;
            const dirPath = path.join(dir?.path || '', dir?.name || '');
            const key = m.metadata.contentIdentifier + '|' + dirPath;
            const companion = companionMap.get(key);
            if (companion) {
              const companionDir = companion.directory || parentDir;
              m.liveVideoPath = path.join(
                companionDir?.path || '',
                companionDir?.name || '',
                companion.name
              );
              const videoMeta = (companion as VideoDTO).metadata;
              m.liveVideoInfo = {
                name: companion.name,
                size: videoMeta.size,
                fileSize: videoMeta.fileSize,
                duration: videoMeta.duration,
                fps: videoMeta.fps,
                bitRate: videoMeta.bitRate,
              };
              pairedVideoKeys.add(key);
            }
          }
        }

        return mediaList.filter(
          (m) => {
            if (!MediaDTOUtils.isVideo(m) || !m.metadata?.contentIdentifier) {
              return true;
            }
            const dir = m.directory || parentDir;
            const dirPath = path.join(dir?.path || '', dir?.name || '');
            return !pairedVideoKeys.has(m.metadata.contentIdentifier + '|' + dirPath);
          }
        );
      };

      if (cw.directory) {
        cw.directory.media = pairLivePhotos(cw.directory.media, cw.directory);
      }
      if (cw.searchResult) {
        cw.searchResult.media = pairLivePhotos(cw.searchResult.media);
      }
    }

    // Always strip contentIdentifier from responses — it's a server-side
    // matching key, not needed by the client.
    const stripContentId = (media: MediaDTO[]) => {
      for (const m of media) {
        if (m.metadata?.contentIdentifier) {
          delete m.metadata.contentIdentifier;
        }
      }
    };
    if (cw.directory?.media) {
      stripContentId(cw.directory.media);
    }
    if (cw.searchResult?.media) {
      stripContentId(cw.searchResult.media);
    }

    req.resultPipe = ContentWrapperUtils.pack(cw);

    return next();
  }

  public static async loadFile(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (!req.params['mediaPath']) {
      return next();
    }
    const fullMediaPath = ProjectPath.resolveMediaPath(req.params['mediaPath']);
    if (!fullMediaPath) {
      return next(
        new ErrorDTO(
          ErrorCodes.PATH_ERROR,
          'invalid media path:' + req.params['mediaPath'],
          'path is outside media root'
        )
      );
    }

    // check if file exist
    try {
      if ((await fsp.stat(fullMediaPath)).isDirectory()) {
        return next();
      }
    } catch (e) {
      return next(
        new ErrorDTO(
          ErrorCodes.PATH_ERROR,
          'no such file:' + req.params['mediaPath'],
          'can\'t find file: ' + fullMediaPath
        )
      );
    }

    req.resultPipe = fullMediaPath;
    return next();
  }

  public static async loadBestFitVideo(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (!req.resultPipe) {
      return next();
    }

    const fullMediaPath = req.resultPipe as string;
    const convertedVideo =
      VideoProcessing.generateConvertedFilePath(fullMediaPath);

    try {
      await fsp.access(convertedVideo);
      req.resultPipe = convertedVideo;
      return next();
    } catch (e) {
      // No converted file yet. Browser-native formats can still be served as-is.
    }

    const extension = path.extname(fullMediaPath).slice(1).toLowerCase();
    const browserSupported = Config.Media.Video.supportedFormats
      .map((format): string => format.toLowerCase())
      .includes(extension);

    if (browserSupported) {
      return next();
    }

    Logger.info(
      '[GalleryMWs]',
      'Starting background video transcode for browser playback:',
      req.params['mediaPath']
    );
    VideoProcessing.convertVideo(fullMediaPath).catch((e: unknown): void => {
      Logger.warn(
        '[GalleryMWs]',
        'Could not transcode video in background:',
        req.params['mediaPath'],
        e as Error
      );
    });

    return next();
  }

  @ServerTime('1.db', 'Search')
  public static async search(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (
        Config.Search.enabled === false ||
        !req.resultPipe
      ) {
        return next();
      }

      const query: SearchQueryDTO = req.resultPipe as any;
      const mediaOffset = parseInt(req.query[QueryParams.gallery.mediaOffset] as string, 10);
      const mediaLimit = parseInt(req.query[QueryParams.gallery.mediaLimit] as string, 10);
      const mediaSortMethod = parseInt(req.query[QueryParams.gallery.mediaSortMethod] as string, 10);
      const mediaSorting: SortingMethod[] = Number.isFinite(mediaSortMethod)
        ? [{
          method: mediaSortMethod as any,
          ascending: req.query[QueryParams.gallery.mediaSortAscending] !== '0',
        }]
        : undefined;
      const paging = Number.isFinite(mediaLimit) && mediaLimit > 0
        ? {
          offset: Number.isFinite(mediaOffset) && mediaOffset > 0 ? mediaOffset : 0,
          limit: Math.min(
            mediaLimit,
            Math.max(1, Math.min(Config.Search.maxMediaResult, GalleryMWs.MAX_SEARCH_PAGE_SIZE))
          ),
        }
        : undefined;
      const result = await ObjectManagers.getInstance().SearchManager.search(
        req.session.context,
        query,
        paging,
        mediaSorting
      );

      result.directories.forEach(
        (dir): MediaDTO[] => (dir.media = dir.media || [])
      );
      req.resultPipe = ContentWrapperUtils.build(null, result);
      return next();
    } catch (err) {
      if (err instanceof LocationLookupException) {
        return next(
          new ErrorDTO(
            ErrorCodes.LocationLookUp_ERROR,
            'Cannot find location: ' + err.location,
            err
          )
        );
      }
      return next(
        new ErrorDTO(ErrorCodes.GENERAL_ERROR, 'Error during searching', err)
      );
    }
  }

  @ServerTime('1.db', 'Autocomplete')
  public static async autocomplete(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (Config.Search.AutoComplete.enabled === false) {
        return next();
      }
      if (!req.params['value']) {
        return next();
      }

      let type: SearchQueryTypes = SearchQueryTypes.any_text;
      if (req.query[QueryParams.gallery.search.type]) {
        type = parseInt(req.query[QueryParams.gallery.search.type] as string, 10);
      }
      req.resultPipe =
        await ObjectManagers.getInstance().SearchManager.autocomplete(
          req.session.context,
          req.params['value'],
          type
        );
      return next();
    } catch (err) {
      return next(
        new ErrorDTO(ErrorCodes.GENERAL_ERROR, 'Error during searching', err)
      );
    }
  }

  public static async getRandomImage(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      if (
        Config.RandomPhoto.enabled === false ||
        !req.resultPipe
      ) {
        return next();
      }

      const query: SearchQueryDTO = req.resultPipe as any;
      const context = req.randomLinkContext || req.session.context;
      const started = Date.now();
      const cacheKey = GalleryMWs.getRandomCacheKey(req, context, query);
      let cache = GalleryMWs.randomMediaPathCache.get(cacheKey);
      const now = Date.now();

      if (!cache || cache.expires <= now) {
        cache = {
          paths: [],
          expires: Date.now() + GalleryMWs.RANDOM_CACHE_TTL,
          created: Date.now(),
          hits: 0,
        };
        GalleryMWs.randomMediaPathCache.set(cacheKey, cache);
        GalleryMWs.trimRandomCache();
      } else {
        cache.hits++;
      }

      if (cache.paths.length <= GalleryMWs.RANDOM_REFILL_THRESHOLD) {
        const activeCache = cache;
        if (!activeCache.refill) {
          activeCache.refill = (async (): Promise<void> => {
            const sqlStarted = Date.now();
            const paths = await ObjectManagers.getInstance().SearchManager.getRandomMediaPaths(
              context,
              query,
              GalleryMWs.RANDOM_BATCH_SIZE,
              true
            );
            GalleryMWs.shuffle(paths);
            activeCache.paths = paths.slice(0, GalleryMWs.RANDOM_BATCH_SIZE);
            activeCache.expires = Date.now() + GalleryMWs.RANDOM_CACHE_TTL;
            Logger.info(
              '[RandomPhoto]',
              'cache refill',
              'batch=' + paths.length,
              'remaining=' + activeCache.paths.length,
              'sqlMs=' + (Date.now() - sqlStarted),
              'key=' + cacheKey.slice(0, 16)
            );
          })().finally((): void => {
            delete activeCache.refill;
          });
        }
        await activeCache.refill;
      } else {
        Logger.info(
          '[RandomPhoto]',
          'cache hit',
          'remaining=' + cache.paths.length,
          'hits=' + cache.hits,
          'key=' + cacheKey.slice(0, 16)
        );
      }

      if (!cache.paths || cache.paths.length < 1) {
        return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, 'No photo found'));
      }

      const selected = cache.paths.shift();
      req.params['mediaPath'] = selected;
      Logger.silly(
        '[RandomPhoto]',
        'selected',
        'totalMs=' + (Date.now() - started),
        'remaining=' + cache.paths.length
      );
      return next();
    } catch (e) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Can\'t get random photo: ' + e.toString()
        )
      );
    }
  }

  /**
   * Random links are commonly polled by wallpaper and dashboard clients. Serve
   * a cached preview instead of repeatedly streaming a potentially large source
   * file from the media storage. The original remains available explicitly via
   * `?size=original`.
   */
  public static async loadRandomImagePreview(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    if (!req.resultPipe) {
      return next();
    }

    // A random URL is expected to return a different image on every request.
    // RenderingMWs preserves this header instead of applying its immutable
    // one-year file cache policy.
    res.setHeader('Cache-Control', 'no-store');

    const rawSize = req.query['size'];
    const requestedSize = Array.isArray(rawSize) ? rawSize[0] : rawSize;
    if (
      typeof requestedSize === 'string' &&
      requestedSize.trim().toLowerCase() === 'original'
    ) {
      return next();
    }

    const sizes = Config.Media.Photo.thumbnailSizes
      .filter((size): boolean => Number.isFinite(size) && size > 0)
      .slice()
      .sort((a, b): number => a - b);
    if (sizes.length === 0) {
      return next();
    }

    const parsedSize = typeof requestedSize === 'string'
      ? Number(requestedSize)
      : Number.NaN;
    const hasExplicitPreviewSize = Number.isFinite(parsedSize) && parsedSize > 0;
    const targetSize = hasExplicitPreviewSize
      ? parsedSize
      : GalleryMWs.RANDOM_DEFAULT_PREVIEW_SIZE;
    const previewSize = sizes.reduce((closest, candidate): number =>
      Math.abs(candidate - targetSize) < Math.abs(closest - targetSize)
        ? candidate
        : closest
    );

    const originalPath = req.resultPipe as string;
    try {
      if (!hasExplicitPreviewSize) {
        const cachedPreview = await PhotoProcessing.findExistingThumbnail(
          originalPath,
          sizes
        );
        if (cachedPreview) {
          req.resultPipe = cachedPreview;
          return next();
        }
      }
      req.resultPipe = await PhotoProcessing.generateThumbnail(
        originalPath,
        previewSize,
        ThumbnailSourceType.Photo,
        false
      );
    } catch (error) {
      // A random image should remain available if preview generation fails.
      req.resultPipe = originalPath;
      Logger.warn(
        '[RandomPhoto]',
        'Preview generation failed, serving the original: ' +
        (error instanceof Error ? error.message : String(error))
      );
    }
    return next();
  }

  public static async getMediaEntry(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {

      if (!req.params['mediaPath']) {
        return next();
      }
      const mediaPath = req.params['mediaPath'];

      req.resultPipe = await ObjectManagers.getInstance().GalleryManager.getMedia(req.session.context, mediaPath);
      return next();
    } catch (e) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Can\'t get random photo: ' + e.toString()
        )
      );
    }
  }

  public static setRandomSharingKeyParam(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if (req.params[QueryParams.gallery.sharingKey_params]) {
      req.query[QueryParams.gallery.sharingKey_query] = req.params[QueryParams.gallery.sharingKey_params];
    }
    return next();
  }

  public static async loadRandomLinkQuery(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const sharingKey = req.params[QueryParams.gallery.sharingKey_params] ||
        req.query[QueryParams.gallery.sharingKey_query];
      if (!sharingKey || typeof sharingKey !== 'string') {
        return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, 'No sharing key provided'));
      }
      const sharing = await ObjectManagers.getInstance().SharingManager.findOne(sharingKey);
      if (!sharing || sharing.expires < Date.now() || !sharing.searchQuery) {
        return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, 'Sharing link not found'));
      }
      // A random-link endpoint cannot prompt for a password. Exposing a regular
      // protected share here would silently bypass its authentication.
      if (Config.Sharing.passwordRequired || Boolean(sharing.password)) {
        res.status(403);
        return next(new ErrorDTO(ErrorCodes.NOT_AUTHORISED, 'Password-protected sharing links cannot be used as public random links'));
      }
      const user = {
        id: null,
        name: 'Guest',
        role: UserRoles.LimitedGuest,
        usedSharingKey: sharing.sharingKey,
        overrideAllowBlockList: true,
        allowQuery: ObjectManagers.getInstance().SessionManager.buildAllowListForSharing(sharing)
      } as ContextUser;
      // Keep the share-specific ACL request-scoped. Mutating req.session here
      // could persist guest privileges if a later middleware fails.
      req.randomLinkContext = await ObjectManagers.getInstance().SessionManager.buildContext(user);
      req.resultPipe = sharing.searchQuery;
      return next();
    } catch (e) {
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Can\'t load random sharing query: ' + e.toString()
        )
      );
    }
  }

  private static getRandomCacheKey(req: Request, context: SessionContext, query: SearchQueryDTO): string {
    const user = context?.user;
    const projection = user?.projectionKey || '';
    const sharingKey = user?.usedSharingKey || req.query[QueryParams.gallery.sharingKey_query] || '';
    return [
      projection,
      sharingKey,
      SearchQueryUtils.stringifyForComparison(query),
    ].join('|');
  }

  private static trimRandomCache(): void {
    if (GalleryMWs.randomMediaPathCache.size <= GalleryMWs.RANDOM_CACHE_MAX) {
      return;
    }
    const entries = Array.from(GalleryMWs.randomMediaPathCache.entries())
      .sort((a, b) => a[1].created - b[1].created);
    for (const [key] of entries.slice(0, GalleryMWs.randomMediaPathCache.size - GalleryMWs.RANDOM_CACHE_MAX)) {
      GalleryMWs.randomMediaPathCache.delete(key);
    }
  }

  private static shuffle<T>(items: T[]): void {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
  }
}
