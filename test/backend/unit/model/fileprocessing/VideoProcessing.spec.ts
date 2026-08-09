import {expect} from 'chai';
import {VideoProcessing} from '../../../../../src/backend/model/fileaccess/fileprocessing/VideoProcessing';
import {Config} from '../../../../../src/common/config/private/Config';
import {ProjectPath} from '../../../../../src/backend/ProjectPath';
import * as path from 'path';


describe('VideoProcessing', () => {

  it('should reject conversion paths outside the media root before file access', async () => {
    const originalImageFolder = ProjectPath.ImageFolder;
    ProjectPath.ImageFolder = path.join(__dirname, 'trusted-media-root');
    let error: Error = null;
    try {
      await VideoProcessing.convertVideo(path.join(__dirname, 'outside.mp4'));
    } catch (caught) {
      error = caught as Error;
    } finally {
      ProjectPath.ImageFolder = originalImageFolder;
    }

    expect(error).to.be.instanceOf(Error);
    expect(error.message).to.equal('Video path is outside image folder');
  });

  /* eslint-disable no-unused-expressions,@typescript-eslint/no-unused-expressions */
  it('should generate converted file path', async () => {

    ProjectPath.ImageFolder = path.join(__dirname, './../../../assets');
    const videoPath = path.join(ProjectPath.ImageFolder, 'video.mp4');
    expect(await VideoProcessing
      .isValidConvertedPath(VideoProcessing.generateConvertedFilePath(videoPath)))
      .to.be.true;

    expect(await VideoProcessing
      .isValidConvertedPath(VideoProcessing.generateConvertedFilePath(videoPath + 'noPath')))
      .to.be.false;

    {
      const convertedPath = VideoProcessing.generateConvertedFilePath(videoPath);
      Config.Media.Video.transcoding.bitRate = 10;
      expect(await VideoProcessing.isValidConvertedPath(convertedPath)).to.be.false;
    }
    {
      const convertedPath = VideoProcessing.generateConvertedFilePath(videoPath);
      Config.Media.Video.transcoding.mp4Codec = 'codec_text' as any;
      expect(await VideoProcessing.isValidConvertedPath(convertedPath)).to.be.false;
    }
    {
      const convertedPath = VideoProcessing.generateConvertedFilePath(videoPath);
      Config.Media.Video.transcoding.format = 'format_test' as any;
      expect(await VideoProcessing.isValidConvertedPath(convertedPath)).to.be.false;
    }
    {
      const convertedPath = VideoProcessing.generateConvertedFilePath(videoPath);
      Config.Media.Video.transcoding.resolution = 1 as any;
      expect(await VideoProcessing.isValidConvertedPath(convertedPath)).to.be.false;
    }
  });

});
