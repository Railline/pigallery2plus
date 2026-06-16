import {MediaDTO, MediaDTOUtils} from '../../../common/entities/MediaDTO';
import {PhotoProcessing} from '../fileaccess/fileprocessing/PhotoProcessing';
import {ProjectPath} from '../../ProjectPath';
import {Config} from '../../../common/config/private/Config';
import {ThumbnailSourceType} from '../fileaccess/PhotoWorker';
import * as path from 'path';
import {Utils} from '../../../common/Utils';
import {DynamicConfig} from '../../../common/entities/DynamicConfig';

export interface MediaDTOWithThPath extends MediaDTO {
  thumbnailPath: string;
  thumbnailUrl: string;
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

  private getGalleryMediaUrl(m: MediaDTO): string {
    const galleryPath = encodeURI(
      Utils.concatUrls('/gallery/', m.directory.path, m.directory.name)
    )
      .replace(new RegExp('#', 'g'), '%23')
      .replace(new RegExp('\\$', 'g'), '%24')
      .replace(new RegExp('\\?', 'g'), '%3F');

    return Utils.concatUrls(
      Config.Server.publicUrl,
      galleryPath
    ) + '?p=' + encodeURIComponent(m.name);
  }


  public async send(config: C, input: string | MediaDTO[] | unknown) {
    if (Array.isArray(input) && input.length > 0
      && (input as MediaDTO[])[0]?.name
      && (input as MediaDTO[])[0]?.directory
      && (input as MediaDTO[])[0]?.metadata?.creationDate) {
      const media = input as MediaDTOWithThPath[];
      for (let i = 0; i < media.length; ++i) {
        media[i].thumbnailPath = await this.getThumbnail(media[i]);
        media[i].thumbnailUrl = this.getGalleryMediaUrl(media[i]);
      }
      return await this.sendMedia(config, media);
    }
    // TODO: implement other branches
    throw new Error('Not yet implemented');
  }

  protected abstract sendMedia(config: C, media: MediaDTOWithThPath[]): Promise<void> ;
}
