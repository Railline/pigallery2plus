import {Injectable} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {PhotoDTO} from '../../../../../common/entities/PhotoDTO';
import {DirectoryContent} from '../contentLoader.service';
import {map, switchMap} from 'rxjs/operators';
import {Config} from '../../../../../common/config/public/Config';
import {Utils} from '../../../../../common/Utils';

export enum FilterRenderType {
  enum = 1,
  range = 2,
}

export interface Filter {
  name: string;
  mapFn: (m: PhotoDTO) => (string | number)[] | (string | number);
  renderType: FilterRenderType;
  isArrayValue?: boolean;
}

export interface FilterOption {
  name: string;
  count: number;
  selected: boolean;
}

export interface SelectedFilter {
  filter: Filter;
  options: FilterOption[];
}

@Injectable()
export class FilterService {
  public readonly AVAILABLE_FILTERS: Filter[] = [
    {
      name: $localize`Keywords`,
      mapFn: (m: PhotoDTO): string[] => m.metadata.keywords,
      renderType: FilterRenderType.enum,
      isArrayValue: true,
    },
    {
      name: $localize`Faces`,
      mapFn: (m: PhotoDTO): string[] =>
        m.metadata.faces
          ? m.metadata.faces.map((f) => f.name)
          : ['<' + $localize`no face` + '>'],
      renderType: FilterRenderType.enum,
      isArrayValue: true,
    },
    {
      name: $localize`Faces groups`,
      mapFn: (m: PhotoDTO): string =>
        m.metadata.faces
          ?.map((f) => f.name)
          .sort()
          .join(', '),
      renderType: FilterRenderType.enum,
      isArrayValue: false,
    },
    {
      name: $localize`Caption`,
      mapFn: (m: PhotoDTO): string => m.metadata.caption,
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`Rating`,
      mapFn: (m: PhotoDTO): number => m.metadata.rating,
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`City`,
      mapFn: (m: PhotoDTO): string => m.metadata.positionData?.city,
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`State`,
      mapFn: (m: PhotoDTO): string => m.metadata.positionData?.state,
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`Country`,
      mapFn: (m: PhotoDTO): string => m.metadata.positionData?.country,
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`Camera`,
      mapFn: (m: PhotoDTO): string => m.metadata.cameraData?.model,
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`Lens`,
      mapFn: (m: PhotoDTO): string => m.metadata.cameraData?.lens,
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`ISO`,
      mapFn: (m: PhotoDTO): number => m.metadata.cameraData?.ISO,
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`Aperture`,
      mapFn: (m: PhotoDTO): string => m.metadata.cameraData?.fStop ? `f/${m.metadata.cameraData?.fStop}` : undefined,
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`Shutter speed`,
      mapFn: (m: PhotoDTO): string => {
        const f = m.metadata.cameraData?.exposure;
        if (typeof f === 'undefined') {
          return undefined;
        }
        if (f > 1) {
          return `${f} s`;
        }
        return `1/${Math.round(1 / f)} s`;
      },
      renderType: FilterRenderType.enum,
    },
    {
      name: $localize`Focal length`,
      mapFn: (m: PhotoDTO): string => m.metadata.cameraData?.focalLength ? `${m.metadata.cameraData?.focalLength} mm` : undefined,
      renderType: FilterRenderType.enum,
    },
  ];

  public readonly activeFilters = new BehaviorSubject({
    filtersVisible: false,
    areFiltersActive: false,
    dateFilter: {
      minDate: 0,
      maxDate: Date.now(),
      minFilter: Number.MIN_VALUE,
      maxFilter: Number.MAX_VALUE,
    },
    selectedFilters: [
      {
        filter: this.AVAILABLE_FILTERS[0],
        options: [],
      },
      {
        filter: this.AVAILABLE_FILTERS[1],
        options: [],
      },
      {
        filter: this.AVAILABLE_FILTERS[7],
        options: [],
      },
      {
        filter: this.AVAILABLE_FILTERS[4],
        options: [],
      },
    ],
  });
  public statistic: { date: Date; endDate: Date; dateStr: string; count: number; max: number; }[] = [];

