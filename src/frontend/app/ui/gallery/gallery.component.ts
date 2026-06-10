import {Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild} from '@angular/core';
import {AuthenticationService} from '../../model/network/authentication.service';
import {ActivatedRoute, Params, Router} from '@angular/router';
import {ContentService} from './content.service';
import {GalleryGridComponent} from './grid/grid.gallery.component';
import {Config} from '../../../../common/config/public/Config';
import {ShareService} from './share.service';
import {NavigationService} from '../../model/navigation.service';
import {UserRoles} from '../../../../common/entities/UserDTO';
import {interval, Observable, Subscription} from 'rxjs';
import {PageHelper} from '../../model/page.helper';
import {PhotoDTO} from '../../../../common/entities/PhotoDTO';
import {QueryParams} from '../../../../common/QueryParams';
import {take} from 'rxjs/operators';
import {GallerySortingService, GroupedDirectoryContent, MediaGroup} from './navigator/sorting.service';
import {FilterService} from './filter/filter.service';
import {PiTitleService} from '../../model/pi-title.service';
import {GPXFilesFilterPipe} from '../../pipes/GPXFilesFilterPipe';
import {MDFilesFilterPipe} from '../../pipes/MDFilesFilterPipe';
import {ContentLoaderService} from './contentLoader.service';
import {GalleryLightboxComponent} from './lightbox/lightbox.gallery.component';
import {FrameComponent} from '../frame/frame.component';
import {NgIf} from '@angular/common';
import {RandomQueryBuilderGalleryComponent} from './random-query-builder/random-query-builder.gallery.component';
import {PhotoFrameBuilderGalleryComponent} from './photo-frame-builder/photo-frame-builder.gallery.component';
import {GalleryNavigatorComponent} from './navigator/navigator.gallery.component';
import {DirectoriesComponent} from './directories/directories.component';
import {GalleryBlogComponent} from './blog/blog.gallery.component';
import {GalleryMapComponent} from './map/map.gallery.component';
import {PhotoFilterPipe} from '../../pipes/PhotoFilterPipe';
import {MediaButtonModalComponent} from './grid/photo/media-button-modal/media-button-modal.component';
import {ContentWrapperWithError} from '../../../../common/entities/ContentWrapper';
import {SearchQueryUtils} from '../../../../common/SearchQueryUtils';
import {UploaderService} from './uploader/uploader.service';
import {GalleryService} from './gallery.service';
import {UploaderComponent} from './uploader/uploader.gallery.component';

@Component({
  selector: 'app-gallery',
  templateUrl: './gallery.component.html',
  styleUrls: ['./gallery.component.css'],
  imports: [
    GalleryLightboxComponent,
    FrameComponent,
    NgIf,
    RandomQueryBuilderGalleryComponent,
    PhotoFrameBuilderGalleryComponent,
    GalleryNavigatorComponent,
    DirectoriesComponent,
    GalleryBlogComponent,
    GalleryMapComponent,
    GalleryGridComponent,
    GPXFilesFilterPipe,
    PhotoFilterPipe,
    MediaButtonModalComponent,
    UploaderComponent
  ]
})
export class GalleryComponent implements OnInit, OnDestroy {
  @ViewChild(GalleryGridComponent, {static: false})
  grid: GalleryGridComponent;
  @ViewChild('feedProgress', {static: false})
  feedProgress: ElementRef<HTMLElement>;

  public showSearchBar = false;
  public showShare = false;
  public showRandomPhotoBuilder = false;
  public blogOpen = Config.Gallery.TopBlogStartsOpen;

  config = Config;
  public isPhotoWithLocation = false;
  public countDown: {
    day: number;
    hour: number;
    minute: number;
    second: number;
  } = null;
  public readonly mapEnabled: boolean;
  public directoryContent: GroupedDirectoryContent;
  public visibleDirectoryContent: GroupedDirectoryContent;
  public visibleMediaCount = 0;
  public totalMediaCount = 0;
  public feedDebug = '';
  public isUploadOver = false;
  private $counter: Observable<number>;
  private readonly feedInitialMediaCount = 120;
  private readonly feedBatchMediaCount = 240;
  private readonly feedScrollThresholdPx = 1800;
  private autoLoadMoreScheduled = false;
  private currentFeedKey: string = null;
  private subscription: { [key: string]: Subscription } = {
    content: null,
    route: null,
    timer: null,
    sorting: null,
  };

