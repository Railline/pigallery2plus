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
import {SortByTypes, SortingMethod} from '../../../../common/entities/SortingMethods';
import {Utils} from '../../../../common/Utils';
import {PhotoDTO} from '../../../../common/entities/PhotoDTO';

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
  private readonly searchInitialPageSize = 120;
  private readonly searchPageSize = 240;
  public lastDirectoryPageDebug = '';
  private loadingMoreDirectory = false;
  private loadingMoreSearch = false;
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

    const content = ContentWrapperUtils.unpack(cw);
    this.sortSearchPageMedia(content);
    this.setContent(content);
  }

  public async loadMoreCurrentDirectory(): Promise<void> {
    if (this.loadingMoreDirectory || this.lastContentRequest?.type !== 'directory') {
      return;
    }

    const requestDirectory = this.lastContentRequest.value;
    const current = this.content.value;
    const page = current?.directory?.mediaPage;
    if (!current?.directory || !page?.hasMore) {
      return;
    }

    const offset = Math.max(
      current.directory.media?.length || 0,
      (page.offset || 0) + (page.limit || 0)
    );

    this.loadingMoreDirectory = true;
    try {
      const cw = await this.loadDirectoryPage(
        requestDirectory,
        offset,
        this.directoryPageSize
      );
      if (this.lastContentRequest?.type !== 'directory' || this.lastContentRequest.value !== requestDirectory) {
        return;
      }
      if (!cw?.directory?.media?.length) {
        return;
      }

      const nextContent = ContentWrapperUtils.unpack(cw);
      if (!nextContent?.directory?.media?.length) {
        return;
      }

      const latest = this.content.value;
      if (!latest?.directory) {
        return;
      }

      const directoryKey = (directory: { path?: string; name?: string }) => (directory?.path || '') + '/' + (directory?.name || '');
      const latestDirectoryKey = directoryKey(latest.directory);
      const nextDirectoryKey = directoryKey(nextContent.directory);
      const mediaKey = (media: MediaDTO, fallbackDirectoryKey: string): string =>
        ((media.directory ? directoryKey(media.directory) : fallbackDirectoryKey) + '/' + media.name);
      const seen = new Set((latest.directory.media || []).map((media) => mediaKey(media, latestDirectoryKey)));
      const newMedia = nextContent.directory.media.filter((media) => {
        const key = mediaKey(media, nextDirectoryKey);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      this.lastDirectoryPageDebug = 'offset=' + offset + ' fetched=' + nextContent.directory.media.length + ' new=' + newMedia.length + ' loaded=' + (latest.directory.media || []).length;
      if (newMedia.length === 0) {
        const mediaPage = nextContent.directory.mediaPage || page;
        this.content.next({
          ...latest,
          directory: {
            ...latest.directory,
            mediaPage: {
              ...mediaPage,
              hasMore: false,
            },
          },
        });
        return;
      }

      this.lastDirectoryPageDebug = 'offset=' + offset + ' fetched=' + nextContent.directory.media.length + ' new=' + newMedia.length + ' loaded=' + ((latest.directory.media || []).length + newMedia.length);
      const mergedDirectory = {
        ...latest.directory,
        media: (latest.directory.media || []).concat(newMedia),
        mediaPage: nextContent.directory.mediaPage,
      };
      this.content.next({
        ...latest,
        directory: mergedDirectory,
      });
    } finally {
      this.loadingMoreDirectory = false;
    }
  }

  public hasMoreCurrentDirectory(): boolean {
    const page = this.content.value?.directory?.mediaPage;
    return this.lastContentRequest?.type === 'directory' && page?.hasMore === true;
  }

  public hasMoreCurrentSearch(): boolean {
    const page = this.content.value?.searchResult?.mediaPage;
    return this.lastContentRequest?.type === 'search' && page?.hasMore === true;
  }

  public hasMoreCurrentContent(): boolean {
    return this.hasMoreCurrentDirectory() || this.hasMoreCurrentSearch();
  }

  public isLoadingMoreCurrentDirectory(): boolean {
    return this.loadingMoreDirectory;
  }

  public isLoadingMoreCurrentSearch(): boolean {
    return this.loadingMoreSearch;
  }

  public isLoadingMoreCurrentContent(): boolean {
    return this.loadingMoreDirectory || this.loadingMoreSearch;
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
    const sharingKey = Config.Sharing.enabled === true && this.shareService.isSharing()
      ? this.shareService.getSharingKey()
      : '';
    const searchCacheScope = sharingKey ? QueryParams.gallery.sharingKey_query + '=' + sharingKey : '';
    this.ongoingContentRequest = queryStr;
    this.lastContentRequest = {type: 'search', value: queryStr};

    if (!forceReload) {
      this.setContent({} as PackedContentWrapperWithError); // don't empty the page when its just a reload
    }

    let cw: PackedContentWrapperWithError;
    try {
      cw = await this.loadSearchPage(query, 0, this.searchInitialPageSize, searchCacheScope);
    } catch (e) {
      cw = {
        directory: null,
        searchResult: null
      } as PackedContentWrapperWithError;
      if (e.code === ErrorCodes.LocationLookUp_ERROR) {
        cw.error = $localize`Cannot find location` + ': ' + e.message;
      } else {
        cw.error = $localize`Unknown server error` + ': ' + e.message;
      }
    }

    if (this.ongoingContentRequest !== queryStr) {
      return;
    }
    this.ongoingContentRequest = null;
    this.pollingTimerRestart.next();

    this.setContent(ContentWrapperUtils.unpack(cw));
  }

  public async loadMoreCurrentSearch(): Promise<void> {
    if (this.loadingMoreSearch || this.lastContentRequest?.type !== 'search') {
      return;
    }

    const requestQuery = this.lastContentRequest.value;
    const current = this.content.value;
    const page = current?.searchResult?.mediaPage;
    if (!current?.searchResult || !page?.hasMore) {
      return;
    }

    const offset = Math.max(
      current.searchResult.media?.length || 0,
      (page.offset || 0) + (page.limit || 0)
    );

    this.loadingMoreSearch = true;
    try {
      const cw = await this.loadSearchPage(
        JSON.parse(requestQuery),
        offset,
        this.searchPageSize,
        Config.Sharing.enabled === true && this.shareService.isSharing()
          ? QueryParams.gallery.sharingKey_query + '=' + this.shareService.getSharingKey()
          : ''
      );
      if (this.lastContentRequest?.type !== 'search' || this.lastContentRequest.value !== requestQuery) {
        return;
      }
      if (!cw?.searchResult?.media?.length) {
        return;
      }

      const nextContent = ContentWrapperUtils.unpack(cw);
      if (!nextContent?.searchResult?.media?.length) {
        return;
      }
      this.sortSearchPageMedia(nextContent);

      const latest = this.content.value;
      if (!latest?.searchResult) {
        return;
      }

      const mediaKey = (media: MediaDTO): string =>
        ((media.directory?.path || '') + '/' + (media.directory?.name || '') + '/' + media.name);
      const seen = new Set((latest.searchResult.media || []).map(mediaKey));
      const newMedia = nextContent.searchResult.media.filter((media) => {
        const key = mediaKey(media);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      if (newMedia.length === 0) {
        this.content.next({
          ...latest,
          searchResult: {
            ...latest.searchResult,
            mediaPage: {
              ...(nextContent.searchResult.mediaPage || page),
              hasMore: false,
            },
          },
        });
        return;
      }

      this.content.next({
        ...latest,
        searchResult: {
          ...latest.searchResult,
          media: (latest.searchResult.media || []).concat(newMedia),
          mediaPage: nextContent.searchResult.mediaPage,
          resultOverflow: false,
        },
      });
    } finally {
      this.loadingMoreSearch = false;
    }
  }

  public async loadMoreCurrentContent(): Promise<void> {
    if (this.lastContentRequest?.type === 'directory') {
      return this.loadMoreCurrentDirectory();
    }
    if (this.lastContentRequest?.type === 'search') {
      return this.loadMoreCurrentSearch();
    }
  }

  private async loadSearchPage(
      query: SearchQueryDTO,
      offset: number,
      limit: number,
      searchCacheScope: string
  ): Promise<PackedContentWrapperWithError> {
    const queryStr = JSON.stringify(query);
    const params: { [key: string]: unknown } = {
      [QueryParams.gallery.mediaOffset]: offset,
      [QueryParams.gallery.mediaLimit]: limit,
    };
    if (Config.Sharing.enabled === true && this.shareService.isSharing()) {
      params[QueryParams.gallery.sharingKey_query] = this.shareService.getSharingKey();
    }

    const cw = await this.networkService.getJson<PackedContentWrapperWithError>(
      '/search/' + encodeURIComponent(queryStr),
      params
    );
    if (!cw?.searchResult?.mediaPage && offset === 0) {
      this.galleryCacheService.setSearch(cw, searchCacheScope);
    }
    return cw;
  }

  private sortSearchPageMedia(cw: ContentWrapperWithError): void {
    const media = cw?.searchResult?.media;
    if (!media?.length) {
      return;
    }
    const sorting = Config.Gallery.NavBar.SortingGrouping.defaultSearchSortingMethod;
    switch (sorting.method) {
      case SortByTypes.Name:
        media.sort((a: MediaDTO, b: MediaDTO) =>
          Utils.sortableFilename(a.name).localeCompare(Utils.sortableFilename(b.name))
        );
        break;
      case SortByTypes.Rating:
        media.sort((a: PhotoDTO, b: PhotoDTO) => (a.metadata?.rating || 0) - (b.metadata?.rating || 0));
        break;
      case SortByTypes.FileSize:
        media.sort((a: PhotoDTO, b: PhotoDTO) => (a.metadata?.fileSize || 0) - (b.metadata?.fileSize || 0));
        break;
      case SortByTypes.PersonCount:
        media.sort((a: PhotoDTO, b: PhotoDTO) => (a.metadata?.faces?.length || 0) - (b.metadata?.faces?.length || 0));
        break;
      case SortByTypes.Date:
      case SortByTypes.Random:
      default:
        media.sort((a: PhotoDTO, b: PhotoDTO) =>
          Utils.getTimeMS(a.metadata.creationDate, a.metadata.creationDateOffset, Config.Gallery.ignoreTimestampOffset) -
          Utils.getTimeMS(b.metadata.creationDate, b.metadata.creationDateOffset, Config.Gallery.ignoreTimestampOffset)
        );
        break;
    }
    if (!sorting.ascending) {
      media.reverse();
    }
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
