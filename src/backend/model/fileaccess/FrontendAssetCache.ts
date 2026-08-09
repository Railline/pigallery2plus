import * as fs from 'fs';
import * as path from 'path';
import {createHash} from 'crypto';
import {Request, Response} from 'express';
import {Logger} from '../../Logger';

const LOG_TAG = '[FrontendAssetCache]';
const HASHED_ASSET = /\.([a-f0-9]{16,64})\.([a-z0-9]+)$/i;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

interface CachedAsset {
  body: Buffer;
  etag: string;
}

export interface FrontendAssetCacheStats {
  files: number;
  uniqueAssets: number;
  uniqueBytes: number;
}

export interface FrontendAssetLocation {
  root: string;
  relativePath: string;
}

/**
 * Keeps immutable Angular build artifacts outside libuv's shared filesystem
 * queue. Media mounted from a slow NAS can otherwise delay a tiny JS or CSS
 * file for several seconds when many photos are being streamed at once.
 */
export class FrontendAssetCache {
  private readonly assets = new Map<string, CachedAsset>();
  private readonly sharedBodies = new Map<string, CachedAsset>();
  private frontendRoot = '';
  private frontendRealRoot = '';

  public preload(frontendRoot: string, locales: string[] = ['en']): FrontendAssetCacheStats {
    this.assets.clear();
    this.sharedBodies.clear();
    this.frontendRoot = path.resolve(frontendRoot);
    this.frontendRealRoot = '';

    if (!fs.existsSync(this.frontendRoot)) {
      return {files: 0, uniqueAssets: 0, uniqueBytes: 0};
    }
    try {
      this.frontendRealRoot = fs.realpathSync(this.frontendRoot);
    } catch (error) {
      Logger.warn(LOG_TAG, `Could not resolve frontend root ${this.frontendRoot}: ${String(error)}`);
      return {files: 0, uniqueAssets: 0, uniqueBytes: 0};
    }

    // Preload the default locale only. Other immutable locale bundles are read
    // synchronously and cached on first access, avoiding a ~30 MB baseline cost.
    const directories = locales
      .map((locale): string => path.resolve(this.frontendRoot, locale))
      .filter((directory): boolean => FrontendAssetCache.isInside(this.frontendRoot, directory) && fs.existsSync(directory));
    while (directories.length > 0) {
      const directory = directories.pop();
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(directory, {withFileTypes: true});
      } catch (error) {
        Logger.warn(LOG_TAG, `Could not preload ${directory}: ${String(error)}`);
        continue;
      }

      for (const entry of entries) {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          directories.push(filePath);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        if (!FrontendAssetCache.isImmutable(entry.name)) {
          continue;
        }

        try {
          this.load(filePath);
        } catch (error) {
          Logger.warn(LOG_TAG, `Could not preload ${filePath}: ${String(error)}`);
        }
      }
    }

    const uniqueBytes = Array.from(this.sharedBodies.values())
      .reduce((sum, asset): number => sum + asset.body.length, 0);
    const stats = {
      files: this.assets.size,
      uniqueAssets: this.sharedBodies.size,
      uniqueBytes,
    };
    Logger.info(
      LOG_TAG,
      `Preloaded ${stats.files} immutable frontend files ` +
      `(${stats.uniqueAssets} unique, ${stats.uniqueBytes} bytes)`
    );
    return stats;
  }

  public send(req: Request, res: Response, filePath: string): boolean {
    const resolvedPath = path.resolve(filePath);
    let asset = this.assets.get(resolvedPath);
    if (!asset &&
      FrontendAssetCache.isImmutable(resolvedPath) &&
      FrontendAssetCache.isInside(this.frontendRoot, resolvedPath)) {
      try {
        asset = this.load(resolvedPath);
      } catch {
        return false;
      }
    }
    if (!asset) {
      return false;
    }

    res.type(path.extname(filePath));
    res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
    res.setHeader('ETag', asset.etag);
    res.setHeader('Content-Length', asset.body.length.toString());

    if (req.fresh) {
      res.status(304).end();
      return true;
    }
    if (req.method === 'HEAD') {
      res.status(200).end();
      return true;
    }
    res.status(200).end(asset.body);
    return true;
  }

  public static isImmutable(filePath: string): boolean {
    return FrontendAssetCache.getFingerprint(path.basename(filePath)) !== null;
  }

  /**
   * Resolves an uncached asset for Express while keeping its trusted root
   * separate from the request-derived relative path.
   */
  public resolveForFallback(filePath: string): FrontendAssetLocation | null {
    const resolvedPath = path.resolve(filePath);
    if (!FrontendAssetCache.isInside(this.frontendRoot, resolvedPath)) {
      return null;
    }
    try {
      const realPath = fs.realpathSync(resolvedPath);
      if (
        !this.frontendRealRoot ||
        !realPath.startsWith(this.frontendRealRoot + path.sep)
      ) {
        return null;
      }
      return {
        root: this.frontendRealRoot,
        relativePath: path.relative(this.frontendRealRoot, realPath),
      };
    } catch (error) {
      return null;
    }
  }

  private static getFingerprint(fileName: string): {hash: string; extension: string} | null {
    const match = HASHED_ASSET.exec(fileName);
    if (!match) {
      return null;
    }
    return {
      hash: match[1].toLowerCase(),
      extension: match[2].toLowerCase(),
    };
  }

  private load(filePath: string): CachedAsset {
    const resolvedPath = path.resolve(filePath);
    const existing = this.assets.get(resolvedPath);
    if (existing) {
      return existing;
    }

    const realPath = fs.realpathSync(resolvedPath);
    if (
      !this.frontendRealRoot ||
      !realPath.startsWith(this.frontendRealRoot + path.sep)
    ) {
      throw new Error('Frontend asset is outside the configured frontend folder');
    }
    const body = fs.readFileSync(realPath);
    const contentHash = createHash('sha256').update(body).digest('hex');
    const extension = path.extname(resolvedPath).toLowerCase();
    const sharedKey = `${contentHash}${extension}`;
    let asset = this.sharedBodies.get(sharedKey);
    if (!asset) {
      asset = {
        body,
        etag: `"${contentHash.slice(0, 32)}-${body.length.toString(16)}"`,
      };
      this.sharedBodies.set(sharedKey, asset);
    }
    this.assets.set(resolvedPath, asset);
    return asset;
  }

  private static isInside(root: string, candidate: string): boolean {
    if (!root) {
      return false;
    }
    const relative = path.relative(root, candidate);
    return relative !== '..' &&
      !relative.startsWith('..' + path.sep) &&
      !path.isAbsolute(relative);
  }
}
