import {ParentDirectoryDTO, SubDirectoryDTO,} from '../../../common/entities/DirectoryDTO';
import * as path from 'path';
import * as fs from 'fs';
import {DirectoryEntity} from './enitites/DirectoryEntity';
import {SQLConnection} from './SQLConnection';
import {PhotoEntity} from './enitites/PhotoEntity';
import {ProjectPath} from '../../ProjectPath';
import {Config} from '../../../common/config/private/Config';
import {Brackets, Connection} from 'typeorm';
import {MediaEntity} from './enitites/MediaEntity';
import {VideoEntity} from './enitites/VideoEntity';
import {Logger} from '../../Logger';
import {ObjectManagers} from '../ObjectManagers';
import {DuplicatesDTO} from '../../../common/entities/DuplicatesDTO';
import {ReIndexingSensitivity} from '../../../common/config/private/PrivateConfig';
import {DiskManager} from '../fileaccess/DiskManager';
import {SessionContext} from '../SessionContext';
import {FileEntity} from './enitites/FileEntity';
import {SortByTypes} from '../../../common/entities/SortingMethods';

const LOG_TAG = '[GalleryManager]';

export class GalleryManager {
  private static readonly backgroundIndexing = new Set<string>();

  private static createLightweightDirectoryCache(): any {
    return {
      mediaCount: 0,
      recursiveMediaCount: 0,
      oldestMedia: null,
      youngestMedia: null,
      cover: null,
      valid: false,
    };
  }

  private static scheduleBackgroundIndex(relativeDirectoryName: string, reason: string): void {
    if (GalleryManager.backgroundIndexing.has(relativeDirectoryName)) {
      return;
    }
    GalleryManager.backgroundIndexing.add(relativeDirectoryName);
    Logger.info(LOG_TAG, `Scheduling background indexing for ${relativeDirectoryName}: ${reason}`);
    const indexingManager = ObjectManagers.getInstance().IndexingManager;
    indexingManager
      .refreshDirectoryIncremental(relativeDirectoryName)
      .then(async (refreshed): Promise<void> => {
        if (refreshed !== true) {
          await indexingManager.indexDirectory(relativeDirectoryName, true);
        }
      })
      .catch((err): void => {
        Logger.error(LOG_TAG, `Background indexing failed for ${relativeDirectoryName}: ` + err);
      })
      .finally((): void => {
        GalleryManager.backgroundIndexing.delete(relativeDirectoryName);
      });
  }

  public static parseRelativeDirPath(relativeDirectoryName: string): {
    name: string;
    parent: string;
  } {
    relativeDirectoryName = DiskManager.normalizeDirPath(
      relativeDirectoryName
    );
    return {
      name: path.basename(relativeDirectoryName),
      parent: path.join(path.dirname(relativeDirectoryName), path.sep),
    };
  }

