import { Response, Request, CookieOptions } from 'express';

export class CookieUtil {
  private static defaultOptions: CookieOptions = {
    httpOnly: true,
    secure:
      process.env.COOKIE_SECURE === 'true' ||
      (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production'),
    sameSite: (process.env.COOKIE_SAME_SITE ||
      (process.env.NODE_ENV === 'production' ? 'none' : 'lax')) as
      | 'lax'
      | 'strict'
      | 'none',
    path: '/',
    ...(process.env.COOKIE_DOMAIN && process.env.COOKIE_DOMAIN !== 'localhost'
      ? { domain: process.env.COOKIE_DOMAIN }
      : {}),
  };

  static set(
    res: Response,
    name: string,
    value: string,
    options: Partial<CookieOptions> = {},
  ): void {
    res.cookie(name, value, {
      ...this.defaultOptions,
      ...options,
    });
  }

  static get(req: Request, name: string): string | undefined {
    return req.cookies?.[name] || req.signedCookies?.[name];
  }

  static clear(
    res: Response,
    name: string,
    options: Partial<CookieOptions> = {},
  ): void {
    res.clearCookie(name, {
      ...this.defaultOptions,
      ...options,
    });
  }
}
