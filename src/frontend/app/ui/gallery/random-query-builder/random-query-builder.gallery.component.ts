import {Component, OnDestroy, OnInit, TemplateRef} from '@angular/core';
import {ContentWrapper} from '../../../../../common/entities/ContentWrapper';
import {Config} from '../../../../../common/config/public/Config';
import {NotificationService} from '../../../model/notification.service';
import {BsModalService} from 'ngx-bootstrap/modal';
import {BsModalRef} from 'ngx-bootstrap/modal/bs-modal-ref.service';
import {NetworkService} from '../../../model/network/network.service';
import {Subscription} from 'rxjs';
import {
  SearchQueryDTO,
  SearchQueryTypes,
  TextSearch,
  TextSearchQueryMatchTypes,
} from '../../../../../common/entities/SearchQueryDTO';
import {ActivatedRoute, Params} from '@angular/router';
import {QueryParams} from '../../../../../common/QueryParams';
import {SearchQueryParserService} from '../search/search-query-parser.service';
import {ContentLoaderService} from '../contentLoader.service';
import { NgIconComponent } from '@ng-icons/core';
import { FormsModule } from '@angular/forms';
import { ClipboardModule } from 'ngx-clipboard';
import { GallerySearchQueryBuilderComponent } from '../search/query-builder/query-bulder.gallery.component';
import {SearchQueryUtils} from '../../../../../common/SearchQueryUtils';
import {ShareService} from '../share.service';
import {Utils} from '../../../../../common/Utils';
import {SharingsListComponent} from '../../settings/sharings-list/sharings-list.component';

@Component({
    selector: 'app-gallery-random-query-builder',
    templateUrl: './random-query-builder.gallery.component.html',
    styleUrls: ['./random-query-builder.gallery.component.css'],
    imports: [
        NgIconComponent,
        FormsModule,
        ClipboardModule,
        GallerySearchQueryBuilderComponent,
        SharingsListComponent,
    ]
})
export class RandomQueryBuilderGalleryComponent implements OnInit, OnDestroy {
  public searchQueryDTO: SearchQueryDTO = {
    type: SearchQueryTypes.any_text,
    value: '',
  } as TextSearch;
  enabled = true;
  url = '';
  private currentDirectoryQuery: SearchQueryDTO = null;
  private readonly randomShareKeys = new Map<string, string>();
  private urlGenerationSeq = 0;

  contentSubscription: Subscription = null;

  modalRef: BsModalRef;

  private readonly subscription: Subscription = null;

  constructor(
      public contentLoaderService: ContentLoaderService,
      private notification: NotificationService,
      private searchQueryParserService: SearchQueryParserService,
      private route: ActivatedRoute,
      private modalService: BsModalService,
      private shareService: ShareService
  ) {
    this.subscription = this.route.params.subscribe((params: Params) => {
      if (!params[QueryParams.gallery.search.query]) {
        return;
      }
      const searchQuery = JSON.parse(params[QueryParams.gallery.search.query]);
      if (searchQuery) {
        this.searchQueryDTO = searchQuery;
        this.onQueryChange();
      }
    });
  }

  get HTMLSearchQuery(): string {
    return SearchQueryUtils.urlify(this.getRandomSearchQuery());
  }

  onQueryChange(): void {
    if (this.modalRef) {
      this.updateRandomUrl(true).catch(console.error);
    }
  }

  private async updateRandomUrl(includeSharingKey = false): Promise<void> {
    const seq = ++this.urlGenerationSeq;
    const query = this.getRandomSearchQuery();
    const htmlSearchQuery = SearchQueryUtils.urlify(query);
    let url = Config.Server.publicUrl + Config.Server.apiPath + '/gallery/random/' + encodeURIComponent(htmlSearchQuery);
    if (includeSharingKey) {
      const sharingKey = await this.getSharingKeyForRandomQuery(query, htmlSearchQuery);
      if (seq !== this.urlGenerationSeq) {
        return;
      }
      if (sharingKey) {
        url = Config.Server.publicUrl + Config.Server.apiPath + '/gallery/random-link/' + encodeURIComponent(sharingKey);
      }
    }
    this.url = NetworkService.buildUrl(url);
  }

  private async getSharingKeyForRandomQuery(query: SearchQueryDTO, key: string): Promise<string> {
    const currentSharingKey = this.shareService.getSharingKey();
    if (currentSharingKey) {
      return currentSharingKey;
    }
    if (!Config.Sharing.enabled || Config.Sharing.passwordRequired) {
      return null;
    }
    if (this.randomShareKeys.has(key)) {
      return this.randomShareKeys.get(key);
    }

    try {
      this.url = $localize`loading..`;
      const existingShares = await this.shareService.getSharingListForQuery(query);
      const reusableShare = (existingShares || []).find((share) =>
        !share.passwordProtected && (share.expires < 0 || share.expires > Date.now()));
      const sharingKey = reusableShare?.sharingKey ||
        (await this.shareService.createSharingByQuery(query, '', 30 * 24 * 60 * 60 * 1000)).sharingKey;
      this.randomShareKeys.set(key, sharingKey);
      return sharingKey;
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  private getRandomSearchQuery(): SearchQueryDTO {
    const filterQuery = SearchQueryUtils.isQueryEmpty(this.searchQueryDTO) ? null : this.searchQueryDTO;
    if (this.currentDirectoryQuery && filterQuery) {
      return {
        type: SearchQueryTypes.AND,
        list: [this.currentDirectoryQuery, filterQuery],
      } as SearchQueryDTO;
    }
    return this.currentDirectoryQuery || filterQuery || this.searchQueryDTO;
  }

  ngOnInit(): void {
    this.contentSubscription = this.contentLoaderService.content.subscribe(
        (content: ContentWrapper) => {
          this.enabled = !!content?.directory;
          if (!this.enabled) {
            return;
          }
          this.currentDirectoryQuery = {
            type: SearchQueryTypes.directory,
            value: Utils.concatUrls('./', content.directory.path, content.directory.name),
            matchType: TextSearchQueryMatchTypes.exact_match,
          } as TextSearch;
        }
    );
  }

  ngOnDestroy(): void {
    if (this.contentSubscription !== null) {
      this.contentSubscription.unsubscribe();
    }

    if (this.subscription !== null) {
      this.subscription.unsubscribe();
    }
  }

  openModal(template: TemplateRef<unknown>): boolean {
    if (!this.enabled) {
      return;
    }
    if (this.modalRef) {
      this.modalRef.hide();
    }

    this.modalRef = this.modalService.show(template, {class: 'modal-lg'});
    document.body.style.paddingRight = '0px';
    this.updateRandomUrl(true).catch(console.error);
    return false;
  }

  onCopy(): void {
    this.notification.success($localize`Url has been copied to clipboard`);
  }

  public hideModal(): void {
    this.modalRef.hide();
    this.modalRef = null;
  }
}
