import * as jwt from 'jsonwebtoken';

export class JwtUtil {
  private static getAccessSecret(): string {
    return process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || 'accesssecret';
  }

  private static getRefreshSecret(): string {
    return process.env.REFRESH_TOKEN_SECRET || 'refreshsecret';
  }

  static sign(payload: string | object | Buffer, options?: jwt.SignOptions): string {
    const defaultOptions: jwt.SignOptions = {
      expiresIn: (process.env.ACCESS_TOKEN_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '1d') as any,
    };
    return jwt.sign(payload, this.getAccessSecret(), { ...defaultOptions, ...options });
  }

  static signRefreshToken(payload: string | object | Buffer, options?: jwt.SignOptions): string {
    const defaultOptions: jwt.SignOptions = {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN || '7d') as any,
    };
    return jwt.sign(payload, this.getRefreshSecret(), { ...defaultOptions, ...options });
  }

  static generateTokens(payload: { id: string; email: string; role?: string; status?: string; name?: string }) {
    const tokenPayload = {
      id: payload.id,
      userId: payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role || 'USER',
      status: payload.status || 'ACTIVE',
    };
    const accessToken = this.sign(tokenPayload);
    const refreshToken = this.signRefreshToken({
      id: payload.id,
      userId: payload.id,
      email: payload.email,
    });
    return { accessToken, refreshToken };
  }

  static verify<T = any>(token: string, options?: jwt.VerifyOptions): T {
    return jwt.verify(token, this.getAccessSecret(), options) as T;
  }

  static verifyAccessToken<T = any>(token: string, options?: jwt.VerifyOptions): T {
    return jwt.verify(token, this.getAccessSecret(), options) as T;
  }

  static verifyRefreshToken<T = any>(token: string, options?: jwt.VerifyOptions): T {
    return jwt.verify(token, this.getRefreshSecret(), options) as T;
  }

  static decode<T = any>(token: string): T | null {
    return jwt.decode(token) as T;
  }
}

export function isValidObjectId(id?: string | null): boolean {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-fA-F]{24}$/.test(id);
}


