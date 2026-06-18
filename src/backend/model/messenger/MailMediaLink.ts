import * as crypto from 'crypto';
import * as path from 'path';
import {Config} from '../../../common/config/private/Config';
import {Utils} from '../../../common/Utils';
import {MediaDTO} from '../../../common/entities/MediaDTO';
import {ProjectPath} from '../../ProjectPath';

export class MailMediaLink {
  public static readonly DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 30;

  public static relativeMediaPath(m: MediaDTO): string {
    return Utils.canonizePath(
      Utils.concatUrls(m.directory.path, m.directory.name, m.name)
    ).replace(/^\/+/, '');
  }

  public static sign(relativeMediaPath: string, size: number, expires: number): string {
    const secret = this.secret();
    return crypto
      .createHmac('sha256', secret)
      .update(`${relativeMediaPath}\n${size}\n${expires}`)
      .digest('hex');
  }

  public static verify(relativeMediaPath: string, size: number, expires: number, signature: string): boolean {
    if (!signature || !Number.isFinite(expires) || expires < Date.now()) {
      return false;
    }
    const expected = this.sign(relativeMediaPath, size, expires);
    try {
      return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
    } catch (e) {
      return false;
    }
  }

  public static signedThumbnailPath(relativeMediaPath: string, size: number, expires: number): string {
    const signature = this.sign(relativeMediaPath, size, expires);
    return Utils.concatUrls(
      Config.Server.apiPath,
      '/gallery/mail-thumbnail/',
      size.toString(),
      expires.toString(),
      signature,
      this.encodePath(relativeMediaPath)
    );
  }

  public static signedMediaPath(relativeMediaPath: string, expires: number): string {
    const signature = this.sign(relativeMediaPath, 0, expires);
    return Utils.concatUrls(
      Config.Server.apiPath,
      '/gallery/mail-media/',
      expires.toString(),
      signature,
      this.encodePath(relativeMediaPath)
    );
  }

  public static signedViewerPath(relativeMediaPath: string, expires: number): string {
    const signature = this.sign(relativeMediaPath, 0, expires);
    return Utils.concatUrls(
      Config.Server.apiPath,
      '/gallery/mail-view/',
      expires.toString(),
      signature,
      this.encodePath(relativeMediaPath)
    );
  }

  public static encodePath(relativeMediaPath: string): string {
    return relativeMediaPath
      .split('/')
      .filter(p => p.length > 0)
      .map(p => encodeURIComponent(p).replace(/[!'()*]/g, c =>
        '%' + c.charCodeAt(0).toString(16).toUpperCase()
      ))
      .join('/');
  }

  public static safeAbsoluteMediaPath(relativeMediaPath: string): string | null {
    const root = path.resolve(ProjectPath.ImageFolder);
    const candidate = path.resolve(root, relativeMediaPath);
    if (candidate !== root && candidate.startsWith(root + path.sep)) {
      return candidate;
    }
    return null;
  }

  private static secret(): string {
    return (Config.Server.sessionSecret && Config.Server.sessionSecret[0]) || Config.Server.publicUrl || 'pigallery2plus';
  }
}
