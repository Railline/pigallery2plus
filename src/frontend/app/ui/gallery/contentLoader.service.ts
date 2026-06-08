import {Injectable, OnDestroy} from '@angular/core';
import {NetworkService} from '../../model/network/network.service';
import {ContentWrapperUtils, ContentWrapperWithError, PackedContentWrapperWithError} from '../../../../common/entities/ContentWrapper';
import {SubDirectoryDTO,} from '../../../../common/entities/DirectoryDTO';
import {GalleryCacheService} from './cache.gallery.service';
import {BehaviorSubject, EMPTY, from, Observable, Subject, Subscription, timer} from 'rxjs';
import {Config} from '../../../../common/config/public/Config';
import {ShareService} from './share.service';
import {QueryParams} from '../../../../common/QueryParams';
import {ErrorCodes} from '../../../../common/entities/Error';
import {filter, map, startWith, switchMap} from 'rxjs/operators';
import {MediaDTO} from '../../../../common/entities/MediaDTO';
import {FileDTO} from '../../../../common/entities/FileDTO';
import {GalleryService} from './gallery.service';
import {SearchQueryDTO} from '../../../../common/entities/SearchQueryDTO';
import {SortingMethod} from '../../../../common/entities/SortingMethods';

@Injectable()
export class ContentLoaderService implements OnDestroy {
  public content: BehaviorSubject<ContentWrapperWithError>;
  public originalContent: Observable<DirectoryContent>;
  private ongoingContentRequest: string = null;
  private lastContentRequest: { type: 'directory' | 'search', value: string } = null;
  private pollingTimerRestart = new Subject<void>();
  private pollingSub: Subscription;
  private readonly directoryInitialPageSize = 120;
  private readonly directoryPageSize = 240;
  private loadingMoreDirectory = false;
  private directorySorting: SortingMethod = Config.Gallery.NavBar.SortingGrouping.defaultPhotoSortingMethod;

  constructor(
    private networkService: NetworkService,
    private galleryCacheService: GalleryCacheService,
    private shareService: ShareService,
    private galleryService: GalleryService
  ) {
    this.content = new BehaviorSubject<ContentWrapperWithError>(
      {} as ContentWrapperWithError
    );
    this.originalContent = this.content.pipe(
      map((c) => (c?.directory ? c?.directory : c?.searchResult))
    );
    this.setupAutoUpdate();
  }

  ngOnDestroy(): void {
    this.unSubPolling();
  }

  setupAutoUpdate() {
    this.pollingSub = this.galleryService.autoPollIntervalS.pipe(
      switchMap(interval => {
        if (!interval) {
          return EMPTY; // stop polling
        }

        // Start polling or restart when pollingTimerRestart emits
        return this.pollingTimerRestart.pipe(
          startWith(void 0),
          switchMap(() =>
            timer(
              interval * 1000,
              interval * 1000
            ).pipe(
              filter(() => this.ongoingContentRequest === null),
              switchMap(i => from(this.reloadCurrentContent()))
            )
          )
        );
      })
    ).subscribe({
      error: err => console.error(err)
    });
  }

  setContent(content: ContentWrapperWithError): void {
    if (ContentWrapperUtils.equals(this.content.value, content)) {
      return;
    }
    this.content.next(content);
  }

  public async loadDirectory(directoryName: string, forceReload = false): Promise<void> {
    this.setContent({} as PackedContentWrapperWithError);
    this.ongoingContentRequest = directoryName;
    this.lastContentRequest = {type: 'directory', value: directoryName};

    const cw = await this.loadDirectoryPage(directoryName, 0, this.directoryInitialPageSize);

    if (this.ongoingContentRequest !== directoryName) {
      return;
    }
    this.ongoingContentRequest = null;
    this.pollingTimerRestart.next();

    if (!cw || cw.notModified === true) {
      return;
    }

    this.setContent(ContentWrapperUtils.unpack(cw));
  }

