import {GridMedia} from './GridMedia';
import {PhotoDTO} from '../../../../../common/entities/PhotoDTO';
import {Config} from '../../../../../common/config/public/Config';

describe('GridMedia', () => {

  describe('responsive thumbnail sizing', () => {
    const makeMedia = (width: number, height: number): GridMedia => {
      return new GridMedia({
        name: 'photo.jpg',
        directory: {name: 'photos', path: '/'},
        metadata: {size: {width, height}},
      } as PhotoDTO, 100, 100, 0);
    };

    it('selects the first thumbnail that is not smaller than the display', () => {
      const media = makeMedia(4032, 3024);

      expect(media.getRequiredMediaSize(800, 600, 1)).toBe(600);
      expect(media.getMediaSize(800, 600, 1)).toBe(1080);
    });

    it('uses the fitted shorter edge for panoramas and portraits', () => {
      const panorama = makeMedia(4000, 1000);
      const portrait = makeMedia(1000, 4000);

      expect(panorama.getRequiredMediaSize(1920, 1080, 1)).toBe(480);
      expect(panorama.getMediaSize(1920, 1080, 1)).toBe(540);
      expect(portrait.getRequiredMediaSize(1920, 1080, 1)).toBe(270);
      expect(portrait.getMediaSize(1920, 1080, 1)).toBe(320);
    });

    it('accounts for high-density displays', () => {
      const media = makeMedia(4032, 3024);

      expect(media.getRequiredMediaSize(400, 300, 2)).toBe(600);
      expect(media.getMediaSize(400, 300, 2)).toBe(1080);
    });

    it('does not request more pixels than the original contains', () => {
      const media = makeMedia(640, 480);

      expect(media.getRequiredMediaSize(1920, 1080, 2)).toBe(480);
      expect(media.getMediaSize(1920, 1080, 2)).toBe(540);
    });

    it('does not cap a large grid tile to a blurry 540px thumbnail', () => {
      const media = makeMedia(4032, 3024);
      media.renderWidth = 1600;
      media.renderHeight = 1200;

      expect(media.getThumbnailSize()).toBe(2160);
      expect(media.getThumbnailPath()).toContain('/2160');
    });
  });

  describe('isLivePhoto', () => {
    it('should return true when liveVideoPath is set', () => {
      const media = {
        name: 'IMG_001.HEIC',
        directory: {name: 'photos', path: '/'},
        metadata: {size: {width: 100, height: 100}},
        liveVideoPath: 'photos/IMG_001_HEVC.MOV',
      } as any;
      const gm = new GridMedia(media, 100, 100, 0);
      expect(gm.isLivePhoto()).toBeTrue();
    });

    it('should return false when liveVideoPath is not set', () => {
      const media = {
        name: 'IMG_002.HEIC',
        directory: {name: 'photos', path: '/'},
        metadata: {size: {width: 100, height: 100}},
      } as PhotoDTO;
      const gm = new GridMedia(media, 100, 100, 0);
      expect(gm.isLivePhoto()).toBeFalse();
    });
  });

  describe('getLiveVideoPath', () => {
    it('should return null when no liveVideoPath', () => {
      const media = {
        name: 'IMG_002.HEIC',
        directory: {name: 'photos', path: '/'},
        metadata: {size: {width: 100, height: 100}},
      } as PhotoDTO;
      const gm = new GridMedia(media, 100, 100, 0);
      expect(gm.getLiveVideoPath()).toBeNull();
    });

    it('should build the correct video URL', () => {
      const media = {
        name: 'IMG_001.HEIC',
        directory: {name: 'photos', path: '/'},
        metadata: {size: {width: 100, height: 100}},
        liveVideoPath: 'photos/IMG_001_HEVC.MOV',
      } as any;
      const gm = new GridMedia(media, 100, 100, 0);
      const path = gm.getLiveVideoPath();
      expect(path).toContain('/gallery/content/');
      expect(path).toContain('photos/IMG_001_HEVC.MOV');
      expect(path).toContain('/bestFit');
    });

    it('should encode special characters in the path', () => {
      const media = {
        name: 'IMG 001.HEIC',
        directory: {name: 'photos', path: '/'},
        metadata: {size: {width: 100, height: 100}},
        liveVideoPath: 'photos/IMG #1$?.MOV',
      } as any;
      const gm = new GridMedia(media, 100, 100, 0);
      const path = gm.getLiveVideoPath();
      expect(path).not.toContain('#');
      expect(path).not.toContain('$');
      expect(path).not.toContain('?');
      expect(path).toContain('%23');
      expect(path).toContain('%24');
      expect(path).toContain('%3F');
    });
  });
});