  public async listDirectory(
    session: SessionContext,
    relativeDirectoryName: string,
    knownLastModified?: number,
    knownLastScanned?: number,
    mediaOffset?: number,
    mediaLimit?: number,
    mediaSortMethod?: number,
    mediaSortAscending = true
  ): Promise<ParentDirectoryDTO> {
    const pagedMediaRequest = Number.isFinite(mediaLimit) && mediaLimit > 0;
    const directoryPath = GalleryManager.parseRelativeDirPath(
      relativeDirectoryName
    );

    const connection = await SQLConnection.getConnection();
    const dir = await this.getDirIdAndTime(connection, directoryPath.name, directoryPath.parent);


    if (dir && dir.lastScanned != null) {
      // Return as soon as possible without touching the original data source (hdd)
      // See https://github.com/bpatrik/pigallery2/issues/613
      if (
        Config.Indexing.reIndexingSensitivity === ReIndexingSensitivity.never
      ) {
        if (
          knownLastModified &&
          knownLastScanned &&
          dir.lastModified === knownLastModified &&
          dir.lastScanned === knownLastScanned
        ) {
          return null;
        }
        return await this.getParentDirFromId(connection, session, dir.id, mediaOffset, mediaLimit, mediaSortMethod, mediaSortAscending);
      }

      const absoluteDirectoryName = ProjectPath.resolveMediaPath(relativeDirectoryName);
      if (!absoluteDirectoryName) {
        return null;
      }
      const stat = fs.statSync(absoluteDirectoryName);
      const lastModified = DiskManager.calcLastModified(stat);

      // If it seems that the content did not change, do not work on it
      if (
        knownLastModified && knownLastScanned &&
        lastModified === knownLastModified &&
        dir.lastScanned === knownLastScanned
      ) {
        if (
          Config.Indexing.reIndexingSensitivity === ReIndexingSensitivity.low
        ) {
          return null;
        }
        if (
          Date.now() - dir.lastScanned <= Config.Indexing.cachedFolderTimeout &&
          Config.Indexing.reIndexingSensitivity === ReIndexingSensitivity.medium
        ) {
          return null;
        }
      }

      if (dir.lastModified !== lastModified) {
        Logger.silly(LOG_TAG, 'Reindexing reason: lastModified mismatch: known: ' + dir.lastModified + ', current:' + lastModified);
        if (pagedMediaRequest) {
          GalleryManager.scheduleBackgroundIndex(relativeDirectoryName, 'lastModified mismatch');
          return await this.getParentDirFromId(connection, session, dir.id, mediaOffset, mediaLimit, mediaSortMethod, mediaSortAscending);
        }
        // Need to wait for save, then return a DB-based result with projection
        await ObjectManagers.getInstance().IndexingManager.indexDirectory(relativeDirectoryName, true);
        return await this.getParentDirFromId(connection, session, dir.id, mediaOffset, mediaLimit, mediaSortMethod, mediaSortAscending);

      }

      // not indexed since a while, index it lazily
      const cacheAge = Date.now() - dir.lastScanned;
      const cacheExpired = cacheAge > Config.Indexing.cachedFolderTimeout;
      if (
        (cacheExpired &&
          Config.Indexing.reIndexingSensitivity >= ReIndexingSensitivity.medium) ||
        (!pagedMediaRequest &&
          Config.Indexing.reIndexingSensitivity >= ReIndexingSensitivity.high)
      ) {
        // on the fly reindexing
        Logger.silly(LOG_TAG, 'lazy reindexing reason: cache timeout: lastScanned: ' + cacheAge +
          'ms ago, cachedFolderTimeout:' + Config.Indexing.cachedFolderTimeout);
        GalleryManager.scheduleBackgroundIndex(relativeDirectoryName, 'cache timeout');
      }
      return await this.getParentDirFromId(connection, session, dir.id, mediaOffset, mediaLimit, mediaSortMethod, mediaSortAscending);
    }

    // never scanned (deep indexed), do it and return with it
    Logger.silly(LOG_TAG, 'Reindexing reason: never scanned');
    if (session?.projectionQuery) {
      // Save must be completed to query with projection
      await ObjectManagers.getInstance().IndexingManager.indexDirectory(
        relativeDirectoryName,
        true
      );
      const connection = await SQLConnection.getConnection();
      const dir = await this.getDirIdAndTime(connection, directoryPath.name, directoryPath.parent);
      return await this.getParentDirFromId(connection, session, dir.id, mediaOffset, mediaLimit, mediaSortMethod, mediaSortAscending);
    }
    return ObjectManagers.getInstance().IndexingManager.indexDirectory(relativeDirectoryName);
  }

  async countDirectories(): Promise<number> {
    const connection = await SQLConnection.getConnection();
    return await connection
      .getRepository(DirectoryEntity)
      .createQueryBuilder('directory')
      .getCount();
  }

  async countMediaSize(): Promise<number> {
    const connection = await SQLConnection.getConnection();
    const {sum} = await connection
      .getRepository(MediaEntity)
      .createQueryBuilder('media')
      .select('SUM(media.metadata.fileSize)', 'sum')
      .getRawOne();
    return sum || 0;
  }

  async countPhotos(): Promise<number> {
    const connection = await SQLConnection.getConnection();
    return await connection
      .getRepository(PhotoEntity)
      .createQueryBuilder('directory')
      .getCount();
  }

  async countVideos(): Promise<number> {
    const connection = await SQLConnection.getConnection();
    return await connection
      .getRepository(VideoEntity)
      .createQueryBuilder('directory')
      .getCount();
  }

