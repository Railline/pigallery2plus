import {expect} from 'chai';
import {Config} from '../../../../../src/common/config/private/Config';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';
import {
  calculateThumbnailConcurrency,
  PhotoProcessing,
} from '../../../../../src/backend/model/fileaccess/fileprocessing/PhotoProcessing';
import {
  ImageRendererFactory,
  MediaRendererInput,
  ThumbnailSourceType,
} from '../../../../../src/backend/model/fileaccess/PhotoWorker';


describe('PhotoProcessing', () => {

  it('should bound automatic thumbnail concurrency while honoring an explicit limit', () => {
    expect(calculateThumbnailConcurrency(1, 0)).to.equal(1);
    expect(calculateThumbnailConcurrency(4, 0)).to.equal(3);
    expect(calculateThumbnailConcurrency(32, 0)).to.equal(4);
    expect(calculateThumbnailConcurrency(32, 2)).to.equal(2);
    expect(calculateThumbnailConcurrency(32, 16)).to.equal(16);
    expect(calculateThumbnailConcurrency(32, 100)).to.equal(31);
    expect(calculateThumbnailConcurrency(Number.NaN, Number.NaN)).to.equal(1);
  });

  it('should use ffmpeg when animated GIF metadata exceeds the Sharp pixel limit', async () => {
    const originalMetadata = ImageRendererFactory.metadata;
    ImageRendererFactory.metadata = async () => {
      throw new Error('Input image exceeds pixel limit');
    };

    const processing = PhotoProcessing as unknown as {
      shouldUseFfmpegAnimatedThumbnail(input: MediaRendererInput): Promise<boolean>;
    };
    const input: MediaRendererInput = {
      type: ThumbnailSourceType.Photo,
      mediaPath: '/media/large-animation.gif',
      outPath: '/tmp/large-animation.webp',
      size: 320,
      makeSquare: false,
      quality: 85,
      useLanczos3: true,
      smartSubsample: true,
      sharpOptions: {},
      animate: true,
    };

    try {
      expect(await processing.shouldUseFfmpegAnimatedThumbnail(input)).to.equal(true);
    } finally {
      ImageRendererFactory.metadata = originalMetadata;
    }
  });

  it('should deduplicate concurrent generation before asynchronous prechecks', async () => {
    const originalImageFolder = ProjectPath.ImageFolder;
    const originalTranscodedFolder = ProjectPath.TranscodedFolder;
    const processing = PhotoProcessing as unknown as {
      removeFailedThumbnailIfSourceIsReadable(
        input: MediaRendererInput,
        outPath: string
      ): Promise<void>;
    };
    const originalPrecheck = processing.removeFailedThumbnailIfSourceIsReadable;
    const tempFolder = await fsp.mkdtemp(path.join(os.tmpdir(), 'pg2-thumbnail-lock-'));
    let releasePrecheck: () => void;
    const precheckGate = new Promise<void>((resolve) => {
      releasePrecheck = resolve;
    });
    let precheckCalls = 0;

    try {
      ProjectPath.ImageFolder = path.join(tempFolder, 'images');
      ProjectPath.TranscodedFolder = path.join(tempFolder, 'transcoded');
      await fsp.mkdir(ProjectPath.ImageFolder, {recursive: true});
      const mediaPath = path.join(ProjectPath.ImageFolder, 'photo.jpg');
      await fsp.writeFile(mediaPath, 'source');
      const outPath = PhotoProcessing.generateConvertedPath(mediaPath, 320);
      await fsp.mkdir(path.dirname(outPath), {recursive: true});
      await fsp.writeFile(outPath, 'cached');

      processing.removeFailedThumbnailIfSourceIsReadable = async (): Promise<void> => {
        precheckCalls++;
        await precheckGate;
      };

      const first = PhotoProcessing.generateThumbnail(
        mediaPath,
        320,
        ThumbnailSourceType.Photo,
        false
      );
      const second = PhotoProcessing.generateThumbnail(
        mediaPath,
        320,
        ThumbnailSourceType.Photo,
        false
      );

      expect(precheckCalls).to.equal(1);
      releasePrecheck();
      expect(await Promise.all([first, second])).to.deep.equal([outPath, outPath]);
    } finally {
      processing.removeFailedThumbnailIfSourceIsReadable = originalPrecheck;
      ProjectPath.ImageFolder = originalImageFolder;
      ProjectPath.TranscodedFolder = originalTranscodedFolder;
      await fsp.rm(tempFolder, {recursive: true, force: true});
    }
  });

  it('should generate converted gif file path', async () => {

    await Config.load();
    Config.Media.Photo.thumbnailSizes = [];
    ProjectPath.ImageFolder = path.join(__dirname, './../../../assets');
    const gifPath = path.join(ProjectPath.ImageFolder, 'earth.gif');


    for (const thSize of Config.Media.Photo.thumbnailSizes) {
      Config.Media.Photo.animateGif = true;

      expect(await PhotoProcessing
        .isValidConvertedPath(PhotoProcessing.generateConvertedPath(gifPath, thSize)))
        .to.be.true;

      Config.Media.Photo.animateGif = false;
      expect(await PhotoProcessing
        .isValidConvertedPath(PhotoProcessing.generateConvertedPath(gifPath, thSize)))
        .to.be.true;
    }

  });


  /* eslint-disable no-unused-expressions,@typescript-eslint/no-unused-expressions */
  it('should generate converted thumbnail path', async () => {

    await Config.load();
    Config.Media.Photo.thumbnailSizes = [10, 20];
    ProjectPath.ImageFolder = path.join(__dirname, './../../../assets');
    const photoPath = path.join(ProjectPath.ImageFolder, 'test_png.png');

    for (const thSize of Config.Media.Photo.thumbnailSizes) {
      expect(await PhotoProcessing
        .isValidConvertedPath(PhotoProcessing.generateConvertedPath(photoPath, thSize)))
        .to.be.true;


      expect(await PhotoProcessing
        .isValidConvertedPath(PhotoProcessing.generateConvertedPath(photoPath + 'noPath', thSize)))
        .to.be.false;
    }


    expect(await PhotoProcessing
      .isValidConvertedPath(PhotoProcessing.generateConvertedPath(photoPath, 30)))
      .to.be.false;

  });

});
