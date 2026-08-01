import {NextFunction, Request, Response} from 'express';
import {ObjectManagers} from '../model/ObjectManagers';
import {ErrorCodes, ErrorDTO} from '../../common/entities/Error';
import multer = require('multer');
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {ProjectPath} from '../ProjectPath';

const storage = multer.diskStorage({
  destination: (_req, _file, callback): void => {
    const uploadDirectory = path.join(ProjectPath.TempFolder, 'uploads');
    fs.mkdir(uploadDirectory, {recursive: true}, (err): void => {
      callback(err, uploadDirectory);
    });
  },
  filename: (_req, _file, callback): void => {
    callback(null, crypto.randomUUID());
  },
});
const upload = multer({
  storage,
  limits: {
    fileSize: 250 * 1024 * 1024,
    files: 10,
    fields: 10,
    parts: 20,
  },
}).array('files');

export class UploadMWs {
  public static async upload(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    upload(req, res, async (err: any) => {
      const files = (req.files || []) as Express.Multer.File[];
      if (err) {
        await UploadMWs.cleanUpStagedFiles(files);
        return next(new ErrorDTO(ErrorCodes.UPLOAD_ERROR, err.message));
      }

      if (!files || files.length === 0) {
        return next(new ErrorDTO(ErrorCodes.UPLOAD_ERROR, 'No files uploaded'));
      }

      try {
        const directory = req.params['directory'] || '';
        req.resultPipe = await ObjectManagers.getInstance().UploadManager.saveFiles(directory, files);
        return next();
      } catch (e) {
        return next(new ErrorDTO(ErrorCodes.UPLOAD_ERROR, e.message || e));
      } finally {
        await UploadMWs.cleanUpStagedFiles(files);
      }
    });
  }

  private static async cleanUpStagedFiles(files: Express.Multer.File[]): Promise<void> {
    await Promise.allSettled(
      files
        .map(file => file.path)
        .filter(Boolean)
        .map(filePath => fs.promises.unlink(filePath))
    );
  }

}