  public async getPossibleDuplicates(): Promise<DuplicatesDTO[]> {
    const connection = await SQLConnection.getConnection();
    const mediaRepository = connection.getRepository(MediaEntity);

    let duplicates = await mediaRepository
      .createQueryBuilder('media')
      .innerJoin(
        (query) =>
          query
            .from(MediaEntity, 'innerMedia')
            .select([
              'innerMedia.name as name',
              'innerMedia.metadata.fileSize as fileSize',
              'count(*)',
            ])
            .groupBy('innerMedia.name, innerMedia.metadata.fileSize')
            .having('count(*)>1'),
        'innerMedia',
        'media.name=innerMedia.name AND media.metadata.fileSize = innerMedia.fileSize'
      )
      .innerJoinAndSelect('media.directory', 'directory')
      .orderBy('media.name, media.metadata.fileSize')
      .limit(Config.Duplicates.listingLimit)
      .getMany();

    const duplicateParis: DuplicatesDTO[] = [];
    const processDuplicates = (
      duplicateList: MediaEntity[],
      equalFn: (a: MediaEntity, b: MediaEntity) => boolean,
      checkDuplicates = false
    ): void => {
      let i = duplicateList.length - 1;
      while (i >= 0) {
        const list = [duplicateList[i]];
        let j = i - 1;
        while (j >= 0 && equalFn(duplicateList[i], duplicateList[j])) {
          list.push(duplicateList[j]);
          j--;
        }
        i = j;
        // if we cut the select list with the SQL LIMIT, filter unpaired media
        if (list.length < 2) {
          continue;
        }
        if (checkDuplicates) {
          // ad to group if one already existed
          const foundDuplicates = duplicateParis.find(
            (dp): boolean =>
              !!dp.media.find(
                (m): boolean => !!list.find((lm): boolean => lm.id === m.id)
              )
          );
          if (foundDuplicates) {
            list.forEach((lm): void => {
              if (
                foundDuplicates.media.find((m): boolean => m.id === lm.id)
              ) {
                return;
              }
              foundDuplicates.media.push(lm);
            });
            continue;
          }
        }

        duplicateParis.push({media: list});
      }
    };

    processDuplicates(
      duplicates,
      (a, b): boolean =>
        a.name === b.name && a.metadata.fileSize === b.metadata.fileSize
    );

    duplicates = await mediaRepository
      .createQueryBuilder('media')
      .innerJoin(
        (query) =>
          query
            .from(MediaEntity, 'innerMedia')
            .select([
              'innerMedia.metadata.creationDate as creationDate',
              'innerMedia.metadata.fileSize as fileSize',
              'count(*)',
            ])
            .groupBy(
              'innerMedia.metadata.creationDate, innerMedia.metadata.fileSize'
            )
            .having('count(*)>1'),
        'innerMedia',
        'media.metadata.creationDate=innerMedia.creationDate AND media.metadata.fileSize = innerMedia.fileSize'
      )
      .innerJoinAndSelect('media.directory', 'directory')
      .orderBy('media.metadata.creationDate, media.metadata.fileSize')
      .limit(Config.Duplicates.listingLimit)
      .getMany();

    processDuplicates(
      duplicates,
      (a, b): boolean =>
        a.metadata.creationDate === b.metadata.creationDate &&
        a.metadata.fileSize === b.metadata.fileSize,
      true
    );

    return duplicateParis;
  }

  /**
   * Returns with the directories only, does not include media or metafiles
   */
  public async selectDirStructure(
    relativeDirectoryName: string
  ): Promise<DirectoryEntity> {
    const directoryPath = GalleryManager.parseRelativeDirPath(
      relativeDirectoryName
    );
    const connection = await SQLConnection.getConnection();
    const query = connection
      .getRepository(DirectoryEntity)
      .createQueryBuilder('directory')
      .where('directory.name = :name AND directory.path = :path', {
        name: directoryPath.name,
        path: directoryPath.parent,
      })
      .leftJoinAndSelect('directory.directories', 'directories');

    return await query.getOne();
  }

  /**
   * Sets cover for the directory and caches it in the DB
   */
  public async fillCacheForSubDir(
    connection: Connection,
    session: SessionContext,
    dir: SubDirectoryDTO
  ): Promise<void> {
    if (!dir.cache?.valid) {
      dir.cache = await ObjectManagers.getInstance().ProjectedCacheManager.setAndGetCacheForDirectory(connection, session, dir);
    }

    dir.media = [];
    dir.isPartial = true;
  }

