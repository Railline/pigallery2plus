import {expect} from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {FrontendAssetCache} from '../../../../../src/backend/model/fileaccess/FrontendAssetCache';

describe('FrontendAssetCache', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pigallery-frontend-cache-'));
    fs.mkdirSync(path.join(root, 'en'), {recursive: true});
    fs.mkdirSync(path.join(root, 'fr'), {recursive: true});
  });

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true});
  });

  it('preloads immutable assets and deduplicates localized copies', () => {
    const fileName = 'runtime.0123456789abcdef.js';
    fs.writeFileSync(path.join(root, 'en', fileName), 'cached-runtime');
    fs.writeFileSync(path.join(root, 'fr', fileName), 'cached-runtime');
    fs.writeFileSync(path.join(root, 'en', 'robots.txt'), 'not immutable');

    const cache = new FrontendAssetCache();
    const stats = cache.preload(root, ['en', 'fr']);

    expect(stats.files).to.equal(2);
    expect(stats.uniqueAssets).to.equal(1);
    expect(stats.uniqueBytes).to.equal(Buffer.byteLength('cached-runtime'));
  });

  it('serves cached assets with immutable headers without filesystem access', () => {
    const filePath = path.join(root, 'en', 'styles.0123456789abcdef.css');
    fs.writeFileSync(filePath, 'body{}');
    const cache = new FrontendAssetCache();
    cache.preload(root);
    fs.renameSync(filePath, filePath + '.moved');

    const headers: Record<string, string> = {};
    let status = 0;
    let body: Buffer = null;
    const response = {
      type: (value: string) => {
        headers['Content-Type'] = value;
        return response;
      },
      setHeader: (name: string, value: string) => {
        headers[name] = value;
        return response;
      },
      status: (value: number) => {
        status = value;
        return response;
      },
      end: (value?: Buffer) => {
        body = value;
        return response;
      },
    } as any;

    expect(cache.send({fresh: false, method: 'GET'} as any, response, filePath)).to.equal(true);
    expect(status).to.equal(200);
    expect(body.toString()).to.equal('body{}');
    expect(headers['Cache-Control']).to.equal('public, max-age=31536000, immutable');
    expect(headers['ETag']).to.match(/^"[a-f0-9]{32}-/);
  });

  it('only treats content-hashed file names as immutable', () => {
    expect(FrontendAssetCache.isImmutable('main.0123456789abcdef.js')).to.equal(true);
    expect(FrontendAssetCache.isImmutable('main.js')).to.equal(false);
    expect(FrontendAssetCache.isImmutable('manifest.json')).to.equal(false);
  });
});
