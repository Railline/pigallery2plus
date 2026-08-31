import {Utils} from '../../../../common/Utils';
import {Config} from '../../../../common/config/public/Config';
import {MediaDTO} from '../../../../common/entities/MediaDTO';
import {ContentWrapperUtils} from '../../../../common/entities/ContentWrapper';

export class MediaIcon {
  protected static readonly ThumbnailMap =
    Config.Media.Photo.generateThumbnailMap();
  static readonly sortedThumbnailSizes =
    [...Config.Media.Photo.thumbnailSizes].sort((a, b): number => a - b);


  protected replacementSizeCache: number | boolean = false;

  constructor(public media: MediaDTO) {
  }

  getExtension(): string {
    return this.media.name.substr(this.media.name.lastIndexOf('.') + 1);
  }

  iconLoaded(): void {
    this.media.missingThumbnails -=
      MediaIcon.ThumbnailMap[Config.Media.Photo.iconSize];
  }

  isIconAvailable(): boolean {
    // eslint-disable-next-line no-bitwise
    return (
      (this.media.missingThumbnails &
        MediaIcon.ThumbnailMap[Config.Media.Photo.iconSize]) ===
      0
    );
  }


  isPhotoAvailable(renderWidth: number, renderHeight: number): boolean {
    const size = this.getMediaSize(renderWidth, renderHeight);
    // eslint-disable-next-line no-bitwise
    return (
      (this.media.missingThumbnails &
        MediaIcon.ThumbnailMap[size]) === 0
    );
  }

  getReadableRelativePath(): string {
    return Utils.concatUrls(
      this.media.directory.path,
      this.media.directory.name,
      this.media.name
    );
  }

  getRelativePath(): string {
    return (
      encodeURI(
        this.getReadableRelativePath()
      )
        // do not escape all urls with encodeURIComponent because that make the URL ugly and not needed
        // do not escape before concatUrls as that would make prevent optimizations
        // .replace(new RegExp('%', 'g'), '%25') // order important
        .replace(new RegExp('#', 'g'), '%23')
        .replace(new RegExp('\\$', 'g'), '%24')
        .replace(new RegExp('\\?', 'g'), '%3F')
    );
  }

  getIconPath(): string {
    return Utils.concatUrls(
      Config.Server.urlBase,
      Config.Server.apiPath,
      '/gallery/content/',
      this.getRelativePath(),
      'icon'
    );
  }

  getSizedMediaPath(size: number): string {
    return Utils.concatUrls(
      Config.Server.urlBase,
      Config.Server.apiPath,
      '/gallery/content/',
      this.getRelativePath(),
      size.toString()
    );
  }

  getOriginalMediaPath(): string {
    return Utils.concatUrls(
      Config.Server.urlBase,
      Config.Server.apiPath,
      '/gallery/content/',
      this.getRelativePath()
    );
  }

  /**
   * Returns the number of physical pixels required on the shorter edge of a
   * thumbnail. Generated previews use their configured size on that edge, so
   * basing the calculation on the viewport's longer edge wastes bandwidth for
   * portraits and panoramas.
   */
  getRequiredMediaSize(
    renderWidth: number,
    renderHeight: number,
    pixelRatio = MediaIcon.getDevicePixelRatio()
  ): number {
    const sourceWidth = this.media.metadata.size.width;
    const sourceHeight = this.media.metadata.size.height;
    const safeRenderWidth = Math.max(0, Number(renderWidth) || 0);
    const safeRenderHeight = Math.max(0, Number(renderHeight) || 0);
    const safePixelRatio = Math.max(1, Number(pixelRatio) || 1);

    if (
      sourceWidth <= 0 ||
      sourceHeight <= 0 ||
      safeRenderWidth === 0 ||
      safeRenderHeight === 0
    ) {
      return Math.ceil(
        Math.min(safeRenderWidth, safeRenderHeight) * safePixelRatio
      );
    }

    const fitScale = Math.min(
      safeRenderWidth / sourceWidth,
      safeRenderHeight / sourceHeight
    );
    const renderedShortEdge = Math.min(
      sourceWidth * fitScale,
      sourceHeight * fitScale
    );

    // The renderer never upscales beyond the original dimensions.
    return Math.ceil(Math.min(
      renderedShortEdge * safePixelRatio,
      Math.min(sourceWidth, sourceHeight)
    ));
  }

  getMediaSize(
    renderWidth: number,
    renderHeight: number,
    pixelRatio = MediaIcon.getDevicePixelRatio()
  ): number {
    const requiredSize = this.getRequiredMediaSize(
      renderWidth,
      renderHeight,
      pixelRatio
    );
    for (const size of MediaIcon.sortedThumbnailSizes) {
      if (size >= requiredSize) {
        return size;
      }
    }
    return MediaIcon.sortedThumbnailSizes[
      MediaIcon.sortedThumbnailSizes.length - 1
    ];
  }

  /**
   * @param renderWidth bonding box width
   * @param renderHeight bounding box height
   */
  getBestSizedMediaPath(
    renderWidth: number,
    renderHeight: number,
    pixelRatio = MediaIcon.getDevicePixelRatio()
  ): string {
    const size = this.getMediaSize(renderWidth, renderHeight, pixelRatio);
    return this.getSizedMediaPath(size);
  }

  private static getDevicePixelRatio(): number {
    return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  }

  /**
   * Uses the converted video if the original is not available
   */
  getBestFitVideoPath(): string {
    return Utils.concatUrls(this.getOriginalMediaPath(), '/bestFit');
  }

  equals(other: MediaDTO | MediaIcon): boolean {
    // is gridphoto
    if (other instanceof MediaIcon) {
      return ContentWrapperUtils.equalsMedia(this.media, other.media);
    }

    // is media
    if (other.directory) {
      return ContentWrapperUtils.equalsMedia(this.media, other);
    }

    return false;
  }
}
