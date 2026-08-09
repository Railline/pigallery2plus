import {promises as fsp} from 'fs';
import * as path from 'path';
import {ProjectPath} from '../../ProjectPath';
import {Config} from '../../../common/config/private/Config';
import {JobProgressDTO, JobProgressStates,} from '../../../common/entities/job/JobProgressDTO';

export class JobProgressManager {
  private static readonly VERSION = 3;
  private db: JobProgressDB = JobProgressManager.createEmptyDB();
  private readonly dbPath: string;
  private timer: NodeJS.Timeout = null;
  private saveInFlight: Promise<void> = null;
  private saveRequested = false;

  constructor() {
    this.dbPath = path.join(ProjectPath.DBFolder, 'jobs.db');
    this.loadDB().catch(console.error);
  }

  private static createEmptyDB(): JobProgressDB {
    return {
      version: JobProgressManager.VERSION,
      progresses: {},
    };
  }

  get Progresses(): { [key: string]: JobProgressDTO } {
    const m: { [key: string]: JobProgressDTO } = {};
    for (const key of Object.keys(this.db.progresses)) {
      m[key] = this.db.progresses[key].progress;
      if (
          this.db.progresses[key].progress.state === JobProgressStates.running
      ) {
        m[key].time.end = Date.now();
      }
    }
    return m;
  }

  onJobProgressUpdate(progress: JobProgressDTO): void {
    this.db.progresses[progress.HashName] = {progress, timestamp: Date.now()};
    this.delayedSave();
  }

  public async cleanUp(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.saveRequested = true;
    }

    if (this.saveRequested) {
      this.queueSave();
    }

    while (this.saveInFlight) {
      await this.saveInFlight;
    }
  }

  private async loadDB(): Promise<void> {
    try {
      await fsp.access(this.dbPath);
    } catch (e) {
      return;
    }

    const data = (await fsp.readFile(this.dbPath, 'utf8')).trim();
    if (data.length === 0) {
      this.db = JobProgressManager.createEmptyDB();
      await this.saveDB();
      return;
    }

    let db: JobProgressDB;
    try {
      db = JSON.parse(data) as JobProgressDB;
    } catch (e) {
      const backupPath = `${this.dbPath}.invalid-${Date.now()}`;
      await fsp.rename(this.dbPath, backupPath).catch(console.error);
      this.db = JobProgressManager.createEmptyDB();
      await this.saveDB();
      console.warn(`Invalid jobs progress database moved to ${backupPath}`);
      return;
    }

    if (
      db.version !== JobProgressManager.VERSION ||
      typeof db.progresses !== 'object' ||
      db.progresses === null
    ) {
      return;
    }
    this.db = db;

    while (
        Object.keys(this.db.progresses).length >
        Config.Jobs.maxSavedProgress
        ) {
      let min: string = null;
      for (const key of Object.keys(this.db.progresses)) {
        if (
            min === null ||
            this.db.progresses[min].timestamp > this.db.progresses[key].timestamp
        ) {
          min = key;
        }
      }
      delete this.db.progresses[min];
    }

    for (const key of Object.keys(this.db.progresses)) {
      if (
          this.db.progresses[key].progress.state === JobProgressStates.running ||
          this.db.progresses[key].progress.state === JobProgressStates.cancelling
      ) {
        this.db.progresses[key].progress.state = JobProgressStates.interrupted;
      }
    }
  }

  private async saveDB(): Promise<void> {
    const data = JSON.stringify(this.db);
    const temporaryPath = this.dbPath + '.tmp';
    await fsp.writeFile(temporaryPath, data);
    await fsp.rename(temporaryPath, this.dbPath);
  }

  private delayedSave(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setTimeout((): void => {
      this.timer = null;
      this.queueSave();
    }, 1000);
  }

  private queueSave(): void {
    this.saveRequested = true;
    if (this.saveInFlight) {
      return;
    }

    this.saveInFlight = this.flushSaves()
      .catch(console.error)
      .finally((): void => {
        this.saveInFlight = null;
        if (this.saveRequested) {
          this.queueSave();
        }
      });
  }

  private async flushSaves(): Promise<void> {
    while (this.saveRequested) {
      this.saveRequested = false;
      await this.saveDB();
    }
  }
}

type JobProgressDB = {
  version: number;
  progresses: {
    [key: string]: { progress: JobProgressDTO; timestamp: number };
  };
};
