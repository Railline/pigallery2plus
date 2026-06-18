import {MediaDTO, MediaDTOUtils} from '../../../common/entities/MediaDTO';
import {PhotoProcessing} from '../fileaccess/fileprocessing/PhotoProcessing';
import {ProjectPath} from '../../ProjectPath';
import {Config} from '../../../common/config/private/Config';
import {ThumbnailSourceType} from '../fileaccess/PhotoWorker';
import * as path from 'path';
import {Utils} from '../../../common/Utils';
import {DynamicConfig} from '../../../common/entities/DynamicConfig';
import {MailMediaLink} from './MailMediaLink';

export interface MediaDTOWithThPath extends MediaDTO {
  thumbnailPath: string | null;
  thumbnailUrl: string;
  mailThumbnailUrl: string;
}

export abstract class Messenger<C extends Record<string, unknown> = Record<string, unknown>> {

  public abstract get Name(): string;
  protected config: C;
  public readonly ConfigTemplate: DynamicConfig[]  = [];

  private async getThumbnail(m: MediaDTO) {
    return await PhotoProcessing.generateThumbnail(
      path.join(ProjectPath.ImageFolder, m.directory.path, m.directory.name, m.name),
      Config.Media.Photo.thumbnailSizes[0],
      MediaDTOUtils.isPhoto(m) ? ThumbnailSourceType.Photo : ThumbnailSourceType.Video,
      false
    );
  }

  private encodeUrlComponent(value: string): string {
    return encodeURIComponent(value).replace(/[!'()*]/g, c =>
      '%' + c.charCodeAt(0).toString(16).toUpperCase()
    );
  }

  private getGalleryMediaUrl(m: MediaDTO): string {
    const relativeDirectory = Utils.canonizePath(Utils.concatUrls(m.directory.path, m.directory.name));
    const encodedDirectory = relativeDirectory
      .split('/')
      .filter(p => p.length > 0)
      .map(p => this.encodeUrlComponent(p))
      .join('/');
    const galleryPath = Utils.concatUrls('/gallery/', encodedDirectory);

    return Utils.concatUrls(
      Config.Server.publicUrl,
      galleryPath
    ) + '?p=' + this.encodeUrlComponent(m.name);
  }

  private getMailThumbnailUrl(m: MediaDTO): string {
    const expires = Date.now() + MailMediaLink.DEFAULT_TTL_MS;
    const size = Config.Media.Photo.thumbnailSizes[0];
    return Utils.concatUrls(
      Config.Server.publicUrl,
      MailMediaLink.signedThumbnailPath(MailMediaLink.relativeMediaPath(m), size, expires)
    );
  }


  public async send(config: C, input: string | MediaDTO[] | unknown) {
    if (Array.isArray(input) && input.length > 0
      && (input as MediaDTO[])[0]?.name
      && (input as MediaDTO[])[0]?.directory
      && (input as MediaDTO[])[0]?.metadata?.creationDate) {
      const media = input as MediaDTOWithThPath[];
      for (let i = 0; i < media.length; ++i) {
        try {
          media[i].thumbnailPath = await this.getThumbnail(media[i]);
        } catch (e) {
          media[i].thumbnailPath = null;
        }
        media[i].thumbnailUrl = this.getGalleryMediaUrl(media[i]);
        media[i].mailThumbnailUrl = this.getMailThumbnailUrl(media[i]);
      }
      return await this.sendMedia(config, media);
    }
    // TODO: implement other branches
    throw new Error('Not yet implemented');
  }

  protected abstract sendMedia(config: C, media: MediaDTOWithThPath[]): Promise<void> ;
}
