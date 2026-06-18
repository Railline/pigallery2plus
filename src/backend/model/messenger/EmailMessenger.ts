import {createTransport, Transporter} from 'nodemailer';
import {Config} from '../../../common/config/private/Config';
import {PhotoMetadata} from '../../../common/entities/PhotoDTO';
import {MediaDTOWithThPath, Messenger} from './Messenger';
import {backendTexts} from '../../../common/BackendTexts';
import {DynamicConfig} from '../../../common/entities/DynamicConfig';
import {DefaultMessengers} from '../../../common/entities/job/JobDTO';
import {Utils} from '../../../common/Utils';
import {Logger} from '../../Logger';

const LOG_TAG = '[EmailMessenger]';

export class EmailMessenger extends Messenger<{
  emailTo: string,
  emailSubject: string,
  emailText: string,
}> {
  public readonly Name = DefaultMessengers[DefaultMessengers.Email];
  public readonly ConfigTemplate: DynamicConfig[]  = [{
    id: 'emailTo',
    type: 'string-array',
    name: backendTexts.emailTo.name,
    description: backendTexts.emailTo.description,
    defaultValue: [],
  }, {
    id: 'emailSubject',
    type: 'string',
    name: backendTexts.emailSubject.name,
    description: backendTexts.emailSubject.description,
    defaultValue: 'Latest photos for you',
  }, {
    id: 'emailText',
    type: 'string',
    name: backendTexts.emailText.name,
    description: backendTexts.emailText.description,
    defaultValue: 'I hand picked these photos just for you:',
  }];
  transporter: Transporter;

  private static escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  constructor() {
    super();
    this.transporter = createTransport({
      host: Config.Messaging.Email.smtp.host,
      port: Config.Messaging.Email.smtp.port,
      secure: Config.Messaging.Email.smtp.secure,
      requireTLS: Config.Messaging.Email.smtp.requireTLS,
      auth: {
        user: Config.Messaging.Email.smtp.user,
        pass: Config.Messaging.Email.smtp.password
      }
    });
  }


  protected async sendMedia(mailSettings: {
    emailTo: string,
    emailSubject: string,
    emailText: string
  }, media: MediaDTOWithThPath[]) {

    const links = [];
    const htmlStart = '<div style="background:#ffffff;color:#111111;font-family:Arial,sans-serif;padding:20px;line-height:1.45;">\n' +
      '<h1 style="text-align:center;margin:0 0 18px 0;color:#111111;">' + EmailMessenger.escapeHtml(Config.Server.applicationTitle) + '</h1>\n' +
      '<p style="margin:0 0 18px 0;color:#111111;font-size:16px;">' + EmailMessenger.escapeHtml(mailSettings.emailText || '') + '</p>\n' +
      '<table role="presentation" cellspacing="0" cellpadding="8" style="width:100%;max-width:760px;margin:0 auto;border-collapse:collapse;">\n' +
      '<tbody>\n';
    const htmlEnd = '</tbody>\n' +
      '</table>\n' +
      '</div>';
    let htmlMiddle = '';
    const numberOfColumns = media.length >= 6 ? 3 : 2;
    for (let i = 0; i < media.length; ++i) {
      const location = (media[i].metadata as PhotoMetadata).positionData?.country ?
        (media[i].metadata as PhotoMetadata).positionData?.country :
        ((media[i].metadata as PhotoMetadata).positionData?.city ?
          (media[i].metadata as PhotoMetadata).positionData?.city : '');
      const caption = Utils.getFullYear(Utils.getTimeMS(media[i].metadata.creationDate, media[i].metadata.creationDateOffset, Config.Gallery.ignoreTimestampOffset), undefined) + (location ? ', ' + location : '');
      links.push(`${media[i].name}: ${media[i].thumbnailUrl}`);
      if (i % numberOfColumns === 0) {
        htmlMiddle += '<tr>\n';
      }
      htmlMiddle += '<td style="width:' + Math.floor(100 / numberOfColumns) + '%;vertical-align:top;text-align:center;color:#111111;">\n' +
        '<a style="display:block;text-align:center;color:#005bbb;text-decoration:none;" href="' + EmailMessenger.escapeHtml(media[i].thumbnailUrl) + '">\n' +
        '<img alt="' + EmailMessenger.escapeHtml(media[i].name) + '" src="' + EmailMessenger.escapeHtml(media[i].mailThumbnailUrl) + '" style="display:block;max-width:220px;max-height:165px;width:auto;height:auto;margin:0 auto 6px auto;border:0;outline:none;text-decoration:none;"/>\n' +
        '</a>\n' +
        '<div style="font-size:12px;line-height:1.35;color:#555555;">' + EmailMessenger.escapeHtml(caption) + '</div>\n' +
        '<a style="display:block;max-width:230px;margin:4px auto 0 auto;color:#005bbb;font-size:12px;line-height:1.35;text-decoration:underline;word-break:break-word;" href="' + EmailMessenger.escapeHtml(media[i].thumbnailUrl) + '">' + EmailMessenger.escapeHtml(media[i].name) + '</a>\n' +
        '</td>\n';
      if (i % numberOfColumns === numberOfColumns - 1 || i === media.length - 1) {
        htmlMiddle += '</tr>\n';
      }
    }

    Logger.info(
      LOG_TAG,
      `Sending email with ${media.length} media, signed remote thumbnails, htmlLength=${(htmlStart + htmlMiddle + htmlEnd).length}`
    );

    return await this.transporter.sendMail({
      from: Config.Messaging.Email.emailFrom,
      to: mailSettings.emailTo,
      subject: mailSettings.emailSubject,
      text: `${Config.Server.applicationTitle}\n\n${mailSettings.emailText || ''}\n\n${links.join('\n')}`,
      html: htmlStart + htmlMiddle + htmlEnd
    });
  }
}
