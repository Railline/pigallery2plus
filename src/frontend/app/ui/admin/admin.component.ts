import {AfterViewInit, Component, ElementRef, OnInit, QueryList, ViewChildren,} from '@angular/core';
import {AuthenticationService} from '../../model/network/authentication.service';
import {UserRoles} from '../../../../common/entities/UserDTO';
import {NotificationService} from '../../model/notification.service';
import {NotificationType} from '../../../../common/entities/NotificationDTO';
import {NavigationService} from '../../model/navigation.service';
import { ViewportScroller, NgIf, NgFor, AsyncPipe, JsonPipe, DatePipe } from '@angular/common';
import {ConfigStyle, SettingsService} from '../settings/settings.service';
import {ConfigPriority} from '../../../../common/config/public/ClientConfig';
import {WebConfig} from '../../../../common/config/private/WebConfig';
import {ISettingsComponent} from '../settings/template/ISettingsComponent';
import {WebConfigClassBuilder} from 'typeconfig/src/decorators/builders/WebConfigClassBuilder';
import {enumToTranslatedArray} from '../EnumTranslations';
import {PiTitleService} from '../../model/pi-title.service';
import { FrameComponent } from '../frame/frame.component';
import { PopoverDirective } from 'ngx-bootstrap/popover';
import { BsDropdownDirective, BsDropdownToggleDirective, BsDropdownMenuDirective } from 'ngx-bootstrap/dropdown';
import { NgIconComponent } from '@ng-icons/core';
import { TemplateComponent } from '../settings/template/template.component';
import { GalleryStatisticComponent } from '../settings/gallery-statistic/gallery-statistic.component';
import { UsersComponent } from '../settings/users/users.component';
import { SharingsListComponent } from '../settings/sharings-list/sharings-list.component';
import { ExtensionInstallerComponent } from '../settings/extension-installer/extension-installer.component';
import { StringifyEnum } from '../../pipes/StringifyEnum';
import {NetworkService} from '../../model/network/network.service';
import {FormsModule} from '@angular/forms';

interface ActivityAuditEntry {
  time?: string;
  action?: string;
  method?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  ip?: string;
  userAgent?: string;
  referer?: string;
  loginUser?: string;
  user?: {
    name?: string;
    role?: unknown;
  };
}

@Component({
    selector: 'app-admin',
    templateUrl: './admin.component.html',
    styleUrls: ['./admin.component.css'],
    imports: [
        FrameComponent,
        NgIf,
        NgFor,
        PopoverDirective,
        BsDropdownDirective,
        BsDropdownToggleDirective,
        BsDropdownMenuDirective,
        NgIconComponent,
        TemplateComponent,
        GalleryStatisticComponent,
        UsersComponent,
        SharingsListComponent,
        ExtensionInstallerComponent,
        AsyncPipe,
        JsonPipe,
        DatePipe,
        StringifyEnum,
        FormsModule,
    ]
})
export class AdminComponent implements OnInit, AfterViewInit {
  @ViewChildren('setting') settingsComponents: QueryList<ISettingsComponent>;
  @ViewChildren('setting', {read: ElementRef})
  settingsComponentsElemRef: QueryList<ElementRef>;
  contents: ISettingsComponent[] = [];
  configPriorities: { key: number; value: string; }[];
  configStyles: { key: number; value: string; }[];
  public readonly ConfigPriority = ConfigPriority;
  public readonly ConfigStyle = ConfigStyle;
  public readonly configPaths: string[] = [];
  public activityAuditEntries: ActivityAuditEntry[] = [];
  public activityAuditLimit = 100;
  public activityAuditLoading = false;
  public activityAuditError = '';
  public activityAuditFilters = {
    user: '',
    action: '',
    ip: '',
    status: '',
    text: '',
    from: '',
    to: '',
  };
  public readonly activityAuditActions = [
    '',
    'gallery',
    'gallery-list',
    'login',
    'logout',
    'random-image',
    'search',
    'share',
    'request',
  ];

  constructor(
    private authService: AuthenticationService,
    private navigation: NavigationService,
    private networkService: NetworkService,
    public viewportScroller: ViewportScroller,
    public notificationService: NotificationService,
    public settingsService: SettingsService,
    private piTitleService: PiTitleService
  ) {
    this.configPriorities = enumToTranslatedArray(ConfigPriority);
    this.configStyles = enumToTranslatedArray(ConfigStyle);
    const wc = WebConfigClassBuilder.attachPrivateInterface(new WebConfig());
    this.configPaths = Object.keys(wc.State)
        .filter(s => !wc.__state[s].volatile);
  }

  ngAfterViewInit(): void {
    setTimeout(() => (this.contents = this.settingsComponents.toArray()), 0);
  }

  ngOnInit(): void {
    if (
      !this.authService.isAuthenticated() ||
      this.authService.user.value.role < UserRoles.Admin
    ) {
      this.navigation.toLogin();
      return;
    }
    this.piTitleService.setTitle($localize`Admin`);
    this.loadActivityAudit().catch(console.error);
  }

  public async loadActivityAudit(): Promise<void> {
    this.activityAuditLoading = true;
    this.activityAuditError = '';
    try {
      this.activityAuditEntries = await this.networkService.getJson<ActivityAuditEntry[]>(
        '/admin/activity-audit',
        this.buildActivityAuditQuery()
      );
    } catch (err) {
      this.activityAuditError = String(err);
    } finally {
      this.activityAuditLoading = false;
    }
  }

  public setActivityAuditLimit(limit: number): void {
    this.activityAuditLimit = limit;
    this.loadActivityAudit().catch(console.error);
  }

  public resetActivityAuditFilters(): void {
    this.activityAuditFilters = {
      user: '',
      action: '',
      ip: '',
      status: '',
      text: '',
      from: '',
      to: '',
    };
    this.loadActivityAudit().catch(console.error);
  }

  public filterActivityAuditBy(field: 'user' | 'ip' | 'action', value?: string): void {
    if (!value) {
      return;
    }
    this.activityAuditFilters[field] = value;
    this.loadActivityAudit().catch(console.error);
  }

  private buildActivityAuditQuery(): { [key: string]: string | number } {
    const query: { [key: string]: string | number } = {
      limit: this.activityAuditLimit,
    };
    for (const [key, value] of Object.entries(this.activityAuditFilters)) {
      const clean = String(value || '').trim();
      if (clean.length > 0) {
        query[key] = clean;
      }
    }
    return query;
  }

  public getCss(type: NotificationType): string {
    switch (type) {
      case NotificationType.error:
        return 'danger';
      case NotificationType.warning:
        return 'warning';
      case NotificationType.info:
        return 'info';
    }
    return 'info';
  }
}
