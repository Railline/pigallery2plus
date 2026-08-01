interface SupportedFormatsConfig {
  Media: {
    Photo: {
      supportedFormats: string[];
    };
    Video: {
      supportedFormats: string[];
      supportedFormatsWithTranscoding: string[];
    };
  };
  MetaFile: {
    supportedFormats: string[];
  };
}

export class SupportedFormatsBase {
  static Photos: string[] = [];
  static Videos: string[] = [];
  static MetaFiles: string[] = [];
  static TranscodeNeed: {Photos: string[]; Videos: string[]} = {
    Photos: [],
    Videos: [],
  };
  static WithDots: {
    Photos: string[];
    Videos: string[];
    MetaFiles: string[];
    TranscodeNeed: {Photos: string[]; Videos: string[]};
  } = {
    Photos: [],
    Videos: [],
    MetaFiles: [],
    TranscodeNeed: {Photos: [], Videos: []},
  };

  static init(config: SupportedFormatsConfig): void {
    this.TranscodeNeed = {
      // Based on libvips; all photo formats supported by sharp are native.
      Photos: [],
      Videos: [...config.Media.Video.supportedFormatsWithTranscoding],
    };
    this.Photos = [
      ...config.Media.Photo.supportedFormats,
      ...this.TranscodeNeed.Photos,
    ];
    this.Videos = [
      ...config.Media.Video.supportedFormats,
      ...this.TranscodeNeed.Videos,
    ];
    this.MetaFiles = [...config.MetaFile.supportedFormats];
    this.WithDots = {
      Photos: this.Photos.map((format) => '.' + format),
      Videos: this.Videos.map((format) => '.' + format),
      MetaFiles: this.MetaFiles.map((format) => '.' + format),
      TranscodeNeed: {
        Photos: this.TranscodeNeed.Photos.map((format) => '.' + format),
        Videos: this.TranscodeNeed.Videos.map((format) => '.' + format),
      },
    };
  }
}
