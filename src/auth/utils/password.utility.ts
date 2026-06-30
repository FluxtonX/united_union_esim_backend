import * as argon2 from 'argon2';

export class PasswordUtility {
  private static readonly COMMON_PASSWORDS = new Set([
    'password123456',
    'qwertyuiopasd',
    '123456789012',
    'unitedunionesim',
    'admin1234567',
    'passwordpassword',
    'welcome123456',
    'letmein123456',
  ]);

  /**
   * Hashes a password using Argon2id.
   */
  static async hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB (standard production config)
      timeCost: 3,       // 3 iterations
      parallelism: 4,    // 4 threads
    });
  }

  /**
   * Verifies a password against an Argon2id hash.
   */
  static async verify(hash: string, plainText: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainText);
    } catch {
      return false;
    }
  }

  /**
   * Validates if a password conforms to complexity requirements.
   * Returns null if valid, or a string listing failure reasons.
   */
  static validateStrength(password: string): string | null {
    const errors: string[] = [];

    if (password.length < 12) {
      errors.push('Password must be at least 12 characters long');
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    // Check against common passwords
    const normalized = password.toLowerCase().trim();
    for (const common of this.COMMON_PASSWORDS) {
      if (normalized.includes(common) || common.includes(normalized)) {
        errors.push('Password is too common or easy to guess');
        break;
      }
    }

    if (errors.length > 0) {
      return errors.join(', ');
    }

    return null;
  }
}
