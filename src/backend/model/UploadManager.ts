import {ProjectPath} from '../ProjectPath';
import * as path from 'path';
import * as fs from 'fs';
import {SupportedFormats} from '../../common/SupportedFormats';
import {FileAlreadyExists} from '../exceptions/FileAlreadyExists';
import {ObjectManagers} from './ObjectManagers';
import {DiskManager} from './fileaccess/DiskManager';
import {Config} from '../../common/config/private/Config';
import {PG2ConfMap} from '../../common/PG2ConfMap';

export interface UploadError {
  filename: string;
  error: string;
}

export class UploadManager {
  private static safeJoin(basePath: string, ...segments: string[]): string {
    const target = path.resolve(basePath, ...segments);
    const base = path.resolve(basePath);
    if (target !== base && !target.startsWith(base + path.sep)) {
      throw new Error('Invalid upload path');
    }
    return target;
  }

  private static safeOriginalName(originalName: string): string {
    const name = path.basename(originalName || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      throw new Error('Invalid file name');
    }
    return name;
  }

  public async saveFiles(directory: string, files: Express.Multer.File[]): Promise<UploadError[]> {
    if (Config.Upload.enabled === false) {
      throw new Error('Upload is disabled');
    }
    const relativeDir = directory || '';
    const fullDirPath = UploadManager.safeJoin(ProjectPath.ImageFolder, relativeDir);

    if (Config.Upload.enforcedDirectoryConfig === true) {
      const hasUploadConf = Object.keys(PG2ConfMap.upload).some(filename => {
        const pg2confPath = path.join(fullDirPath, filename);
        return fs.existsSync(pg2confPath);
      });
      if (!hasUploadConf) {
        throw new Error('Upload is not enabled in this directory');
      }
    }

    const errors: UploadError[] = [];
    for (const file of files) {
      try {
        await this.saveFile(directory, file);
      } catch (e) {
        errors.push({filename: file.originalname, error: e.message});
      }
    }
    const dto = DiskManager.getDTOFromPath(directory || '');
    await ObjectManagers.getInstance().onDataChange(dto);

    return errors;
  }

  public async saveFile(directory: string, file: Express.Multer.File): Promise<void> {
    const relativeDir = directory || '';
    const fullDirPath = UploadManager.safeJoin(ProjectPath.ImageFolder, relativeDir);
    const safeName = UploadManager.safeOriginalName(file.originalname);

    const extension = path.extname(safeName).toLowerCase().substring(1);
    if (!this.isSupportedExtension(extension)) {
      throw new Error('Unsupported file format: ' + extension);
    }

    const fullFilePath = UploadManager.safeJoin(fullDirPath, safeName);

    if (fs.existsSync(fullFilePath)) {
      throw new FileAlreadyExists('File already exists: ' + fullFilePath, file.originalname);
    }

    if (!fs.existsSync(fullDirPath)) {
      await fs.promises.mkdir(fullDirPath, {recursive: true});
    }

    await fs.promises.writeFile(fullFilePath, file.buffer);
  }

  private isSupportedExtension(ext: string): boolean {
    return SupportedFormats.Photos.includes(ext) ||
      SupportedFormats.Videos.includes(ext) ||
      SupportedFormats.MetaFiles.includes(ext);
  }
}
