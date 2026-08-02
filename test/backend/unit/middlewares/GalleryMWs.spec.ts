/* eslint-disable no-unused-expressions,@typescript-eslint/no-unused-expressions */
import * as path from 'path';
import {expect} from 'chai';
import {Config} from '../../../../src/common/config/private/Config';
import {GalleryMWs} from '../../../../src/backend/middlewares/GalleryMWs';
import {ContentWrapper} from '../../../../src/common/entities/ContentWrapper';
import {MediaDTO} from '../../../../src/common/entities/MediaDTO';
import {ParentDirectoryDTO} from '../../../../src/common/entities/DirectoryDTO';
import {DatabaseType} from '../../../../src/common/config/private/PrivateConfig';
import {ObjectManagers} from '../../../../src/backend/model/ObjectManagers';
import {QueryParams} from '../../../../src/common/QueryParams';
import {SearchQueryTypes} from '../../../../src/common/entities/SearchQueryDTO';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';
import {PhotoProcessing} from '../../../../src/backend/model/fileaccess/fileprocessing/PhotoProcessing';
import {ThumbnailSourceType} from '../../../../src/backend/model/fileaccess/PhotoWorker';

declare const before: any;
declare const describe: any;
declare const it: any;

function makePhoto(name: string, dirPath: string, dirName: string, contentIdentifier?: string): MediaDTO {
  return {
    id: 0,
    name,
    directory: {path: dirPath, name: dirName},
    metadata: {
      size: {width: 100, height: 100},
      creationDate: Date.now(),
      fileSize: 1000,
      contentIdentifier,
    } as any,
  } as MediaDTO;
}

function makeVideo(name: string, dirPath: string, dirName: string, contentIdentifier?: string): MediaDTO {
  return {
    id: 0,
    name,
    directory: {path: dirPath, name: dirName},
    metadata: {
      size: {width: 100, height: 100},
      creationDate: Date.now(),
      fileSize: 1000,
      bitRate: 1000,
      duration: 3000,
      fps: 30,
      contentIdentifier,
    } as any,
  } as MediaDTO;
}

