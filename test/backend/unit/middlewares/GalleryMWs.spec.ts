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