  async getMedia(session: SessionContext, mediaPath: string): Promise<MediaEntity> {
    // Validate media is available under projectionQuery
    const fileName = path.basename(mediaPath);
    const dirRelPath = path.dirname(mediaPath);
    const directoryName = path.basename(dirRelPath);
    const directoryParent = path.join(path.dirname(dirRelPath), path.sep);

    const connection = await SQLConnection.getConnection();
    const qb = connection
      .getRepository(MediaEntity)
      .createQueryBuilder('media')
      .innerJoinAndSelect('media.directory', 'directory')
      .where('media.name = :name', {name: fileName})
      .andWhere('directory.name = :dname AND directory.path = :dpath', {dname: directoryName, dpath: directoryParent});
    if (session.projectionQuery) {
      qb.andWhere(session.projectionQuery);
    }
    return await qb.getOne();
  }

  async authoriseMedia(session: SessionContext, mediaPath: string) {
    // If no projection set for session, proceed
    if (!session?.projectionQuery) {
      return true;
    }

    // Validate media is available under projectionQuery
    const fileName = path.basename(mediaPath);
    const dirRelPath = path.dirname(mediaPath);
    const directoryName = path.basename(dirRelPath);
    const directoryParent = path.join(path.dirname(dirRelPath), path.sep);

    const connection = await SQLConnection.getConnection();
    const qb = connection
      .getRepository(MediaEntity)
      .createQueryBuilder('media')
      .innerJoin('media.directory', 'directory')
      .where('media.name = :name', {name: fileName})
      .andWhere('directory.name = :dname AND directory.path = :dpath', {dname: directoryName, dpath: directoryParent})
      .andWhere(session.projectionQuery);

    const count = await qb.getCount();

    return count !== 0;
  }

  async authoriseMetaFile(session: SessionContext, p: string) {
    // If no projection set for session, proceed
    if (!session?.projectionQuery) {
      return true;
    }

    // Authorize metafile if its directory contains any media that matches the projectionQuery
    const dirRelPath = path.dirname(p);
    const directoryName = path.basename(dirRelPath);
    const directoryParent = path.join(path.dirname(dirRelPath), path.sep);

    const connection = await SQLConnection.getConnection();
    const qb = connection
      .getRepository(MediaEntity)
      .createQueryBuilder('media')
      .innerJoin('media.directory', 'directory')
      .where('directory.name = :dname AND directory.path = :dpath', {
        dname: directoryName,
        dpath: directoryParent,
      })
      .andWhere(session.projectionQuery);

    const count = await qb.getCount();

    return count !== 0;
  }

  protected async getDirIdAndTime(connection: Connection, name: string, path: string): Promise<{
    id: number,
    lastScanned: number,
    lastModified: number
  }> {
    return await connection
      .getRepository(DirectoryEntity)
      .createQueryBuilder('directory')
      .where('directory.name = :name AND directory.path = :path', {
        name: name,
        path: path,
      })
      .select([
        'directory.id',
        'directory.lastScanned',
        'directory.lastModified',
      ]).getOne();
  }

