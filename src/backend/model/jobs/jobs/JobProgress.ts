import {JobProgressDTO, JobProgressLogDTO, JobProgressStates,} from '../../../../common/entities/job/JobProgressDTO';
import {Config} from '../../../../common/config/private/Config';
import {Logger} from '../../../Logger';

export class JobProgress {
  private steps = {
    all: 0,
    processed: 0,
    skipped: 0,
  };
  private details: {label: string; all: number; processed: number; skipped: number} = null;
  private state = JobProgressStates.running;
  private time = {
    start: Date.now() as number,
    end: null as number,
  };
  private logCounter = 0;
  private logs: { id: number; timestamp: string; comment: string }[] = [];

  constructor(
      public readonly jobName: string,
      public readonly HashName: string,
      public readonly LOG_TAG: string
  ) {
  }

  set OnChange(val: (progress: JobProgress) => void) {
    this.onChange = val;
  }

  get Skipped(): number {
    return this.steps.skipped;
  }

  set Skipped(value: number) {
    this.steps.skipped = value;
    this.time.end = Date.now();
    this.onChange(this);
  }

  get Processed(): number {
    return this.steps.processed;
  }

  set Processed(value: number) {
    this.steps.processed = value;
    this.time.end = Date.now();
    this.onChange(this);
  }

  get Left(): number {
    return this.steps.all - this.steps.processed - this.steps.skipped;
  }

  set Left(value: number) {
    this.steps.all = value + this.steps.skipped + this.steps.processed;
    this.time.end = Date.now();
    this.onChange(this);
  }

  get All(): number {
    return this.steps.all;
  }

  set All(value: number) {
    this.steps.all = value;
    this.time.end = Date.now();
    this.onChange(this);
  }

  setDetails(label: string, all = 0, processed = 0, skipped = 0): void {
    this.details = {label, all, processed, skipped};
    this.time.end = Date.now();
    this.onChange(this);
  }

  set DetailAll(value: number) {
    if (!this.details) {
      return;
    }
    this.details.all = value;
    this.time.end = Date.now();
    this.onChange(this);
  }

  get DetailProcessed(): number {
    return this.details?.processed || 0;
  }

  set DetailProcessed(value: number) {
    if (!this.details) {
      return;
    }
    this.details.processed = value;
    this.time.end = Date.now();
    this.onChange(this);
  }

  get DetailSkipped(): number {
    return this.details?.skipped || 0;
  }

  set DetailSkipped(value: number) {
    if (!this.details) {
      return;
    }
    this.details.skipped = value;
    this.time.end = Date.now();
    this.onChange(this);
  }

  get State(): JobProgressStates {
    return this.state;
  }

  set State(value: JobProgressStates) {
    this.state = value;
    this.time.end = Date.now();
    this.onChange(this);
  }

  get Logs(): JobProgressLogDTO[] {
    return this.logs;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onChange = (_: JobProgress): void => {
    // abstract function
  };

  log(log: string): void {
    while (this.logs.length > Config.Jobs.maxSavedProgress) {
      this.logs.shift();
    }
    this.logs.push({
      id: this.logCounter++,
      timestamp: new Date().toISOString(),
      comment: log,
    });
    Logger.silly(this.LOG_TAG, log);
    this.onChange(this);
  }

  toDTO(): JobProgressDTO {
    return {
      jobName: this.jobName,
      HashName: this.HashName,
      state: this.state,
      time: {
        start: this.time.start,
        end: this.time.end,
      },
      logs: this.logs,
      steps: this.steps,
      ...(this.details && {details: this.details}),
    };
  }
}