  public async loadMoreCurrentDirectory(): Promise<void> {
    if (this.loadingMoreDirectory || this.lastContentRequest?.type !== 'directory') {
      return;
    }

    const current = this.content.value;
    const page = current?.directory?.mediaPage;
    if (!current?.directory || !page?.hasMore) {
      return;
    }

    this.loadingMoreDirectory = true;
    try {
      const cw = await this.loadDirectoryPage(
        this.lastContentRequest.value,
        current.directory.media.length,
        this.directoryPageSize
      );
      if (!cw?.directory?.media?.length) {
        return;
      }

      const nextContent = ContentWrapperUtils.unpack(cw);
      if (!nextContent?.directory?.media?.length) {
        return;
      }

      const mergedDirectory = {
        ...current.directory,
        media: current.directory.media.concat(nextContent.directory.media),
        mediaPage: nextContent.directory.mediaPage,
      };
      this.content.next({
        ...current,
        directory: mergedDirectory,
      });
    } finally {
      this.loadingMoreDirectory = false;
    }
  }

  private async loadDirectoryPage(directoryName: string, offset: number, limit: number): Promise<PackedContentWrapperWithError> {
    const params: { [key: string]: unknown } = {
      [QueryParams.gallery.mediaOffset]: offset,
      [QueryParams.gallery.mediaLimit]: limit,
      [QueryParams.gallery.mediaSortMethod]: this.directorySorting.method,
      [QueryParams.gallery.mediaSortAscending]: this.directorySorting.ascending ? '1' : '0',
    };

    if (Config.Sharing.enabled === true && this.shareService.isSharing()) {
      params[QueryParams.gallery.sharingKey_query] = this.shareService.getSharingKey();
    }

    try {
      return await this.networkService.getJson<PackedContentWrapperWithError>(
        '/gallery/content/' + encodeURIComponent(directoryName),
        params
      );
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  public setDirectorySorting(sorting: SortingMethod, reloadCurrentDirectory = false): void {
    const changed = !this.directorySorting ||
      this.directorySorting.method !== sorting.method ||
      this.directorySorting.ascending !== sorting.ascending;
    this.directorySorting = {method: sorting.method, ascending: sorting.ascending};
    if (changed && reloadCurrentDirectory && this.lastContentRequest?.type === 'directory') {
      this.loadDirectory(this.lastContentRequest.value, true).catch(console.error);
    }
  }

  public async search(query: SearchQueryDTO, forceReload = false): Promise<void> {
    const queryStr = JSON.stringify(query);
    this.ongoingContentRequest = queryStr;
    this.lastContentRequest = {type: 'search', value: queryStr};

    if (!forceReload) {
      this.setContent({} as PackedContentWrapperWithError); // don't empty the page when its just a reload
    }

    let cw = this.galleryCacheService.getSearch(query);
    if (forceReload || (!cw || cw.searchResult == null)) {
      try {
        cw = await this.networkService.getJson<PackedContentWrapperWithError>('/search/' + encodeURIComponent(queryStr));
        this.galleryCacheService.setSearch(cw);
      } catch (e) {
        cw = cw || {
          directory: null,
          searchResult: null
        } as PackedContentWrapperWithError;
        if (e.code === ErrorCodes.LocationLookUp_ERROR) {
          cw.error = $localize`Cannot find location` + ': ' + e.message;
        } else {
          cw.error = $localize`Unknown server error` + ': ' + e.message;
        }
      }
    }

    if (this.ongoingContentRequest !== queryStr) {
      return;
    }
    this.ongoingContentRequest = null;
    this.pollingTimerRestart.next();

    this.setContent(ContentWrapperUtils.unpack(cw));
  }

  isSearchResult(): boolean {
    return !!this.content.value.searchResult;
  }

  public async reloadCurrentContent(): Promise<void> {
    if (!this.lastContentRequest) {
      return;
    }

    if (this.lastContentRequest.type === 'directory') {
      await this.loadDirectory(this.lastContentRequest.value, true);
    } else if (this.lastContentRequest.type === 'search') {
      await this.search(JSON.parse(this.lastContentRequest.value), true);
    }
  }

  private unSubPolling() {

    if (this.pollingSub) {
      this.pollingSub.unsubscribe();
      this.pollingSub = null;
    }
  }
}


export interface DirectoryContent {
  directories: SubDirectoryDTO[];
  media: MediaDTO[];
  metaFile: FileDTO[];
}