  private getStatistic(prefiltered: DirectoryContent): { date: Date, endDate: Date, dateStr: string, count: number, max: number }[] {
    if (!prefiltered ||
      !prefiltered.media ||
      prefiltered.media.length === 0) {
      return [];
    }
    const ret: { date: Date, endDate: Date, dateStr: string, count: number, max: number }[] = [];
    let minDate = Number.MAX_VALUE - 1;
    let maxDate = Number.MIN_VALUE + 1;
    const mediaTimes = new Array<number>(prefiltered.media.length);
    prefiltered.media.forEach((media, index) => {
      const mediaTime = Utils.getTimeMS(
        media.metadata.creationDate,
        media.metadata.creationDateOffset,
        Config.Gallery.ignoreTimestampOffset
      );
      mediaTimes[index] = mediaTime;
      minDate = Math.min(minDate, mediaTime);
      maxDate = Math.max(maxDate, mediaTime);
    });
    const diff = (maxDate - minDate) / 1000;
    const H = 60 * 60;
    const D = H * 24;
    const M = D * 30;
    const Y = D * 365;
    const Y2 = Y * 2;
    const Y5 = Y * 5;
    const Dec = Y * 10;
    const Dec2 = Y * 20;
    const Dec5 = Y * 50;
    const Sen = Y * 100;
    const divs = [H, D, M, Y, Y2, Y5, Dec, Dec2, Dec5, Sen];

    // finding the resolution
    let usedDiv = H;
    for (let i = 0; i < divs.length; ++i) {
      if (diff / divs[i] < 26) {
        usedDiv = divs[i];
        break;
      }
    }

    // getting the first date (truncated to the resolution)
    const floorDate = (ts: number): number => {
      let d = new Date(ts);
      if (usedDiv >= Y) {
        const fy = (d.getFullYear());
        d = new Date(fy - fy % (usedDiv / Y), 0, 1);
      } else if (usedDiv === M) {
        d = new Date(d.getFullYear(), d.getMonth(), 1);
      } else {
        d = new Date(ts - ts % usedDiv);
      }
      return d.getTime();
    };

    const startMediaDate = new Date(floorDate(minDate));
    const startMediaTime = startMediaDate.getTime();
    const getDate = (index: number): Date => {
      if (usedDiv >= Y) {
        return new Date(startMediaDate.getFullYear() + (index * (usedDiv / Y)), 0, 1);
      }
      if (usedDiv === M) {
        return new Date(startMediaDate.getFullYear(), startMediaDate.getMonth() + index, 1);
      }
      if (usedDiv === D) {
        return new Date(startMediaDate.getFullYear(), startMediaDate.getMonth(), startMediaDate.getDate() + index, 1);
      }
      return new Date(startMediaTime + (index * usedDiv * 1000));
    };
    const dateFormat = usedDiv >= Y
      ? 'y'
      : usedDiv === M
        ? 'y MMM'
        : usedDiv === D
          ? 'EEE'
          : 'HH';

    mediaTimes.forEach((mediaTime) => {
      const key = Math.floor((floorDate(mediaTime) - startMediaTime) / 1000 / usedDiv);
      // extending the array
      while (ret.length <= key) {
        ret.push({date: getDate(ret.length), endDate: getDate(ret.length + 1), dateStr: dateFormat, count: 0, max: 0});
      }

      ret[key].count++;
    });

    // don't show if there is only one column
    if (ret.length <= 1) {
      return [];
    }

    const max = ret.reduce((p, c) => Math.max(p, c.count), 0);
    ret.forEach(v => v.max = max);
    return ret;
  }

