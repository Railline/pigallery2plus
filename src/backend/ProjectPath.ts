import * as path from 'path';
import * as fs from 'fs';
import {PrivateConfigClass} from '../common/config/private/PrivateConfigClass';

export class ProjectPathClass {
  public Root: string;
  public ImageFolder: string;
  public TempFolder: string;
  public TranscodedFolder: string;
  public FacesFolder: string;
  public FrontendFolder: string;
  public ExtensionFolder: string;
  public DBFolder: string;
  private cfg: PrivateConfigClass;

  init(cfg: PrivateConfigClass) {
    this.cfg = cfg;
    this.reset();
  }

  public normalizeRelative(pathStr: string): string {
    return path.join(pathStr, path.sep);
  }

  public getAbsolutePath(pathStr: string): string {
    return path.isAbsolute(pathStr) ? pathStr : path.join(this.Root, pathStr);
  }

  public getRelativePathToImages(pathStr: string): string {
    return path.relative(this.ImageFolder, pathStr);
  }

  public resolveInside(rootPath: string, relativePath: string): string | null {
    const root = path.resolve(rootPath);
    if (!relativePath || relativePath === path.sep || relativePath === '/') {
      return root;
    }
    if (path.isAbsolute(relativePath)) {
      return null;
    }
    const candidate = path.resolve(root, relativePath || '');

    if (candidate === root || candidate.startsWith(root + path.sep)) {
      return candidate;
    }

    return null;
  }

  public resolveMediaPath(relativePath: string): string | null {
    return this.resolveInside(this.ImageFolder, relativePath);
  }

  public resolveTranscodedPath(relativePath: string): string | null {
    return this.resolveInside(this.TranscodedFolder, relativePath);
  }

  reset(): void {
    this.Root = path.join(__dirname, '/../../');
    this.FrontendFolder = path.join(this.Root, 'dist');
    this.ImageFolder = this.getAbsolutePath(this.cfg.Media.folder);
    this.TempFolder = this.getAbsolutePath(this.cfg.Media.tempFolder);
    this.TranscodedFolder = path.join(this.TempFolder, 'tc');
    this.FacesFolder = path.join(this.TempFolder, 'f');
    this.DBFolder = this.getAbsolutePath(this.cfg.Database.dbFolder);
    this.ExtensionFolder = this.getAbsolutePath(this.cfg.Extensions.folder);

    // create the thumbnail folder if it does not exist
    if (!fs.existsSync(this.TempFolder)) {
      fs.mkdirSync(this.TempFolder);
    }
  }
}

export const ProjectPath = new ProjectPathClass();
