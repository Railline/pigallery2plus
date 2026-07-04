import * as path from 'path';
import {constants as fsConstants, existsSync, promises as fsp, readFileSync} from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import {ProjectPath} from '../../../ProjectPath';
import {Config} from '../../../../common/config/private/Config';
import {ImageRendererFactory, MediaRendererInput, PhotoWorker, SvgRendererInput, ThumbnailSourceType,} from '../PhotoWorker';
import {ITaskExecuter, TaskExecuter} from '../TaskExecuter';
import {FaceRegion, PhotoDTO} from '../../../../common/entities/PhotoDTO';
import {SupportedFormats} from '../../../../common/SupportedFormats';
import {PersonEntry} from '../../database/enitites/person/PersonEntry';
import {SVGIconConfig} from '../../../../common/config/public/ClientConfig';
import {Logger} from '../../../Logger';

export class PhotoProcessing {
  private static initDone = false;
  private static taskQue: ITaskExecuter<MediaRendererInput | SvgRendererInput, void> = null;
  private static readonly CONVERTED_EXTENSION = '.webp';
  private static readonly thumbnailGenerationInFlight = new Map<string, Promise<string>>();
  private static readonly failureMarkerExtension = '.failed.json';
  private static readonly failedThumbnailLog = new Set<string>();

  public static init(): void {
    if (this.initDone === true) {
      return;
    }

    Config.Media.Photo.concurrentThumbnailGenerations = Math.max(
      1,
      os.cpus().length - 1
    );

    if (Config.Media.Photo.concurrentThumbnailGenerationsLimit > 0) {
      Config.Media.Photo.concurrentThumbnailGenerations = Math.min(Config.Media.Photo.concurrentThumbnailGenerations, Config.Media.Photo.concurrentThumbnailGenerationsLimit);
    }

    this.taskQue = new TaskExecuter(
      Config.Media.Photo.concurrentThumbnailGenerations,
      (input): Promise<void> => PhotoWorker.render(input)
    );

    this.initDone = true;
  }

  public static async generatePersonThumbnail(
    person: PersonEntry
  ): Promise<string> {
    // load parameters
    const photo: PhotoDTO = person.cache.sampleRegion.media;
    const mediaPath = path.join(
      ProjectPath.ImageFolder,
      photo.directory.path,
      photo.directory.name,
      photo.name
    );
    const size: number = Config.Media.Photo.personThumbnailSize;
    const faceRegion = person.cache.sampleRegion.media.metadata.faces.find(f => f.name === person.name);
    // generate thumbnail path
    const thPath = PhotoProcessing.generatePersonThumbnailPath(
      mediaPath,
      faceRegion,
      size
    );

    // check if thumbnail already exist
    try {
      await fsp.access(thPath, fsConstants.R_OK);
      return thPath;
    } catch (e) {
      // ignoring errors
    }

    const margin = {
      x: Math.round(
        faceRegion.box.width *
        Config.Media.Photo.personFaceMargin
      ),
      y: Math.round(
        faceRegion.box.height *
        Config.Media.Photo.personFaceMargin
      ),
    };

    // run on other thread
    const input = {
      type: ThumbnailSourceType.Photo,
      mediaPath,
      size,
      outPath: thPath,
      makeSquare: false,
      cut: {
        left: Math.round(
          Math.max(0, faceRegion.box.left - margin.x / 2)
        ),
        top: Math.round(
          Math.max(0, faceRegion.box.top - margin.y / 2)
        ),
        width: faceRegion.box.width + margin.x,
        height: faceRegion.box.height + margin.y,
      },
      useLanczos3: Config.Media.Photo.useLanczos3,
      quality: Config.Media.Photo.quality,
      smartSubsample: Config.Media.Photo.smartSubsample,
    } as MediaRendererInput;
    input.cut.width = Math.min(
      input.cut.width,
      photo.metadata.size.width - input.cut.left
    );
    input.cut.height = Math.min(
      input.cut.height,
      photo.metadata.size.height - input.cut.top
    );

    await fsp.mkdir(ProjectPath.FacesFolder, {recursive: true});
    await PhotoProcessing.taskQue.execute(input);
    return thPath;
  }

