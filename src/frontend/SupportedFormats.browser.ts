import {Config} from '../common/config/public/Config';
import {SupportedFormatsBase} from '../common/SupportedFormatsBase';

/** Browser-side supported formats, initialized from the public configuration. */
export class SupportedFormats extends SupportedFormatsBase {
  static init(): void {
    super.init(Config);
  }
}

SupportedFormats.init();