  constructor(
    public contentLoader: ContentLoaderService,
    public contentService: ContentService,
    public galleryService: GalleryService,
    private authService: AuthenticationService,
    private router: Router,
    private shareService: ShareService,
    private route: ActivatedRoute,
    private navigation: NavigationService,
    private filterService: FilterService,
    private sortingService: GallerySortingService,
    private piTitleService: PiTitleService,
    private gpxFilesFilterPipe: GPXFilesFilterPipe,
    private mdFilesFilterPipe: MDFilesFilterPipe,
    public uploaderService: UploaderService,
  ) {
    this.mapEnabled = Config.Map.enabled;
    PageHelper.showScrollY('gallery');
  }

  get ContentWrapper(): ContentWrapperWithError {
    return this.contentLoader.content.value;
  }

  get ShowMarkDown(): boolean {
    return this.config.MetaFile.markdown && this.directoryContent?.metaFile && this.mdFilesFilterPipe.transform(this.directoryContent.metaFile).length > 0;
  }

  get ShowMap(): boolean {
    return (this.isPhotoWithLocation || this.gpxFilesFilterPipe.transform(this.directoryContent?.metaFile)?.length > 0) && this.mapEnabled;
  }

  updateTimer(t: number): void {
    if (this.shareService.sharingSubject.value == null) {
      return;
    }
    // if the timer is longer than 10 years, just do not show it
    if (
      (this.shareService.sharingSubject.value.expires - Date.now()) /
      1000 /
      86400 /
      365 >
      10
    ) {
      return;
    }

    t = Math.floor(
      (this.shareService.sharingSubject.value.expires - Date.now()) / 1000
    );
    this.countDown = {} as any;
    this.countDown.day = Math.floor(t / 86400);
    t -= this.countDown.day * 86400;
    this.countDown.hour = Math.floor(t / 3600) % 24;
    t -= this.countDown.hour * 3600;
    this.countDown.minute = Math.floor(t / 60) % 60;
    t -= this.countDown.minute * 60;
    this.countDown.second = t % 60;
  }

  ngOnDestroy(): void {
    if (this.subscription.content !== null) {
      this.subscription.content.unsubscribe();
    }
    if (this.subscription.route !== null) {
      this.subscription.route.unsubscribe();
    }
    if (this.subscription.timer !== null) {
      this.subscription.timer.unsubscribe();
    }
    if (this.subscription.sorting !== null) {
      this.subscription.sorting.unsubscribe();
    }
  }