  public applyFilters(
    directoryContent: Observable<DirectoryContent>
  ): Observable<DirectoryContent> {
    return directoryContent.pipe(
      switchMap((dirContent: DirectoryContent) => {
        this.statistic = this.getStatistic(dirContent);
        this.resetFilters(false);
        return this.activeFilters.pipe(
          map((afilters) => {
            if (!dirContent || !dirContent.media || (!afilters.filtersVisible && !afilters.areFiltersActive)) {
              return dirContent;
            }

            // clone, so the original won't get overwritten
            const c = {
              media: dirContent.media,
              directories: dirContent.directories,
              metaFile: dirContent.metaFile,
            };

            /* Date Selector */
            if (c.media.length > 0) {
              // Update date filter range
              afilters.dateFilter.minDate = Number.MAX_VALUE - 1;
              afilters.dateFilter.maxDate = Number.MIN_VALUE + 1;
              const mediaTimes = new Array<number>(c.media.length);
              c.media.forEach((media, index) => {
                const mediaTime = Utils.getTimeMS(
                  media.metadata.creationDate,
                  media.metadata.creationDateOffset,
                  Config.Gallery.ignoreTimestampOffset
                );
                mediaTimes[index] = mediaTime;
                afilters.dateFilter.minDate = Math.min(afilters.dateFilter.minDate, mediaTime);
                afilters.dateFilter.maxDate = Math.max(afilters.dateFilter.maxDate, mediaTime);
              });
              // Add a few sec padding
              afilters.dateFilter.minDate -= ((afilters.dateFilter.minDate % 1000) + 1000);
              afilters.dateFilter.maxDate += ((1000 - (afilters.dateFilter.maxDate % 1000)) + 1000);

              if (afilters.dateFilter.minFilter === Number.MIN_VALUE) {
                afilters.dateFilter.minFilter = afilters.dateFilter.minDate;
              }
              if (afilters.dateFilter.maxFilter === Number.MAX_VALUE) {
                afilters.dateFilter.maxFilter = afilters.dateFilter.maxDate;
              }

              // Apply Date filter
              c.media = c.media.filter((_media, index) => {
                const mediaTime = mediaTimes[index];
                return mediaTime >= afilters.dateFilter.minFilter &&
                  mediaTime <= afilters.dateFilter.maxFilter;
              });
            } else {
              afilters.dateFilter.minDate = Number.MIN_VALUE;
              afilters.dateFilter.maxDate = Number.MAX_VALUE;
              afilters.dateFilter.minFilter = Number.MIN_VALUE;
              afilters.dateFilter.maxFilter = Number.MAX_VALUE;
            }

            // filters
            for (const f of afilters.selectedFilters) {

              /* Update filter options */
              const valueMap: { [key: string]: { name: string | number, count: number, selected: boolean } } = {};
              f.options.forEach((o) => {
                valueMap[o.name] = o;
                o.count = 0; // reset count so unknown options can be removed at the end
              });
              if (f.filter.isArrayValue) {
                c.media.forEach((m) => {
                  (f.filter.mapFn(m as PhotoDTO) as string[])?.forEach((v) => {
                    valueMap[v] = valueMap[v] || {
                      name: v,
                      count: 0,
                      selected: true,
                    };
                    valueMap[v].count++;
                  });
                });
              } else {
                c.media.forEach((m) => {
                  const key = f.filter.mapFn(m as PhotoDTO) as string;
                  valueMap[key] = valueMap[key] || {
                    name: key,
                    count: 0,
                    selected: true,
                  };
                  valueMap[key].count++;
                });
              }
              f.options = Object.values(valueMap)
                .filter((o) => o.count > 0)
                // sort by count and alpha. if counts are the same
                .sort((a, b) =>
                  a.count == b.count && (a.name !== undefined && b.name !== undefined) ?
                    Number.isFinite(a.name) && Number.isFinite(b.name) ? (a.name as number) - (b.name as number) : a.name.toString().localeCompare(b.name.toString()) :
                    b.count - a.count);

              /* Apply filters */
              const unselectedOptions = f.options.filter((option) => !option.selected);
              if (unselectedOptions.length > 0) {
                if (f.filter.isArrayValue) {
                  const selectedOptions = new Set(
                    f.options
                      .filter((option) => option.selected && !Object.is(option.name, Number.NaN))
                      .map((option) => option.name)
                  );
                  c.media = c.media.filter((m) => {
                    const mapped = f.filter.mapFn(m as PhotoDTO) as string[];
                    if (!mapped) {
                      return true;
                    }
                    // Keep photos that have at least one of the selected values
                    return mapped.some((value) => !Object.is(value, Number.NaN) && selectedOptions.has(value));
                  });
                } else {
                  const unselectedNames = new Set(
                    unselectedOptions
                      .filter((option) => !Object.is(option.name, Number.NaN))
                      .map((option) => option.name)
                  );
                  c.media = c.media.filter((m) => {
                    const mapped = f.filter.mapFn(m as PhotoDTO) as string;
                    return Object.is(mapped, Number.NaN) || !unselectedNames.has(mapped);
                  });
                }
              }
            }
            // If the number of photos did not change, the filters are not active
            afilters.areFiltersActive = c.media.length !== dirContent.media.length;
            return c;
          })
        );
      })
    );
  }

  public onFilterChange(): void {
    this.activeFilters.next(this.activeFilters.value);
  }

  setShowingFilters(value: boolean): void {
    if (this.activeFilters.value.filtersVisible === value) {
      return;
    }
    this.activeFilters.value.filtersVisible = value;
    if ((!this.activeFilters.value.filtersVisible && !this.activeFilters.value.areFiltersActive)) {
      this.resetFilters(false);
    }
    this.onFilterChange();
  }

  resetFilters(triggerChangeDetection = true): void {
    this.activeFilters.value.dateFilter.minFilter = Number.MIN_VALUE;
    this.activeFilters.value.dateFilter.maxFilter = Number.MAX_VALUE;
    this.activeFilters.value.selectedFilters.forEach((f) => (f.options = []));
    if (triggerChangeDetection) {
      this.onFilterChange();
    }
  }
}