describe('GalleryMWs', () => {
  before(() => {
    Config.loadSync();
    Config.Database.type = DatabaseType.sqlite;
    Config.Extensions.enabled = false;
  });

  describe('search request hardening', () => {
    it('should reject a parsed query containing unknown fields', (done: (err?: any) => void) => {
      const req: any = {
        params: {
          searchQueryDTO: '{"t":104,"v":"x","unexpected":true}',
        },
      };

      GalleryMWs.parseSearchQuery(req, null, ((err?: ErrorDTO) => {
        try {
          expect(err).to.be.instanceOf(ErrorDTO);
          expect(err.code).to.equal(ErrorCodes.INPUT_ERROR);
          expect(req.resultPipe).to.be.undefined;
          done();
        } catch (e) {
          done(e);
        }
      }) as any);
    });

    it('should cap client-requested search pages to 1000 media', async () => {
      const managers = ObjectManagers.getInstance();
      const originalSearchManager = managers.SearchManager;
      const previousEnabled = Config.Search.enabled;
      const previousMax = Config.Search.maxMediaResult;
      let capturedPaging: {offset: number; limit: number};

      try {
        Config.Search.enabled = true;
        Config.Search.maxMediaResult = 10000;
        managers.SearchManager = {
          search: async (_context: unknown, _query: unknown, paging: {offset: number; limit: number}) => {
            capturedPaging = paging;
            return {
              directories: [] as any[],
              media: [] as any[],
              metaFile: [] as any[],
              resultOverflow: false,
            };
          },
        } as any;
        const req: any = {
          resultPipe: {type: SearchQueryTypes.keyword, value: 'x'},
          query: {
            [QueryParams.gallery.mediaOffset]: '25',
            [QueryParams.gallery.mediaLimit]: '999999999',
          },
          session: {context: {}},
        };
        let nextError: unknown;

        await GalleryMWs.search(req, null, (err?: unknown) => {
          nextError = err;
        });

        expect(nextError).to.be.undefined;
        expect(capturedPaging).to.deep.equal({offset: 25, limit: 1000});
      } finally {
        managers.SearchManager = originalSearchManager;
        Config.Search.enabled = previousEnabled;
        Config.Search.maxMediaResult = previousMax;
      }
    });
  });

  describe('public random sharing links', () => {
    it('should generate a bounded 1080p-class preview and disable response caching', async () => {
      const originalGenerateThumbnail = PhotoProcessing.generateThumbnail;
      const originalFindExistingThumbnail = PhotoProcessing.findExistingThumbnail;
      const originalThumbnailSizes = Config.Media.Photo.thumbnailSizes.slice();
      let generated: {path: string; size: number; type: ThumbnailSourceType; square: boolean};
      const headers = new Map<string, string>();

      try {
        Config.Media.Photo.thumbnailSizes = [320, 1080, 2048];
        PhotoProcessing.findExistingThumbnail = async () => null;
        PhotoProcessing.generateThumbnail = async (mediaPath, size, type, makeSquare) => {
          generated = {path: mediaPath, size, type, square: makeSquare};
          return '/tmp/cached-preview.webp';
        };
        const req: any = {resultPipe: '/media/original.jpg', query: {}};
        const res: any = {setHeader: (name: string, value: string) => headers.set(name, value)};
        let nextCalls = 0;

        await GalleryMWs.loadRandomImagePreview(req, res, () => nextCalls++);

        expect(generated).to.deep.equal({
          path: '/media/original.jpg',
          size: 1080,
          type: ThumbnailSourceType.Photo,
          square: false,
        });
        expect(req.resultPipe).to.equal('/tmp/cached-preview.webp');
        expect(headers.get('Cache-Control')).to.equal('no-store');
        expect(nextCalls).to.equal(1);
      } finally {
        PhotoProcessing.generateThumbnail = originalGenerateThumbnail;
        PhotoProcessing.findExistingThumbnail = originalFindExistingThumbnail;
        Config.Media.Photo.thumbnailSizes = originalThumbnailSizes;
      }
    });

    it('should prefer the largest preview that is already cached', async () => {
      const originalGenerateThumbnail = PhotoProcessing.generateThumbnail;
      const originalFindExistingThumbnail = PhotoProcessing.findExistingThumbnail;
      const originalThumbnailSizes = Config.Media.Photo.thumbnailSizes.slice();
      let generationCalls = 0;

      try {
        Config.Media.Photo.thumbnailSizes = [320, 1080, 2048];
        PhotoProcessing.findExistingThumbnail = async (_mediaPath, sizes) => {
          expect(sizes).to.deep.equal([320, 1080, 2048]);
          return '/tmp/existing-2048-preview.webp';
        };
        PhotoProcessing.generateThumbnail = async () => {
          generationCalls++;
          return '/tmp/generated-preview.webp';
        };
        const req: any = {resultPipe: '/media/original.jpg', query: {}};
        const res: any = {setHeader: (): void => undefined};

        await GalleryMWs.loadRandomImagePreview(req, res, () => undefined);

        expect(generationCalls).to.equal(0);
        expect(req.resultPipe).to.equal('/tmp/existing-2048-preview.webp');
      } finally {
        PhotoProcessing.generateThumbnail = originalGenerateThumbnail;
        PhotoProcessing.findExistingThumbnail = originalFindExistingThumbnail;
        Config.Media.Photo.thumbnailSizes = originalThumbnailSizes;
      }
    });

    it('should select the nearest allowed random preview size', async () => {
      const originalGenerateThumbnail = PhotoProcessing.generateThumbnail;
      const originalFindExistingThumbnail = PhotoProcessing.findExistingThumbnail;
      const originalThumbnailSizes = Config.Media.Photo.thumbnailSizes.slice();
      let selectedSize: number;

      try {
        Config.Media.Photo.thumbnailSizes = [320, 1080, 2048];
        PhotoProcessing.findExistingThumbnail = async () => null;
        PhotoProcessing.generateThumbnail = async (_mediaPath, size) => {
          selectedSize = size;
          return '/tmp/cached-preview.webp';
        };
        const req: any = {resultPipe: '/media/original.jpg', query: {size: '1000'}};
        const res: any = {setHeader: (): void => undefined};

        await GalleryMWs.loadRandomImagePreview(req, res, () => undefined);

        expect(selectedSize).to.equal(1080);
      } finally {
        PhotoProcessing.generateThumbnail = originalGenerateThumbnail;
        PhotoProcessing.findExistingThumbnail = originalFindExistingThumbnail;
        Config.Media.Photo.thumbnailSizes = originalThumbnailSizes;
      }
    });

    it('should preserve the source file when the original size is requested', async () => {
      const originalGenerateThumbnail = PhotoProcessing.generateThumbnail;
      const headers = new Map<string, string>();
      let generationCalls = 0;

      try {
        PhotoProcessing.generateThumbnail = async () => {
          generationCalls++;
          return '/tmp/cached-preview.webp';
        };
        const req: any = {resultPipe: '/media/original.jpg', query: {size: 'original'}};
        const res: any = {setHeader: (name: string, value: string) => headers.set(name, value)};

        await GalleryMWs.loadRandomImagePreview(req, res, () => undefined);

        expect(generationCalls).to.equal(0);
        expect(req.resultPipe).to.equal('/media/original.jpg');
        expect(headers.get('Cache-Control')).to.equal('no-store');
      } finally {
        PhotoProcessing.generateThumbnail = originalGenerateThumbnail;
      }
    });

    it('should coalesce concurrent random cache refills', async () => {
      const managers = ObjectManagers.getInstance();
      const originalSearchManager = managers.SearchManager;
      const previousEnabled = Config.RandomPhoto.enabled;
      const randomCache = (GalleryMWs as any).randomMediaPathCache as Map<string, unknown>;
      let resolvePaths: (paths: string[]) => void;
      const pendingPaths = new Promise<string[]>((resolve) => {
        resolvePaths = resolve;
      });
      let calls = 0;

      try {
        Config.RandomPhoto.enabled = true;
        randomCache.clear();
        managers.SearchManager = {
          getRandomMediaPaths: async () => {
            calls++;
            return pendingPaths;
          },
        } as any;
        const makeRequest = (): any => ({
          resultPipe: {type: SearchQueryTypes.keyword, value: 'x'},
          params: {},
          query: {},
          session: {context: {user: {projectionKey: 'same-user'}}},
        });
        const first = makeRequest();
        const second = makeRequest();

        const firstCall = GalleryMWs.getRandomImage(first, {} as any, () => undefined);
        const secondCall = GalleryMWs.getRandomImage(second, {} as any, () => undefined);
        await Promise.resolve();
        expect(calls).to.equal(1);

        resolvePaths(['one.jpg', 'two.jpg']);
        await Promise.all([firstCall, secondCall]);

        expect(calls).to.equal(1);
        expect(first.params.mediaPath).to.be.oneOf(['one.jpg', 'two.jpg']);
        expect(second.params.mediaPath).to.be.oneOf(['one.jpg', 'two.jpg']);
        expect(first.params.mediaPath).to.not.equal(second.params.mediaPath);
      } finally {
        randomCache.clear();
        managers.SearchManager = originalSearchManager;
        Config.RandomPhoto.enabled = previousEnabled;
      }
    });

    it('should reject password-protected shares', async () => {
      const managers = ObjectManagers.getInstance();
      const originalSharingManager = managers.SharingManager;
      const previousPasswordRequired = Config.Sharing.passwordRequired;
      let statusCode: number;
      let nextError: ErrorDTO;

      try {
        Config.Sharing.passwordRequired = false;
        managers.SharingManager = {
          findOne: async () => ({
            sharingKey: 'secret-key',
            expires: Date.now() + 10000,
            password: 'password-hash',
            searchQuery: {type: SearchQueryTypes.keyword, value: 'x'},
          }),
        } as any;
        const req: any = {params: {sharingKey: 'secret-key'}, query: {}, session: {}};
        const res: any = {status: (code: number) => statusCode = code};

        await GalleryMWs.loadRandomLinkQuery(req, res, ((err?: ErrorDTO) => {
          nextError = err;
        }) as any);

        expect(statusCode).to.equal(403);
        expect(nextError?.code).to.equal(ErrorCodes.NOT_AUTHORISED);
        expect(req.randomLinkContext).to.be.undefined;
      } finally {
        managers.SharingManager = originalSharingManager;
        Config.Sharing.passwordRequired = previousPasswordRequired;
      }
    });

    it('should keep the share ACL request-scoped without replacing the session', async () => {
      const managers = ObjectManagers.getInstance();
      const originalSharingManager = managers.SharingManager;
      const originalSessionManager = managers.SessionManager;
      const previousPasswordRequired = Config.Sharing.passwordRequired;
      const existingContext = {user: {id: 42, name: 'user'}};
      const randomContext = {user: {id: null as number, name: 'Guest', usedSharingKey: 'public-key'}};

      try {
        Config.Sharing.passwordRequired = false;
        managers.SharingManager = {
          findOne: async () => ({
            sharingKey: 'public-key',
            expires: Date.now() + 10000,
            password: null as string,
            creator: {id: 1},
            searchQuery: {type: SearchQueryTypes.keyword, value: 'x'},
          }),
        } as any;
        managers.SessionManager = {
          buildAllowListForSharing: () => ({type: SearchQueryTypes.keyword, value: 'x'}),
          buildContext: async () => randomContext,
        } as any;
        const req: any = {
          params: {sharingKey: 'public-key'},
          query: {},
          session: {context: existingContext},
        };
        let nextError: unknown;

        await GalleryMWs.loadRandomLinkQuery(req, {} as any, (err?: unknown) => {
          nextError = err;
        });

        expect(nextError).to.be.undefined;
        expect(req.session.context).to.equal(existingContext);
        expect(req.randomLinkContext).to.equal(randomContext);
      } finally {
        managers.SharingManager = originalSharingManager;
        managers.SessionManager = originalSessionManager;
        Config.Sharing.passwordRequired = previousPasswordRequired;
      }
    });
  });

  describe('cleanUpGalleryResults - Live Photo pairing', () => {
    it('should pair photo with companion video by contentIdentifier', (done: (err?: any) => void) => {
      Config.Media.LivePhoto.enabled = true;
      Config.Media.Video.enabled = true;

      const photo = makePhoto('IMG_7943.HEIC', '.', 'vacation', '42A4A5ED-897B-46BF-84D2-FF2D0E90D7EB');
      const video = makeVideo('IMG_7943_HEVC.MOV', '.', 'vacation', '42A4A5ED-897B-46BF-84D2-FF2D0E90D7EB');

      const cw: ContentWrapper = {
        directory: {
          path: '.',
          name: 'vacation',
          media: [photo, video],
          directories: [],
          metaFile: [],
        } as ParentDirectoryDTO,
        searchResult: null,
      };

      const req: any = {resultPipe: cw};
      const next: any = (err: any) => {
        try {
          expect(err).to.be.undefined;
          const packed = req.resultPipe;
          expect(packed).to.not.be.undefined;
          // Packed format uses 'n' for name, 'l' for liveVideoPath
          expect(packed.directory.media.length).to.equal(1);
          expect(packed.directory.media[0]['n']).to.equal('IMG_7943.HEIC');
          expect(packed.directory.media[0]['l']).to.equal(path.join('vacation', 'IMG_7943_HEVC.MOV'));
          // contentIdentifier should be stripped from the response
          expect(packed.directory.media[0]['m']?.contentIdentifier).to.be.undefined;
          done();
        } catch (err) {
          done(err);
        }
      };
      GalleryMWs.cleanUpGalleryResults(req, null, next);
    });

    it('should not pair when contentIdentifiers do not match', (done: (err?: any) => void) => {
      Config.Media.LivePhoto.enabled = true;
      Config.Media.Video.enabled = true;

      const photo = makePhoto('IMG_7943.HEIC', '.', 'vacation', 'AAAA-BBBB');
      const video = makeVideo('IMG_7943_HEVC.MOV', '.', 'vacation', 'CCCC-DDDD');

      const cw: ContentWrapper = {
        directory: {
          path: '.',
          name: 'vacation',
          media: [photo, video],
          directories: [],
          metaFile: [],
        } as ParentDirectoryDTO,
        searchResult: null,
      };

      const req: any = {resultPipe: cw};
      const next: any = (err: any) => {
        try {
          expect(err).to.be.undefined;
          const packed = req.resultPipe;
          expect(packed.directory.media.length).to.equal(2);
          expect(packed.directory.media[0]['l']).to.be.undefined;
          done();
        } catch (err) {
          done(err);
        }
      };
      GalleryMWs.cleanUpGalleryResults(req, null, next);
    });

    it('should not pair when Live Photo is disabled but should strip contentIdentifier', (done: (err?: any) => void) => {
      Config.Media.LivePhoto.enabled = false;
      Config.Media.Video.enabled = true;

      const photo = makePhoto('IMG_7943.HEIC', '.', 'vacation', '42A4A5ED-897B-46BF-84D2-FF2D0E90D7EB');
      const video = makeVideo('IMG_7943_HEVC.MOV', '.', 'vacation', '42A4A5ED-897B-46BF-84D2-FF2D0E90D7EB');

      const cw: ContentWrapper = {
        directory: {
          path: '.',
          name: 'vacation',
          media: [photo, video],
          directories: [],
          metaFile: [],
        } as ParentDirectoryDTO,
        searchResult: null,
      };

      const req: any = {resultPipe: cw};
      const next: any = (err: any) => {
        try {
          expect(err).to.be.undefined;
          const packed = req.resultPipe;
          // Both media should remain, no pairing
          expect(packed.directory.media.length).to.equal(2);
          expect(packed.directory.media[0]['l']).to.be.undefined;
          // contentIdentifier should still be stripped from the response
          expect(packed.directory.media[0]['m']?.contentIdentifier).to.be.undefined;
          expect(packed.directory.media[1]['m']?.contentIdentifier).to.be.undefined;
          done();
        } catch (err) {
          done(err);
        }
      };
      GalleryMWs.cleanUpGalleryResults(req, null, next);
      Config.Media.LivePhoto.enabled = true;
    });

    it('should pair in search results', (done: (err?: any) => void) => {
      Config.Media.LivePhoto.enabled = true;
      Config.Media.Video.enabled = true;

      const photo = makePhoto('IMG_7943.HEIC', '.', 'vacation', '42A4A5ED-897B-46BF-84D2-FF2D0E90D7EB');
      const video = makeVideo('IMG_7943_HEVC.MOV', '.', 'vacation', '42A4A5ED-897B-46BF-84D2-FF2D0E90D7EB');

      const cw: ContentWrapper = {
        directory: null,
        searchResult: {
          searchQuery: {type: 1, text: 'test'} as any,
          media: [photo, video],
          directories: [],
          metaFile: [],
          resultOverflow: false,
        },
      };

      const req: any = {resultPipe: cw};
      const next: any = (err: any) => {
        try {
          expect(err).to.be.undefined;
          const packed = req.resultPipe;
          expect(packed.searchResult.media.length).to.equal(1);
          expect(packed.searchResult.media[0]['n']).to.equal('IMG_7943.HEIC');
          expect(packed.searchResult.media[0]['l']).to.equal(path.join('vacation','IMG_7943_HEVC.MOV'));
          // contentIdentifier should be stripped from the response
          expect(packed.searchResult.media[0]['m']?.contentIdentifier).to.be.undefined;
          done();
        } catch (err) {
          done(err);
        }
      };
      GalleryMWs.cleanUpGalleryResults(req, null, next);
    });

    it('should keep unpaired videos in results', (done: (err?: any) => void) => {
      Config.Media.LivePhoto.enabled = true;
      Config.Media.Video.enabled = true;

      const photo = makePhoto('IMG_7943.HEIC', '.', 'vacation', '42A4A5ED-897B-46BF-84D2-FF2D0E90D7EB');
      const video = makeVideo('IMG_7943_HEVC.MOV', '.', 'vacation', '42A4A5ED-897B-46BF-84D2-FF2D0E90D7EB');
      const regularVideo = makeVideo('family_clip.mp4', '.', 'vacation');

      const cw: ContentWrapper = {
        directory: {
          path: '.',
          name: 'vacation',
          media: [photo, video, regularVideo],
          directories: [],
          metaFile: [],
        } as ParentDirectoryDTO,
        searchResult: null,
      };

      const req: any = {resultPipe: cw};
      const next: any = (err: any) => {
        try {
          expect(err).to.be.undefined;
          const packed = req.resultPipe;
          // Photo + regular video = 2 items (companion video filtered)
          expect(packed.directory.media.length).to.equal(2);
          const names = packed.directory.media.map((m: any) => m['n']);
          expect(names).to.include('IMG_7943.HEIC');
          expect(names).to.include('family_clip.mp4');
          expect(names).to.not.include('IMG_7943_HEVC.MOV');
          done();
        } catch (err) {
          done(err);
        }
      };
      GalleryMWs.cleanUpGalleryResults(req, null, next);
    });
  });
});