  async ngOnInit(): Promise<boolean> {
    await this.shareService.wait();
    if (!this.authService.isAuthenticated()) {
      return this.navigation.toLogin();
    }
    this.showSearchBar = this.authService.canSearch();
    this.showShare =
      Config.Sharing.enabled &&
      this.authService.isAuthorized(UserRoles.User);
    this.showRandomPhotoBuilder =
      Config.RandomPhoto.enabled &&
      this.authService.isAuthorized(UserRoles.LimitedGuest);
    this.subscription.content = this.contentService.sortedFilteredContent
      .subscribe((dc: GroupedDirectoryContent) => {
        this.onContentChange(dc);
      });
    this.subscription.route = this.route.params.subscribe(this.onRoute);

    if (this.shareService.isSharing()) {
      this.$counter = interval(1000);
      this.subscription.timer = this.$counter.subscribe((x): void =>
        this.updateTimer(x)
      );
    }
  }

  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    if (this.uploaderService.canUpload()) {
      event.preventDefault();
      event.stopPropagation();
      this.isUploadOver = true;
    }
  }

  @HostListener('dragleave', ['$event'])
  onDragLeave(event: DragEvent): void {
    if (this.uploaderService.canUpload()) {
      event.preventDefault();
      event.stopPropagation();
      this.isUploadOver = false;
    }
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    if (this.uploaderService.canUpload()) {
      event.preventDefault();
      event.stopPropagation();
      this.isUploadOver = false;
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        this.uploaderService.uploadFiles(files);
      }
    }
  }


  @HostListener('window:scroll')
  @HostListener('document:scroll')
  @HostListener('window:resize')
  @HostListener('window:wheel')
  @HostListener('window:touchmove')
  onWindowScroll(): void {
    this.loadMoreIfNearEnd();
  }

  private onRoute = async (params: Params): Promise<void> => {
    const searchQuery = SearchQueryUtils.parseURLifiedQuery(params[QueryParams.gallery.search.query]);
    if (searchQuery) {
      this.contentLoader.search(searchQuery).catch(console.error);
      this.piTitleService.setSearchTitle(searchQuery);
      return;
    }

    if (
      params[QueryParams.gallery.sharingKey_params] &&
      params[QueryParams.gallery.sharingKey_params] !== ''
    ) {
      const sharing = await this.shareService.currentSharing
        .pipe(take(1))
        .toPromise();
      const qParams: { [key: string]: any } = {};
      qParams[QueryParams.gallery.sharingKey_query] =
        this.shareService.getSharingKey();
      this.router
        .navigate(['/search', JSON.stringify(sharing.searchQuery)], {queryParams: qParams})
        .catch(console.error);
      return;
    }

    let directoryName = params[QueryParams.gallery.directory];
    directoryName = directoryName || '';

    this.piTitleService.setDirectoryTitle(directoryName);
    this.contentLoader.loadDirectory(directoryName);
  };

  private onContentChange = (content: GroupedDirectoryContent): void => {
    if (!content) {
      return;
    }
    const feedKey = this.getCurrentFeedKey();
    const feedChanged = this.currentFeedKey !== feedKey;
    const previousLoadedMediaCount = this.countMedia(this.directoryContent?.mediaGroups);
    const previousVisibleMediaCount = this.visibleMediaCount || this.feedInitialMediaCount;
    const loadedMediaCount = this.countMedia(content.mediaGroups);

    this.directoryContent = content;
    this.currentFeedKey = feedKey;
    this.totalMediaCount = this.contentLoader.content.value?.directory?.mediaPage?.total || loadedMediaCount;
    if (feedChanged || previousLoadedMediaCount === 0) {
      this.visibleMediaCount = Math.min(this.feedInitialMediaCount, loadedMediaCount);
    } else if (loadedMediaCount > previousLoadedMediaCount) {
      this.visibleMediaCount = Math.min(loadedMediaCount, previousVisibleMediaCount + this.feedBatchMediaCount);
    } else {
      this.visibleMediaCount = Math.min(previousVisibleMediaCount, loadedMediaCount);
    }
    this.updateVisibleDirectoryContent();
    this.updateFeedDebug('content feedChanged=' + feedChanged + ' prevLoaded=' + previousLoadedMediaCount + ' loaded=' + loadedMediaCount + ' prevVisible=' + previousVisibleMediaCount + ' visible=' + this.visibleMediaCount);
    this.scheduleLoadMoreIfNeeded();
  };

  private scheduleLoadMoreIfNeeded(): void {
    if (this.autoLoadMoreScheduled) {
      return;
    }
    this.autoLoadMoreScheduled = true;
    window.setTimeout(() => {
      this.autoLoadMoreScheduled = false;
      this.loadMoreIfNearEnd();
    }, 0);
  }

  private loadMoreIfNearEnd(): void {
    if (!this.directoryContent || this.visibleMediaCount >= this.totalMediaCount) {
      return;
    }
    if (!this.isNearFeedEnd()) {
      return;
    }
    if (this.visibleMediaCount < this.countMedia(this.directoryContent.mediaGroups)) {
      this.extendVisibleMedia();
      return;
    }
    this.contentLoader.loadMoreCurrentDirectory().catch(console.error);
  }

  private isNearFeedEnd(): boolean {
    const progressElement = this.feedProgress?.nativeElement;
    if (progressElement) {
      return progressElement.getBoundingClientRect().top <= window.innerHeight + this.feedScrollThresholdPx;
    }
    return PageHelper.ScrollY >= PageHelper.MaxScrollY - this.feedScrollThresholdPx;
  }

  private extendVisibleMedia(): void {
    const nextLimit = Math.min(
      this.visibleMediaCount + this.feedBatchMediaCount,
      this.totalMediaCount
    );
    if (nextLimit === this.visibleMediaCount) {
      return;
    }
    this.visibleMediaCount = nextLimit;
    this.updateVisibleDirectoryContent();
    this.updateFeedDebug('extend visible=' + this.visibleMediaCount);
  }

  private getCurrentFeedKey(): string {
    const content = this.contentLoader.content.value;
    if (content?.directory) {
      return 'directory:' + (content.directory.path || '') + '/' + (content.directory.name || '');
    }
    if (content?.searchResult) {
      return 'search:' + JSON.stringify(content.searchResult.searchQuery || {});
    }
    return 'empty';
  }

  private updateVisibleDirectoryContent(): void {
    if (!this.directoryContent) {
      this.visibleDirectoryContent = null;
      this.isPhotoWithLocation = false;
      return;
    }

    this.visibleDirectoryContent = {
      directories: this.directoryContent.directories,
      metaFile: this.directoryContent.metaFile,
      mediaGroups: this.sliceMediaGroups(this.directoryContent.mediaGroups, this.visibleMediaCount),
    };
    this.isPhotoWithLocation = this.hasVisiblePhotoWithLocation(this.visibleDirectoryContent.mediaGroups);
  }

  private updateFeedDebug(reason: string): void {
    const first = this.firstVisibleMediaName();
    const last = this.lastVisibleMediaName();
    const loaded = this.countMedia(this.directoryContent?.mediaGroups);
    this.feedDebug = reason + ' | scroll=' + Math.round(PageHelper.ScrollY) + '/' + Math.round(PageHelper.MaxScrollY) +
      ' | visible=' + this.visibleMediaCount + ' loaded=' + loaded + ' total=' + this.totalMediaCount +
      ' | first=' + first + ' | last=' + last + ' | page=' + this.contentLoader.lastDirectoryPageDebug;
  }

  private firstVisibleMediaName(): string {
    const groups = this.visibleDirectoryContent?.mediaGroups || [];
    return groups[0]?.media?.[0]?.name || '-';
  }

  private lastVisibleMediaName(): string {
    const groups = this.visibleDirectoryContent?.mediaGroups || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const media = groups[i].media;
      if (media?.length) {
        return media[media.length - 1].name;
      }
    }
    return '-';
  }

  private sliceMediaGroups(mediaGroups: MediaGroup[], limit: number): MediaGroup[] {
    if (!mediaGroups || limit <= 0) {
      return [];
    }
    const visibleGroups: MediaGroup[] = [];
    let remaining = limit;

    for (const mediaGroup of mediaGroups) {
      if (remaining <= 0) {
        break;
      }
      const media = mediaGroup.media.slice(0, remaining);
      if (media.length > 0) {
        visibleGroups.push({
          name: mediaGroup.name,
          date: mediaGroup.date,
          media,
        });
        remaining -= media.length;
      }
    }

    return visibleGroups;
  }

  private countMedia(mediaGroups: MediaGroup[]): number {
    if (!mediaGroups) {
      return 0;
    }
    return mediaGroups.reduce((count, mediaGroup) => count + mediaGroup.media.length, 0);
  }

  private hasVisiblePhotoWithLocation(mediaGroups: MediaGroup[]): boolean {
    if (!mediaGroups) {
      return false;
    }
    for (const mediaGroup of mediaGroups) {
      if (mediaGroup.media.findIndex((m: PhotoDTO) => !!m.metadata?.positionData?.GPSData?.longitude) !== -1) {
        return true;
      }
    }
    return false;
  }

}
