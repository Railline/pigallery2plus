import {expect} from 'chai';
import {PasswordHelper} from '../../../../src/backend/model/PasswordHelper';

describe('PasswordHelper', () => {
  it('should accept and verify passwords up to bcrypt UTF-8 limit', () => {
    const password = 'a'.repeat(PasswordHelper.MAX_BCRYPT_PASSWORD_BYTES);
    const hash = PasswordHelper.cryptPassword(password);
    expect(PasswordHelper.comparePassword(password, hash)).to.be.true;
  });

  it('should reject passwords exceeding bcrypt UTF-8 limit', () => {
    expect(() => PasswordHelper.cryptPassword('a'.repeat(73)))
      .to.throw('must not exceed 72 UTF-8 bytes');
    expect(() => PasswordHelper.cryptPassword('€'.repeat(25)))
      .to.throw('must not exceed 72 UTF-8 bytes');
  });
});
