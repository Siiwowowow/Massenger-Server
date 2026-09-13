import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UsePipes,
  All,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { getAuth } from './better-auth.instance';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/interfaces/auth-user.interface';
import { SkipTransform } from '../common/decorators/skip-transform.decorator';
import {
  RegisterDto,
  registerSchema,
  LoginDto,
  loginSchema,
  ForgotPasswordDto,
  forgotPasswordSchema,
  ResetPasswordDto,
  resetPasswordSchema,
  VerifyEmailDto,
  verifyEmailSchema,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  private betterAuthHandler: any;

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @UseInterceptors(FileInterceptor('profilePhoto'))
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const headers = new Headers(req.headers as any);
    const result = await this.authService.register(dto, headers, file);
    return {
      message: 'User registered successfully. Verification email sent.',
      data: result,
    };
  }

  @Public()
  @Post('login')
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const headers = new Headers(req.headers as any);
    const result = await this.authService.login(dto, headers);
    return {
      message: 'Login successful',
      data: result,
    };
  }

  @Public()
  @Post('refresh-token')
  async refreshToken(@Body() body: { refreshToken?: string }, @Req() req: Request) {
    const refreshToken =
      body?.refreshToken ||
      req.cookies?.refreshToken ||
      req.headers.cookie
        ?.split(';')
        .find((c) => c.trim().startsWith('refreshToken='))
        ?.split('=')[1]
        ?.trim();

    const result = await this.authService.refreshToken(refreshToken);
    return {
      message: 'Tokens refreshed successfully',
      data: result,
    };
  }

  @Post('logout')
  async logout(@Req() req: Request) {
    const headers = new Headers(req.headers as any);
    await this.authService.logout(headers);
    return {
      message: 'Logged out successfully',
    };
  }

  @Get('me')
  async getMe(@CurrentUser() user: AuthUser) {
    const data = await this.authService.getMe(user.id);
    return {
      message: 'Current user profile retrieved',
      data,
    };
  }

  @Public()
  @Post('forgot-password')
  @UsePipes(new ZodValidationPipe(forgotPasswordSchema))
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
    return {
      message: 'If an account with this email exists, a password reset link has been sent.',
    };
  }

  @Public()
  @Post('forget-password')
  @UsePipes(new ZodValidationPipe(forgotPasswordSchema))
  async forgetPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto);
    return {
      message: 'If an account with this email exists, a password reset link has been sent.',
    };
  }

  @Public()
  @Post('reset-password')
  @UsePipes(new ZodValidationPipe(resetPasswordSchema))
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return {
      message: 'Password has been reset successfully.',
    };
  }

  @Public()
  @Post('verify-email')
  @UsePipes(new ZodValidationPipe(verifyEmailSchema))
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.authService.verifyEmail(dto);
    return {
      message: 'Email verified successfully.',
    };
  }

  @Public()
  @Post('resend-verification-otp')
  async resendVerificationOtp(@Body() body: { email: string }) {
    await this.authService.resendVerificationOtp(body.email);
    return {
      message: 'A verification code has been sent to your email.',
    };
  }

  @Public()
  @Post('resend-otp')
  async resendOtp(@Body() body: { email: string }) {
    await this.authService.resendVerificationOtp(body.email);
    return {
      message: 'A verification code has been sent to your email.',
    };
  }

  // Native Better Auth router fallback for /api/v1/auth/* (OAuth callbacks, session internals, etc.)
  @Public()
  @SkipTransform()
  @All('*path')
  async handleBetterAuth(@Req() req: Request, @Res() res: Response) {
    if (!this.betterAuthHandler) {
      const { toNodeHandler } = await eval('import("better-auth/node")');
      const authInstance = await getAuth();
      this.betterAuthHandler = toNodeHandler(authInstance);
    }
    return this.betterAuthHandler(req, res);
  }
}

