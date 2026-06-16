import {EventEmitter, Injectable} from '@angular/core';
import {BehaviorSubject} from 'rxjs';
import {JobProgressDTO, JobProgressStates, OnTimerJobProgressDTO,} from '../../../../common/entities/job/JobProgressDTO';
import {NetworkService} from '../../model/network/network.service';
import {JobScheduleDTO} from '../../../../common/entities/job/JobScheduleDTO';
import {JobDTO, JobDTOUtils, JobStartDTO} from '../../../../common/entities/job/JobDTO';
import {BackendtextService} from '../../model/backendtext.service';
import {NotificationService} from '../../model/notification.service';
import {DynamicConfig} from '../../../../common/entities/DynamicConfig';

@Injectable()
export class ScheduledJobsService {
  public progress: BehaviorSubject<Record<string, OnTimerJobProgressDTO>>;
  public onJobFinish: EventEmitter<string> = new EventEmitter<string>();
  timer: number = null;
  public availableJobs: BehaviorSubject<JobDTO[]>;
  public availableMessengers: BehaviorSubject<string[]>;
  public jobStartingStopping: { [key: string]: boolean } = {};
  private subscribers = 0;
  private progressEvents: EventSource = null;
  private fallbackPolling = false;

  constructor(
    private networkService: NetworkService,
    private notification: NotificationService,
    private backendTextService: BackendtextService
  ) {
    this.progress = new BehaviorSubject({});
    this.availableJobs = new BehaviorSubject([]);
    this.availableMessengers = new BehaviorSubject([]);
  }

  public  isValidJob(name: string): boolean {
    return !!this.availableJobs.value.find(j => j.Name === name);
  }

  public async getAvailableJobs(): Promise<void> {
    this.availableJobs.next(
      await this.networkService.getJson<JobDTO[]>('/admin/jobs/available')
    );
  }

  public async getAvailableMessengers(): Promise<void> {
    this.availableMessengers.next(
      await this.networkService.getJson<string[]>('/admin/messengers/available')
    );
  }

  public getConfigTemplate(JobName: string): DynamicConfig[] {
    const job = this.availableJobs.value.find(
      (t) => t.Name === JobName
    );
    if (job && job.ConfigTemplate && job.ConfigTemplate.length > 0) {
      return job.ConfigTemplate;
    }
    return null;
  }

  public getDefaultConfig(jobName: string): Record<string, unknown> {

    const ct = this.getConfigTemplate(jobName);
    if (!ct) {
      return null;
    }
    const config = {} as Record<string, unknown>;
    ct.forEach(c => config[c.id] = c.defaultValue);
    return config;
  }

  getProgress(schedule: JobScheduleDTO): JobProgressDTO {
    return this.progress.value[
      JobDTOUtils.getHashName(schedule.jobName, schedule.config)
      ];
  }

  subscribeToProgress(): void {
    this.incSubscribers();
  }

  unsubscribeFromProgress(): void {
    this.decSubscribers();
  }

  public async forceUpdate(): Promise<void> {
    return await this.loadProgress();
  }

  public async start(
    jobName: string,
    config?: Record<string, unknown>,
    soloRun = false,
    allowParallelRun = false
  ): Promise<void> {
    try {
      this.jobStartingStopping[jobName] = true;
      await this.networkService.postJson(
        '/admin/jobs/scheduled/' + jobName + '/start',
        {
          config,
          allowParallelRun,
          soloRun,
        } as JobStartDTO
      );
      // placeholder to force showing running job
      this.addDummyProgress(jobName, config);
    } finally {
      delete this.jobStartingStopping[jobName];
      this.forceUpdate();
    }
  }

  public async stop(jobName: string): Promise<void> {
    this.jobStartingStopping[jobName] = true;
    await this.networkService.postJson(
      '/admin/jobs/scheduled/' + jobName + '/stop'
    );
    delete this.jobStartingStopping[jobName];
    this.forceUpdate();
  }

