import * as bcrypt from 'bcrypt';

export class PasswordHelper {
  public static readonly MAX_BCRYPT_PASSWORD_BYTES = 72;

  public static cryptPassword(password: string): string {
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > PasswordHelper.MAX_BCRYPT_PASSWORD_BYTES) {
      throw new Error(`Password must not exceed ${PasswordHelper.MAX_BCRYPT_PASSWORD_BYTES} UTF-8 bytes`);
    }
    const salt = bcrypt.genSaltSync(9);
    return bcrypt.hashSync(password, salt);
  }

  public static comparePassword(
      password: string,
      encryptedPassword: string
  ): boolean {
    try {
      return bcrypt.compareSync(password, encryptedPassword);
      // eslint-disable-next-line no-empty
    } catch (e) {
    }
    return false;
  }
}
