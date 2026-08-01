import {expect} from 'chai';
import {ActivityAuditMWs} from '../../../../src/backend/middlewares/ActivityAuditMWs';

describe('ActivityAuditMWs URL redaction', () => {
  it('should redact bearer tokens from paths and query strings', () => {
    expect(ActivityAuditMWs.redactUrl('/pgapi/gallery/random-link/a-secret?token=abc'))
      .to.equal('/pgapi/gallery/random-link/[redacted]?token=%5Bredacted%5D');
    expect(ActivityAuditMWs.redactUrl('/share/a-secret'))
      .to.equal('/share/[redacted]');
    expect(ActivityAuditMWs.redactUrl('/pgapi/gallery/mail-media/123/signature-value/photos/a.jpg'))
      .to.equal('/pgapi/gallery/mail-media/123/[redacted]/photos/a.jpg');
    expect(ActivityAuditMWs.redactUrl('/pgapi/gallery/mail-thumbnail/512/123/signature-value/photos/a.jpg'))
      .to.equal('/pgapi/gallery/mail-thumbnail/512/123/[redacted]/photos/a.jpg');
  });

  it('should keep non-secret sharing list routes useful in logs', () => {
    expect(ActivityAuditMWs.redactUrl('/pgapi/share/listAll'))
      .to.equal('/pgapi/share/listAll');
    expect(ActivityAuditMWs.redactUrl('/pgapi/share/list/%7Bquery%7D'))
      .to.equal('/pgapi/share/list/%7Bquery%7D');
  });
});
