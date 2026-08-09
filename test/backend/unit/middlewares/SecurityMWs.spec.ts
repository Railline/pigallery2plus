import {expect} from 'chai';
import {SecurityMWs} from '../../../../src/backend/middlewares/SecurityMWs';
import {Config} from '../../../../src/common/config/private/Config';
import {ErrorCodes, ErrorDTO} from '../../../../src/common/entities/Error';

describe('SecurityMWs.csrfOriginCheck', () => {
  const request = (headers: Record<string, string>, protocol = 'https'): any => ({
    method: 'POST',
    protocol,
    get: (name: string): string | undefined => headers[name.toLowerCase()],
  });

  const response = (): any => ({
    statusCode: undefined as number,
    status(code: number): void {
      this.statusCode = code;
    },
  });

  it('should allow the exact configured public origin', () => {
    const previousPublicUrl = Config.Server.publicUrl;
    Config.Server.publicUrl = 'https://gallery.example/base';
    const req = request({origin: 'https://gallery.example'});
    const res = response();
    let nextError: ErrorDTO;

    try {
      SecurityMWs.csrfOriginCheck(req, res, ((err?: ErrorDTO) => nextError = err) as any);
    } finally {
      Config.Server.publicUrl = previousPublicUrl;
    }

    expect(nextError).to.be.undefined;
    expect(res.statusCode).to.be.undefined;
  });

  it('should compare schemes as well as hosts', () => {
    const previousPublicUrl = Config.Server.publicUrl;
    Config.Server.publicUrl = 'https://gallery.example';
    const req = request({origin: 'http://gallery.example'});
    const res = response();
    let nextError: ErrorDTO;

    try {
      SecurityMWs.csrfOriginCheck(req, res, ((err?: ErrorDTO) => nextError = err) as any);
    } finally {
      Config.Server.publicUrl = previousPublicUrl;
    }

    expect(res.statusCode).to.equal(403);
    expect(nextError?.code).to.equal(ErrorCodes.NOT_AUTHORISED);
  });

  it('should not trust a raw X-Forwarded-Host header', () => {
    const previousPublicUrl = Config.Server.publicUrl;
    Config.Server.publicUrl = '';
    const req = request({
      origin: 'https://attacker.example',
      host: 'gallery.example',
      'x-forwarded-host': 'attacker.example',
    });
    const res = response();
    let nextError: ErrorDTO;

    try {
      SecurityMWs.csrfOriginCheck(req, res, ((err?: ErrorDTO) => nextError = err) as any);
    } finally {
      Config.Server.publicUrl = previousPublicUrl;
    }

    expect(res.statusCode).to.equal(403);
    expect(nextError?.code).to.equal(ErrorCodes.NOT_AUTHORISED);
  });

  it('should reject Fetch Metadata requests marked cross-site without Origin', () => {
    const req = request({'sec-fetch-site': 'cross-site'});
    const res = response();
    let nextError: ErrorDTO;

    SecurityMWs.csrfOriginCheck(req, res, ((err?: ErrorDTO) => nextError = err) as any);

    expect(res.statusCode).to.equal(403);
    expect(nextError?.code).to.equal(ErrorCodes.NOT_AUTHORISED);
  });
});
