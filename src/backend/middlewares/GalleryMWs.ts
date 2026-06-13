import * as path from 'path';
import {promises as fsp} from 'fs';
import * as archiver from 'archiver';
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
import {ContextUser} from '../model/SessionContext';

export class GalleryMWs {
  private static readonly RANDOM_CACHE_TTL = 15 * 60 * 1000;
  private static readonly RANDOM_CACHE_MAX = 64;
  private static readonly randomMediaPathCache = new Map<string, {
    paths: string[],
    expires: number,
    created: number,
    hits: number,
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
    const absoluteDirectoryName = path.join(
      ProjectPath.ImageFolder,
      directoryName
    );
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
        const mediaPath = path.join(
          ProjectPath.ImageFolder,
          media.directory.path,
          media.directory.name,
          media.name
        );

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
    const fullMediaPath = path.join(
      ProjectPath.ImageFolder,
      req.params['mediaPath']
    );

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

    try {
      Logger.info(
        '[GalleryMWs]',
        'Transcoding video on demand for browser playback:',
        req.params['mediaPath']
      );
      await VideoProcessing.convertVideo(fullMediaPath);
      await fsp.access(convertedVideo);
      req.resultPipe = convertedVideo;
    } catch (e) {
      Logger.warn(
        '[GalleryMWs]',
        'Could not transcode video on demand, falling back to original:',
        req.params['mediaPath'],
        e as Error
      );
    }

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
      const result = await ObjectManagers.getInstance().SearchManager.search(
        req.session.context,
        query
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
      const started = Date.now();
      const cacheKey = GalleryMWs.getRandomCacheKey(req, query);
      let cache = GalleryMWs.randomMediaPathCache.get(cacheKey);

      if (!cache || cache.expires <= Date.now()) {
        const sqlStarted = Date.now();
        const paths = await ObjectManagers.getInstance().SearchManager.getMediaPaths(
          req.session.context,
          query,
          true
        );
        cache = {
          paths,
          expires: Date.now() + GalleryMWs.RANDOM_CACHE_TTL,
          created: Date.now(),
          hits: 0,
        };
        GalleryMWs.randomMediaPathCache.set(cacheKey, cache);
        GalleryMWs.trimRandomCache();
        Logger.info(
          '[RandomPhoto]',
          'cache miss',
          'items=' + paths.length,
          'sqlMs=' + (Date.now() - sqlStarted),
          'key=' + cacheKey.slice(0, 16)
        );
      } else {
        cache.hits++;
        Logger.info(
          '[RandomPhoto]',
          'cache hit',
          'items=' + cache.paths.length,
          'hits=' + cache.hits,
          'key=' + cacheKey.slice(0, 16)
        );
      }

      if (!cache.paths || cache.paths.length < 1) {
        return next(new ErrorDTO(ErrorCodes.INPUT_ERROR, 'No photo found'));
      }

      const selected = cache.paths[Math.floor(Math.random() * cache.paths.length)];
      req.params['mediaPath'] = selected;
      Logger.info(
        '[RandomPhoto]',
        'selected',
        'totalMs=' + (Date.now() - started),
        'path=' + selected
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
      if (!req.session.context) {
        const user = {
          name: 'Guest',
          role: UserRoles.LimitedGuest,
          usedSharingKey: sharing.sharingKey,
          overrideAllowBlockList: true,
          allowQuery: ObjectManagers.getInstance().SessionManager.buildAllowListForSharing(sharing)
        } as ContextUser;
        req.session.context = await ObjectManagers.getInstance().SessionManager.buildContext(user);
        (req as any).temporaryRandomLinkContext = true;
      }
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

  public static clearTemporaryRandomLinkContext(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    if ((req as any).temporaryRandomLinkContext) {
      delete req.session.context;
      delete (req as any).temporaryRandomLinkContext;
    }
    return next();
  }

  private static getRandomCacheKey(req: Request, query: SearchQueryDTO): string {
    const user = req.session.context?.user;
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
}
