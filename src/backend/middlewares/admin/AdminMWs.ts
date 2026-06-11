import {NextFunction, Request, Response} from 'express';
import {ErrorCodes, ErrorDTO} from '../../../common/entities/Error';
import {ObjectManagers} from '../../model/ObjectManagers';
import {StatisticDTO} from '../../../common/entities/settings/StatisticDTO';
import {MessengerRepository} from '../../model/messenger/MessengerRepository';
import {JobStartDTO} from '../../../common/entities/job/JobDTO';
import {ActivityAuditMWs} from '../ActivityAuditMWs';

export class AdminMWs {
  private static cleanQueryString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed.slice(0, 256) : undefined;
  }

  private static parseQueryTime(value: unknown, endOfDay = false): number | undefined {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return undefined;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      date.setHours(23, 59, 59, 999);
    }
    return date.getTime();
  }

  public static async getActivityAuditLog(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 100, 1), 1000);
      const status = parseInt(req.query.status as string, 10);
      req.resultPipe = await ActivityAuditMWs.readRecent({
        limit,
        user: AdminMWs.cleanQueryString(req.query.user),
        action: AdminMWs.cleanQueryString(req.query.action),
        ip: AdminMWs.cleanQueryString(req.query.ip),
        text: AdminMWs.cleanQueryString(req.query.text),
        status: Number.isFinite(status) ? status : undefined,
        from: AdminMWs.parseQueryTime(req.query.from),
        to: AdminMWs.parseQueryTime(req.query.to, true),
      });
      return next();
    } catch (err) {
      if (err instanceof Error) {
        return next(
          new ErrorDTO(
            ErrorCodes.GENERAL_ERROR,
            'Error while getting activity audit log: ' + err.toString(),
            err
          )
        );
      }
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error while getting activity audit log',
          err
        )
      );
    }
  }

  public static async loadStatistic(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    const galleryManager = ObjectManagers.getInstance()
      .GalleryManager;
    const personManager = ObjectManagers.getInstance()
      .PersonManager;
    try {
      req.resultPipe = {
        directories: await galleryManager.countDirectories(),
        photos: await galleryManager.countPhotos(),
        videos: await galleryManager.countVideos(),
        diskUsage: await galleryManager.countMediaSize(),
        persons: await personManager.countFaces(),
      } as StatisticDTO;
      return next();
    } catch (err) {
      if (err instanceof Error) {
        return next(
          new ErrorDTO(
            ErrorCodes.GENERAL_ERROR,
            'Error while getting statistic: ' + err.toString(),
            err
          )
        );
      }
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error while getting statistic',
          err
        )
      );
    }
  }

  public static async getDuplicates(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {

    try {
      req.resultPipe = await ObjectManagers.getInstance()
        .GalleryManager.getPossibleDuplicates();
      return next();
    } catch (err) {
      if (err instanceof Error) {
        return next(
          new ErrorDTO(
            ErrorCodes.GENERAL_ERROR,
            'Error while getting duplicates: ' + err.toString(),
            err
          )
        );
      }
      return next(
        new ErrorDTO(
          ErrorCodes.GENERAL_ERROR,
          'Error while getting duplicates',
          err
        )
      );
    }
  }

  public static async startJob(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const id = req.params['id'];
      const jobStart: JobStartDTO = req.body;
      const JobConfig: Record<string, unknown> = jobStart.config;
      const soloRun: boolean = jobStart.soloRun;
      const allowParallelRun: boolean = jobStart.allowParallelRun;
      await ObjectManagers.getInstance().JobManager.run(
        id,
        JobConfig,
        soloRun,
        allowParallelRun
      );
      req.resultPipe = 'ok';
      return next();
    } catch (err) {
      if (err instanceof Error) {
        return next(
          new ErrorDTO(
            ErrorCodes.JOB_ERROR,
            'Job error: ' + err.toString(),
            err
          )
        );
      }
      return next(
        new ErrorDTO(
          ErrorCodes.JOB_ERROR,
          'Job error: ' + JSON.stringify(err, null, '  '),
          err
        )
      );
    }
  }

  public static stopJob(req: Request, res: Response, next: NextFunction): void {
    try {
      const id = req.params['id'];
      ObjectManagers.getInstance().JobManager.stop(id);
      req.resultPipe = 'ok';
      return next();
    } catch (err) {
      if (err instanceof Error) {
        return next(
          new ErrorDTO(
            ErrorCodes.JOB_ERROR,
            'Job error: ' + err.toString(),
            err
          )
        );
      }
      return next(
        new ErrorDTO(
          ErrorCodes.JOB_ERROR,
          'Job error: ' + JSON.stringify(err, null, '  '),
          err
        )
      );
    }
  }


  public static getAvailableMessengers(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    try {
      req.resultPipe = MessengerRepository.Instance.getAll().map(msgr => msgr.Name);
      return next();
    } catch (err) {
      if (err instanceof Error) {
        return next(
          new ErrorDTO(
            ErrorCodes.JOB_ERROR,
            'Messenger error: ' + err.toString(),
            err
          )
        );
      }
      return next(
        new ErrorDTO(
          ErrorCodes.JOB_ERROR,
          'Messenger error: ' + JSON.stringify(err, null, '  '),
          err
        )
      );
    }
  }

  public static getAvailableJobs(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    try {
      req.resultPipe =
        ObjectManagers.getInstance().JobManager.getAvailableJobs();
      return next();
    } catch (err) {
      if (err instanceof Error) {
        return next(
          new ErrorDTO(
            ErrorCodes.JOB_ERROR,
            'Job error: ' + err.toString(),
            err
          )
        );
      }
      return next(
        new ErrorDTO(
          ErrorCodes.JOB_ERROR,
          'Job error: ' + JSON.stringify(err, null, '  '),
          err
        )
      );
    }
  }

  public static getJobProgresses(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    try {
      req.resultPipe = ObjectManagers.getInstance().JobManager.getProgresses();
      return next();
    } catch (err) {
      if (err instanceof Error) {
        return next(
          new ErrorDTO(
            ErrorCodes.JOB_ERROR,
            'Job error: ' + err.toString(),
            err
          )
        );
      }
      return next(
        new ErrorDTO(
          ErrorCodes.JOB_ERROR,
          'Job error: ' + JSON.stringify(err, null, '  '),
          err
        )
      );
    }
  }
}