  protected async loadProgress(): Promise<void> {
    this.applyProgress(
      await this.networkService.getJson<{ [key: string]: OnTimerJobProgressDTO }>(
        '/admin/jobs/scheduled/progress'
      )
    );
  }

  private applyProgress(nextProgress: Record<string, OnTimerJobProgressDTO>): void {
    const prevPrg = this.progress.value;
    this.progress.next(nextProgress || {});
    for (const prg of Object.keys(prevPrg)) {
      const prev = prevPrg[prg];
      const next = this.progress.value[prg];
      if (
        // eslint-disable-next-line no-prototype-builtins
        !(this.progress.value).hasOwnProperty(prg) ||
        // state changed from running to finished
        ((prev.state === JobProgressStates.running ||
            prev.state === JobProgressStates.cancelling) &&
          !(
            next?.state === JobProgressStates.running ||
            next?.state === JobProgressStates.cancelling
          ))
      ) {
        this.onJobFinish.emit(prg);
        if (next?.state === JobProgressStates.failed) {
          this.notification.warning(
            $localize`Job failed` +
            ': ' +
            this.backendTextService.getJobName(prev.jobName)
          );
        } else {
          this.notification.success(
            $localize`Job finished` +
            ': ' +
            this.backendTextService.getJobName(prev.jobName)
          );
        }
      }
    }
  }

  protected isAnyJobRunning(): boolean {
    return Object.values(this.progress.value)
      .findIndex(p => p.state === JobProgressStates.running ||
        p.state === JobProgressStates.cancelling) !== -1;
  }

  protected getProgressPeriodically(): void {
    if (this.timer != null || this.subscribers === 0 || !this.fallbackPolling) {
      return;
    }
    let repeatTime = 1000;
    if (!this.isAnyJobRunning()) {
      repeatTime = 15000;
    }
    this.timer = window.setTimeout(async () => {
      this.timer = null;
      this.getProgressPeriodically();
    }, repeatTime);
    this.loadProgress().catch(console.error);
  }

  private connectProgressEvents(): void {
    if (this.progressEvents !== null || this.subscribers === 0) {
      return;
    }
    if (typeof EventSource === 'undefined') {
      this.fallbackPolling = true;
      this.getProgressPeriodically();
      return;
    }

    this.fallbackPolling = false;
    this.progressEvents = new EventSource(
      this.networkService.apiBaseUrl + '/admin/jobs/scheduled/progress/events'
    );
    this.progressEvents.addEventListener('progress', (event: MessageEvent<string>) => {
      try {
        this.applyProgress(JSON.parse(event.data));
      } catch (err) {
        console.error(err);
      }
    });
    this.progressEvents.onerror = (): void => {
      this.disconnectProgressEvents();
      this.fallbackPolling = true;
      this.getProgressPeriodically();
    };
  }

  private disconnectProgressEvents(): void {
    if (this.progressEvents !== null) {
      this.progressEvents.close();
      this.progressEvents = null;
    }
  }

  private addDummyProgress(jobName: string, config: any): void {
    const prgs = this.progress.value;
    prgs[JobDTOUtils.getHashName(jobName, config)] = {
      jobName,
      state: JobProgressStates.running,
      HashName: JobDTOUtils.getHashName(jobName, config),
      logs: [],
      steps: {
        skipped: 0,
        processed: 0,
        all: 0,
      },
      time: {
        start: Date.now(),
        end: Date.now(),
      },
    };
    this.progress.next(prgs);
  }

  private incSubscribers(): void {
    this.subscribers++;
    this.connectProgressEvents();
    this.loadProgress().catch(console.error);
  }

  private decSubscribers(): void {
    this.subscribers--;
    if (this.subscribers <= 0) {
      this.subscribers = 0;
      this.disconnectProgressEvents();
      this.fallbackPolling = false;
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
        this.timer = null;
      }
    }
  }
}