  public static generateConvertedPath(mediaPath: string, size: number): string {
    const file = path.basename(mediaPath);
    const animated = Config.Media.Photo.animateGif && path.extname(mediaPath).toLowerCase() == '.gif';
    return path.join(
      ProjectPath.TranscodedFolder,
      ProjectPath.getRelativePathToImages(path.dirname(mediaPath)),
      file + '_' + size + 'q' + Config.Media.Photo.quality +
      (animated ? 'anim' : '') +
      (Config.Media.Photo.smartSubsample ? 'cs' : '') +
      PhotoProcessing.CONVERTED_EXTENSION
    );
  }

  private static generateFailureMarkerPath(outPath: string): string {
    return outPath + PhotoProcessing.failureMarkerExtension;
  }

  private static isPermanentThumbnailError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (PhotoProcessing.isPixelLimitError(error)) {
      return false;
    }
    return message.indexOf('unsupported image format') !== -1 ||
      message.indexOf('invalid image') !== -1 ||
      message.indexOf('corrupt') !== -1 ||
      message.indexOf('vips') !== -1;
  }

  private static isPixelLimitError(error: unknown): boolean {
    const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
    return message.indexOf('input image exceeds pixel limit') !== -1;
  }

  public static isRegenerableFailedThumbnail(outPath: string): boolean {
    const markerPath = PhotoProcessing.generateFailureMarkerPath(outPath);
    if (!existsSync(markerPath)) {
      return false;
    }
    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as { reason?: string };
      return (marker.reason || '').toLowerCase().indexOf('input image exceeds pixel limit') !== -1;
    } catch (e) {
      return false;
    }
  }

  private static async removeFailedThumbnail(outPath: string): Promise<void> {
    await Promise.all([
      fsp.unlink(outPath).catch((): undefined => undefined),
      fsp.unlink(PhotoProcessing.generateFailureMarkerPath(outPath)).catch((): undefined => undefined),
    ]);
  }

  private static async removeRegenerableFailedThumbnail(outPath: string): Promise<void> {
    if (!PhotoProcessing.isRegenerableFailedThumbnail(outPath)) {
      return;
    }
    await PhotoProcessing.removeFailedThumbnail(outPath);
  }

  private static async removeFailedThumbnailIfSourceIsReadable(
    input: MediaRendererInput,
    outPath: string
  ): Promise<void> {
    const markerPath = PhotoProcessing.generateFailureMarkerPath(outPath);
    if (!existsSync(markerPath)) {
      return;
    }
    if (PhotoProcessing.isRegenerableFailedThumbnail(outPath)) {
      await PhotoProcessing.removeFailedThumbnail(outPath);
      return;
    }

    const dryRunInput = {
      ...input,
      size: Math.min(input.size, 32),
      makeSquare: false,
    };

    try {
      await ImageRendererFactory.render(dryRunInput, true);
    } catch (error) {
      if (!input.animate || !PhotoProcessing.isPixelLimitError(error)) {
        return;
      }
      try {
        await ImageRendererFactory.render({
          ...dryRunInput,
          animate: false,
        }, true);
      } catch (staticError) {
        return;
      }
    }

    Logger.info(
      '[PhotoProcessing]',
      'Removing stale failed thumbnail because source is now readable: ' + input.mediaPath
    );
    await PhotoProcessing.removeFailedThumbnail(outPath);
  }

  private static async writeFailedThumbnailPlaceholder(
    input: MediaRendererInput,
    outPath: string,
    error: unknown
  ): Promise<void> {
    const safeMessage = (error instanceof Error ? error.message : String(error))
      .replace(/[<>&"']/g, ' ')
      .substring(0, 180);
    if (!PhotoProcessing.failedThumbnailLog.has(outPath)) {
      PhotoProcessing.failedThumbnailLog.add(outPath);
      Logger.warn(
        '[PhotoProcessing]',
        'Using fallback thumbnail for unsupported media: ' + input.mediaPath + ' (' + safeMessage + ')'
      );
    }
    const svgString =
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">' +
      '<rect width="100%" height="100%" fill="#1f2328"/>' +
      '<path d="M34 38h188v142H34z" fill="none" stroke="#8b949e" stroke-width="6"/>' +
      '<path d="M54 156l38-46 28 32 22-26 44 40" fill="none" stroke="#8b949e" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="194" cy="66" r="14" fill="#8b949e"/>' +
      '<text x="50%" y="230" text-anchor="middle" fill="#c9d1d9" font-family="Arial, sans-serif" font-size="14">thumbnail unavailable</text>' +
      '</svg>';
    const marker = {
      mediaPath: input.mediaPath,
      outPath,
      created: Date.now(),
      reason: safeMessage,
    };
    await fsp.mkdir(path.dirname(outPath), {recursive: true});
    await this.taskQue.execute({
      type: ThumbnailSourceType.Photo,
      svgString,
      size: input.size,
      outPath,
      makeSquare: true,
      useLanczos3: input.useLanczos3,
      quality: input.quality,
    } as SvgRendererInput);
    await fsp.writeFile(
      PhotoProcessing.generateFailureMarkerPath(outPath),
      JSON.stringify(marker, null, 2)
    );
  }

  public static generatePersonThumbnailPath(
    mediaPath: string,
    faceRegion: FaceRegion,
    size: number
  ): string {
    return path.join(
      ProjectPath.FacesFolder,
      crypto
        .createHash('md5')
        .update(
          mediaPath +
          '_' +
          faceRegion.name +
          '_' +
          faceRegion.box.left +
          '_' +
          faceRegion.box.top
        )
        .digest('hex') +
      '_' +
      size +
      '_' + Config.Media.Photo.personFaceMargin +
      PhotoProcessing.CONVERTED_EXTENSION
    );
  }

  /**
   * Tells if the path is valid with the current config
   * @param convertedPath
   */
  public static async isValidConvertedPath(
    convertedPath: string
  ): Promise<boolean> {
    const origFilePath = path.join(
      ProjectPath.ImageFolder,
      path.relative(
        ProjectPath.TranscodedFolder,
        convertedPath.substring(0, convertedPath.lastIndexOf('_'))
      )
    );

    if (path.extname(convertedPath) !== PhotoProcessing.CONVERTED_EXTENSION) {
      return false;
    }
    let nextIndex = convertedPath.lastIndexOf('_') + 1;

    const sizeStr = convertedPath.substring(
      nextIndex,
      convertedPath.lastIndexOf('q')
    );
    nextIndex = convertedPath.lastIndexOf('q') + 1;

    const size = parseInt(sizeStr, 10);

    if (
      (size + '').length !== sizeStr.length ||
      (Config.Media.Photo.thumbnailSizes.indexOf(size) === -1)
    ) {
      return false;
    }

    const qualityStr = convertedPath.substring(nextIndex,
      nextIndex + convertedPath.substring(nextIndex).search(/[A-Za-z]/)); // end of quality string

    const quality = parseInt(qualityStr, 10);

    if ((quality + '').length !== qualityStr.length ||
      quality !== Config.Media.Photo.quality) {
      return false;
    }


    nextIndex += qualityStr.length;


    const lowerExt = path.extname(origFilePath).toLowerCase();
    const shouldBeAnimated = Config.Media.Photo.animateGif && lowerExt == '.gif';
    if (shouldBeAnimated) {
      if (convertedPath.substring(
        nextIndex,
        nextIndex + 'anim'.length
      ) != 'anim') {
        return false;
      }
      nextIndex += 'anim'.length;
    }


    if (Config.Media.Photo.smartSubsample) {
      if (convertedPath.substring(
        nextIndex,
        nextIndex + 2
      ) != 'cs') {
        return false;
      }
      nextIndex += 2;
    }

    if (convertedPath.substring(
      nextIndex
    ).toLowerCase() !== path.extname(convertedPath)) {
      return false;
    }


    try {
      await fsp.access(origFilePath, fsConstants.R_OK);
    } catch (e) {
      return false;
    }

    return true;
  }


  static async convertedPhotoExist(
    mediaPath: string,
    size: number
  ): Promise<boolean> {
    // generate thumbnail path
    const outPath = PhotoProcessing.generateConvertedPath(mediaPath, size);

    await PhotoProcessing.removeRegenerableFailedThumbnail(outPath);

    // check if file already exist
    try {
      await fsp.access(outPath, fsConstants.R_OK);
      return true;
    } catch (e) {
      // ignoring errors
    }
    return false;
  }


  public static async generateThumbnail(
    mediaPath: string,
    size: number,
    sourceType: ThumbnailSourceType,
    makeSquare: boolean
  ): Promise<string> {
    // generate thumbnail path
    const outPath = PhotoProcessing.generateConvertedPath(mediaPath, size);

    const runningGeneration = PhotoProcessing.thumbnailGenerationInFlight.get(outPath);
    if (runningGeneration) {
      return runningGeneration;
    }

    // run on other thread
    const input = {
      type: sourceType,
      mediaPath,
      size,
      outPath,
      makeSquare,
      useLanczos3: Config.Media.Photo.useLanczos3,
      quality: Config.Media.Photo.quality,
      smartSubsample: Config.Media.Photo.smartSubsample,
      sharpOptions: Config.Media.Photo.sharpOptions,
      animate: Config.Media.Photo.animateGif
    } as MediaRendererInput;

    await PhotoProcessing.removeFailedThumbnailIfSourceIsReadable(input, outPath);

    // check if file already exist
    try {
      await fsp.access(outPath, fsConstants.R_OK);
      return outPath;
    } catch (e) {
      // ignoring errors
    }

    const outDir = path.dirname(input.outPath);

    const generation = (async (): Promise<string> => {
      await fsp.mkdir(outDir, {recursive: true});
      try {
        await this.taskQue.execute(input);
      } catch (error) {
        if (sourceType === ThumbnailSourceType.Photo && input.animate && PhotoProcessing.isPixelLimitError(error)) {
          Logger.warn(
            '[PhotoProcessing]',
            'Animated thumbnail exceeds pixel limit, retrying as static thumbnail: ' + input.mediaPath
          );
          await this.taskQue.execute({
            ...input,
            animate: false,
          });
          return outPath;
        }
        if (sourceType !== ThumbnailSourceType.Photo || !PhotoProcessing.isPermanentThumbnailError(error)) {
          throw error;
        }
        await PhotoProcessing.writeFailedThumbnailPlaceholder(input, outPath, error);
      }
      return outPath;
    })();
    PhotoProcessing.thumbnailGenerationInFlight.set(outPath, generation);
    try {
      return await generation;
    } finally {
      if (PhotoProcessing.thumbnailGenerationInFlight.get(outPath) === generation) {
        PhotoProcessing.thumbnailGenerationInFlight.delete(outPath);
      }
    }
  }

  public static isPhoto(fullPath: string): boolean {
    const extension = path.extname(fullPath).toLowerCase();
    return SupportedFormats.WithDots.Photos.indexOf(extension) !== -1;
  }

  public static async renderSVG(
    svgIcon: SVGIconConfig,
    outPath: string,
    color = '#000'
  ): Promise<string> {
    // Generate hash from SVG content and color to create unique filename
    const contentHash = crypto
      .createHash('md5')
      .update(JSON.stringify(svgIcon) + color)
      .digest('hex')
      .substring(0, 8);

    // Update outPath to include hash
    const ext = path.extname(outPath);
    const baseName = path.basename(outPath, ext);
    const dir = path.dirname(outPath);
    const hashedOutPath = path.join(dir, `${baseName}_${contentHash}${ext}`);

    // check if the file already exists
    try {
      await fsp.access(hashedOutPath, fsConstants.R_OK);
      return hashedOutPath;
    } catch (e) {
      // ignoring errors
    }

    const size = 256;
    // run on other thread
    const input = {
      type: ThumbnailSourceType.Photo,
      svgString: `<svg fill="${color}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"
viewBox="${svgIcon.viewBox || '0 0 512 512'}">d="${svgIcon.items}</svg>`,
      size: size,
      outPath: hashedOutPath,
      makeSquare: false,
      animate: false,
      useLanczos3: Config.Media.Photo.useLanczos3,
      quality: Config.Media.Photo.quality,
      smartSubsample: Config.Media.Photo.smartSubsample,
    } as SvgRendererInput;

    const outDir = path.dirname(input.outPath);

    await fsp.mkdir(outDir, {recursive: true});
    await this.taskQue.execute(input);
    return hashedOutPath;
  }

}
