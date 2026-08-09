import {expect} from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import {JobProgressManager} from '../../../../../src/backend/model/jobs/JobProgressManager';
import {
  JobProgressDTO,
  JobProgressStates
} from '../../../../../src/common/entities/job/JobProgressDTO';

describe('JobProgressManager', () => {
  let dbFolder: string;
  let originalDBFolder: string;

  beforeEach(() => {
    originalDBFolder = ProjectPath.DBFolder;
    dbFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'pigallery-job-progress-'));
    ProjectPath.DBFolder = dbFolder;
  });

  afterEach(() => {
    ProjectPath.DBFolder = originalDBFolder;
    fs.rmSync(dbFolder, {recursive: true, force: true});
  });

  it('atomically flushes a delayed update during cleanup', async () => {
    const manager = new JobProgressManager();
    const progress: JobProgressDTO = {
      jobName: 'Indexing',
      HashName: 'Indexing-test',
      steps: {all: 10, processed: 4, skipped: 0},
      state: JobProgressStates.running,
      logs: [],
      time: {start: Date.now(), end: Date.now()},
    };

    manager.onJobProgressUpdate(progress);
    await manager.cleanUp();

    const saved = JSON.parse(
      fs.readFileSync(path.join(dbFolder, 'jobs.db'), 'utf8')
    );
    expect(saved.progresses[progress.HashName].progress.steps.processed).to.equal(4);
    expect(fs.existsSync(path.join(dbFolder, 'jobs.db.tmp'))).to.equal(false);
  });
});
