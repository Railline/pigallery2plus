import {Component, OnInit} from '@angular/core';
import {ResponseSharingDTO} from '../../../../../common/entities/SharingDTO';
import {SettingsService} from '../settings.service';
import {ShareService} from '../../gallery/share.service';
import { NgIf, NgFor, DatePipe } from '@angular/common';
import { NgIconComponent } from '@ng-icons/core';
import { StringifySearchQuery } from '../../../pipes/StringifySearchQuery';
import {FormsModule} from '@angular/forms';
import {SearchQueryDTO} from '../../../../../common/entities/SearchQueryDTO';
import {SearchQueryParserService} from '../../gallery/search/search-query-parser.service';
import {SearchQueryUtils} from '../../../../../common/SearchQueryUtils';
import {Utils} from '../../../../../common/Utils';
import {Config} from '../../../../../common/config/public/Config';
import {NotificationService} from '../../../model/notification.service';

@Component({
    selector: 'app-settigns-sharings-list',
    templateUrl: './sharings-list.component.html',
    styleUrls: ['./sharings-list.component.css'],
    imports: [NgIf, NgFor, NgIconComponent, DatePipe, StringifySearchQuery, FormsModule]
})
export class SharingsListComponent implements OnInit {

  public shares: ResponseSharingDTO[] = [];
  public editingShare: ResponseSharingDTO = null;
  public editQueryText = '';
  public editExpiresAt = '';
  public editForever = false;
  public editRandomUrl = '';
  public editError = '';
  public saving = false;


  constructor(public sharingService: ShareService,
              public settingsService: SettingsService,
              private searchQueryParserService: SearchQueryParserService,
              private notification: NotificationService) {
  }


  ngOnInit(): void {
    this.getSharingList();
  }

  get Enabled(): boolean {
    return this.settingsService.settings.value.Sharing.enabled;
  }

  async deleteSharing(sharing: ResponseSharingDTO): Promise<void> {
    await this.sharingService.deleteSharing(sharing);
    await this.getSharingList();
  }

  startEdit(share: ResponseSharingDTO): void {
    this.editingShare = share;
    this.editQueryText = this.searchQueryParserService.stringify(share.searchQuery);
    this.editForever = share.expires > new Date(9000, 0, 1).getTime();
    this.editExpiresAt = this.editForever ? '' : this.toLocalDateTimeInput(share.expires);
    this.editError = '';
    this.saving = false;
    this.updateRandomUrlPreview();
  }

  cancelEdit(): void {
    this.editingShare = null;
    this.editQueryText = '';
    this.editExpiresAt = '';
    this.editForever = false;
    this.editRandomUrl = '';
    this.editError = '';
    this.saving = false;
  }

  updateRandomUrlPreview(): void {
    this.editError = '';
    this.editRandomUrl = '';
    if (!this.editingShare) {
      return;
    }
    try {
      const query = this.parseEditQuery();
      this.editRandomUrl = this.getRandomUrl(this.editingShare, query);
    } catch (e) {
      this.editError = (e as Error)?.message || e as string;
    }
  }

  async saveEdit(): Promise<void> {
    if (!this.editingShare) {
      return;
    }
    this.saving = true;
    this.editError = '';
    try {
      const query = this.parseEditQuery();
      const valid = this.calcEditValidity();
      const updated = await this.sharingService.updateSharingByQuery(
        this.editingShare.id,
        query,
        undefined,
        valid
      );
      this.notification.success($localize`Sharing link updated`);
      await this.getSharingList();
      this.startEdit(updated);
    } catch (e) {
      this.editError = (e as Error)?.message || e as string;
      this.notification.error(this.editError, $localize`Sharing error`);
    } finally {
      this.saving = false;
    }
  }

  getRandomUrl(share: ResponseSharingDTO, query: SearchQueryDTO = share.searchQuery): string {
    return Utils.concatUrls(
      Config.Server.publicUrl,
      '/pgapi/gallery/random-link/',
      encodeURIComponent(share.sharingKey)
    );
  }

  private parseEditQuery(): SearchQueryDTO {
    const query = this.searchQueryParserService.parse(this.editQueryText || '');
    SearchQueryUtils.validateSearchQuery(query);
    return query;
  }

  private calcEditValidity(): number {
    if (this.editForever) {
      return -1;
    }
    const expires = new Date(this.editExpiresAt).getTime();
    if (!Number.isFinite(expires)) {
      throw new Error($localize`Invalid expiration date`);
    }
    const valid = expires - Date.now();
    if (valid <= 0) {
      throw new Error($localize`Expiration date must be in the future`);
    }
    return valid;
  }

  private toLocalDateTimeInput(timestamp: number): string {
    const d = new Date(timestamp);
    const pad = (n: number): string => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private async getSharingList(): Promise<void> {
    try {
      this.shares = await this.sharingService.getSharingList();
    } catch (err) {
      this.shares = [];
      throw err;
    }
  }

}
