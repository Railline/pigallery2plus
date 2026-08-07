import {ObjectManagers} from '../../ObjectManagers';
import * as path from 'path';
import * as fs from 'fs';
import {Job} from './Job';
import {DefaultsJobs} from '../../../../common/entities/job/JobDTO';
import {JobProgressStates} from '../../../../common/entities/job/JobProgressDTO';
import {ProjectPath} from '../../../ProjectPath';
import {backendTexts} from '../../../../common/BackendTexts';
import {ParentDirectoryDTO} from '../../../../common/entities/DirectoryDTO';
import {FileDTO} from '../../../../common/entities/FileDTO';
import {DiskManager} from '../../fileaccess/DiskManager';
import {SQLConnection} from '../../database/SQLConnection';
import {MediaEntity} from '../../database/enitites/MediaEntity';
import {DynamicConfig} from '../../../../common/entities/DynamicConfig';


export class IndexingJob<
  S extends { indexChangesOnly: boolean } = { indexChangesOnly: boolean }
> extends Job<S> {
  public readonly Name = DefaultsJobs[DefaultsJobs.Indexing];
  directoriesToIndex: string[] = [];
  private directoriesToIndexHead = 0;
  public readonly ConfigTemplate: DynamicConfig[] = [
    {
      id: 'indexChangesOnly',
      type: 'boolean',
      name: backendTexts.indexChangesOnly.name,
      description: backendTexts.indexChangesOnly.description,
      defaultValue: true,
    },
  ];

  get LOG_TAG(): string {
    return '[IndexingJob]';
  }

  public get Supported(): boolean {
    return true;
  }

  protected async init(): Promise<void> {
    this.directoriesToIndex = [];
    this.directoriesToIndexHead = 0;
    this.directoriesToIndex.push('/');
    try {
      const connection = await SQLConnection.getConnection();
      const totalMedia = await connection.getRepository(MediaEntity).createQueryBuilder('media').getCount();
      this.Progress.setDetails('Images', totalMedia);
      this.Progress.log('Known media in database before indexing: ' + totalMedia);
    } catch (e) {
      this.Progress.setDetails('Images', 0);
    }
  }

  protected async step(): Promise<boolean> {
    if (this.getDirectoriesLeft() === 0) {
      if (ObjectManagers.getInstance().IndexingManager.IsSavingInProgress) {
        this.Progress.log('Waiting for pending database saves to finish.');
        await ObjectManagers.getInstance().IndexingManager.SavingReady;
      }
      this.Progress.Left = 0;
      return false;
    }
    const directory = this.takeNextDirectory();
    this.Progress.Left = this.getDirectoriesLeft();

    let scanned: ParentDirectoryDTO<FileDTO>;
    let dirChanged = true;

    try {

      const absDirPath = path.join(ProjectPath.ImageFolder, directory);
      let directoryExists = true;
      try {
        await fs.promises.access(absDirPath);
      } catch (error) {
        directoryExists = false;
      }
      if (!directoryExists) {
        this.Progress.log('Skipping. Directory does not exist: ' + directory);
        this.Progress.Skipped++;
      } else { // dir should exist now

        // check if the folder got modified if only changes need to be indexed
        if (this.config.indexChangesOnly) {

          const stat = await fs.promises.stat(absDirPath);
          const lastModified = DiskManager.calcLastModified(stat);
          scanned = await ObjectManagers.getInstance().GalleryManager.selectDirStructure(directory);
          // If not modified and it was scanned before, dir is up-to-date
          if (
            scanned &&
            scanned.lastModified === lastModified &&
            scanned.lastScanned != null
          ) {
            dirChanged = false;
          }
        }


        // reindex
        if (dirChanged || !this.config.indexChangesOnly) {
          this.Progress.log('Indexing: ' + directory);
          this.Progress.Processed++;
          scanned =
            await ObjectManagers.getInstance().IndexingManager.indexDirectory(
              directory,
              false,
              (progress): void => {
                this.Progress.setDetails(
                  'Scanning ' + progress.directory,
                  progress.total,
                  progress.processed,
                  0
                );
              }
            );
          this.Progress.setDetails(
            'Media in last indexed folder',
            scanned?.media?.length || 0,
            scanned?.media?.length || 0,
            0
          );
        } else {
          this.Progress.log('Skipping. No change for: ' + directory);
          this.Progress.Skipped++;
        }
      }
    } catch (e) {
      this.Progress.log('Skipping. Indexing failed for: ' + directory);
      this.Progress.Skipped++;
      console.error(e);
    }
    if (this.Progress.State !== JobProgressStates.running) {
      return false;
    }
    if (scanned && scanned.directories) {
      for (const item of scanned.directories) {
        this.directoriesToIndex.push(path.join(item.path, item.name));
      }
    }
    return true;
  }

  private getDirectoriesLeft(): number {
    return this.directoriesToIndex.length - this.directoriesToIndexHead;
  }

  private takeNextDirectory(): string {
    const directory = this.directoriesToIndex[this.directoriesToIndexHead++];
    if (this.directoriesToIndexHead === this.directoriesToIndex.length) {
      this.directoriesToIndex = [];
      this.directoriesToIndexHead = 0;
    } else if (
      this.directoriesToIndexHead >= 4096 &&
      this.directoriesToIndexHead * 2 >= this.directoriesToIndex.length
    ) {
      this.directoriesToIndex = this.directoriesToIndex.slice(this.directoriesToIndexHead);
      this.directoriesToIndexHead = 0;
    }
    return directory;
  }
}
