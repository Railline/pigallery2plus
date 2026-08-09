import {Config} from './config/private/Config';
import {SupportedFormatsBase} from './SupportedFormatsBase';

/** Server-side supported formats, initialized from the private configuration. */
export class SupportedFormats extends SupportedFormatsBase {
  static init(): void {
    super.init(Config);
  }
}

SupportedFormats.init();