  protected async getParentDirFromId(
    connection: Connection,
    session: SessionContext,
    partialDirId: number,
    mediaOffset?: number,
    mediaLimit?: number,
    mediaSortMethod?: number,
    mediaSortAscending = true
  ): Promise<ParentDirectoryDTO> {
    const startedAt = Date.now();
    const timings: {[key: string]: number} = {};
    const offset = Number.isFinite(mediaOffset) && mediaOffset > 0 ? mediaOffset : 0;
    const limit = Number.isFinite(mediaLimit) && mediaLimit > 0 ? Math.min(mediaLimit, 1000) : null;
    const pagedMediaRequest = limit !== null;
    const markTiming = (name: string, since: number): void => {
      if (pagedMediaRequest) {
        timings[name] = Date.now() - since;
      }
    };

    const query = connection
      .getRepository(DirectoryEntity)
      .createQueryBuilder('directory')
      .where('directory.id = :id', {
        id: partialDirId
      })
      .leftJoinAndSelect('directory.cache', 'cache', 'cache.projectionKey = :pk AND cache.valid = 1', {pk: session.user.projectionKey});


    try {
      let t = Date.now();
      const dir = await query.getOne();
      markTiming('directory', t);

      t = Date.now();
      if (!dir.cache?.valid && !pagedMediaRequest) {
        dir.cache = await ObjectManagers.getInstance().ProjectedCacheManager.setAndGetCacheForDirectory(connection, session, dir);
      }
      if (!dir.cache?.valid && pagedMediaRequest) {
        dir.cache = GalleryManager.createLightweightDirectoryCache();
      }
      markTiming('cache', t);

      t = Date.now();
      const dirQuery = connection
        .getRepository(DirectoryEntity)
        .createQueryBuilder('directories')
        .where('directories.parent = :id', {id: partialDirId})
        .leftJoinAndSelect('directories.cache', 'dcache', 'dcache.projectionKey = :pk AND dcache.valid = 1', {pk: session.user.projectionKey})
        .leftJoinAndSelect('dcache.cover', 'dcover')
        .leftJoinAndSelect('dcover.directory', 'dcoverDirectory')
        .select([
          'directories',
          'dcache',
          'dcover.name',
          'dcoverDirectory.name',
          'dcoverDirectory.path',
        ]);

      // search does not return a directory if that is recursively having 0 media
      // gallery listing should otherwise, we won't be able to trigger lazy indexing
      // this behavior lets us explicitly hid a directory if it is explicitly blocked
      if (session.projectionQueryForSubDir) {
        dirQuery.andWhere(new Brackets(q => {
          q.where(session.projectionQueryForSubDir);
          // also select directories when they have no child dirs.
          q.orWhere('directories.id is NULL');
        }));
      }

      dir.directories = await dirQuery.getMany();
      markTiming('children', t);



      t = Date.now();
      if (dir.directories) {
        for (const item of dir.directories) {
          if (item.cache?.valid) {
            item.media = [];
            item.isPartial = true;
            continue;
          }
          await this.fillCacheForSubDir(connection, session, item);
        }
      }
      markTiming('childrenCache', t);

      const mQuery = connection.getRepository(MediaEntity)
        .createQueryBuilder('media')
        .leftJoin('media.directory', 'directory')
        .where('media.directory = :id', {
          id: partialDirId
        });
      if (session.projectionQuery) {
        mQuery.andWhere(session.projectionQuery);
      }
      t = Date.now();
      const totalMediaCount = await mQuery.getCount();
      markTiming('mediaCount', t);
      if (dir.cache && pagedMediaRequest) {
        dir.cache.mediaCount = totalMediaCount;
        dir.cache.recursiveMediaCount = Math.max(dir.cache.recursiveMediaCount || 0, totalMediaCount);
      }
      if (limit !== null) {
        const sortDirection = mediaSortAscending ? 'ASC' : 'DESC';
        switch (mediaSortMethod) {
          case SortByTypes.Name:
            mQuery.orderBy('media.name', sortDirection);
            break;
          case SortByTypes.Rating:
            mQuery.orderBy('media.metadata.rating', sortDirection);
            break;
          case SortByTypes.FileSize:
            mQuery.orderBy('media.metadata.fileSize', sortDirection);
            break;
          case SortByTypes.Date:
          case SortByTypes.PersonCount:
          case SortByTypes.Random:
          default:
            mQuery.orderBy('media.metadata.creationDate', sortDirection);
            break;
        }
        mQuery
          .addOrderBy('media.id', sortDirection)
          .skip(offset)
          .take(limit);
      }
      t = Date.now();
      dir.media = await mQuery.getMany();
      markTiming('mediaPage', t);
      if (limit !== null) {
        (dir as ParentDirectoryDTO).mediaPage = {
          offset,
          limit,
          total: totalMediaCount,
          hasMore: offset + dir.media.length < totalMediaCount,
        };
      }

      // Separate query for meta files
      if (
        Config.MetaFile.gpx === true ||
        Config.MetaFile.pg2conf === true ||
        Config.MetaFile.markdown === true
      ) {
        const t = Date.now();
        const metaFileQuery = connection
          .getRepository(FileEntity)
          .createQueryBuilder('metaFile')
          .where('metaFile.directory = :id', {id: partialDirId});

        dir.metaFile = await metaFileQuery.getMany();
        markTiming('metaFiles', t);
      }

      const totalMs = Date.now() - startedAt;
      if (pagedMediaRequest && totalMs > 1000) {
        Logger.info(
          LOG_TAG,
          'Paged directory load slow',
          `dirId=${partialDirId}`,
          `offset=${offset}`,
          `limit=${limit}`,
          `totalMs=${totalMs}`,
          `timings=${JSON.stringify(timings)}`
        );
      }

      return dir;
    } catch (e) {
      Logger.error(LOG_TAG, 'Failed to get parent directory: ' + e);
      Logger.debug(LOG_TAG, query.getQuery(), query.getParameters());
      throw e;
    }
  }
}
