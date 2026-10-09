import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EmailService } from '../infrastructure/email/email.service';
import { OtpService } from '../shared/otp/otp.service';
import { CloudinaryService } from '../infrastructure/cloudinary/cloudinary.service';
import { auth, getAuth } from './better-auth.instance';
import { VerificationEmailService } from '../infrastructure/email/verification-email.service';
import { JwtUtil, isValidObjectId } from '../common/utils/jwt/jwt.util';
import {
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
} from '../common/exceptions/domain.exceptions';
import { UserStatus } from '../common/enums/user-status.enum';
import { TokenType } from '../../generated/prisma';
import {
  RegisterDto,
  LoginDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';


@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly otpService: OtpService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly verificationEmail: VerificationEmailService,
  ) {}

  async onModuleInit() { await getAuth(this.prisma); }

  async register(dto: RegisterDto, headers?: Headers, file?: Express.Multer.File) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('An account with this email address already exists');
    }

    let imageUrl: string | undefined = dto.image || undefined;
    if (file) {
      try {
        const uploadRes = await this.cloudinaryService.uploadFile(file, 'user_avatars');
        imageUrl = uploadRes.secure_url;
      } catch (err) {
        this.logger.warn(`Failed to upload avatar during registration: ${err}`);
      }
    }

    try {
      const response = await auth.api.signUpEmail({
        body: {
          name: dto.name,
          email: dto.email.toLowerCase(),
          password: dto.password,
          phoneNumber: dto.phoneNumber || undefined,
          image: imageUrl,
        },
        headers: headers || new Headers(),
      });

      const otp = await this.otpService.getOrCreateVerificationOtp(dto.email.toLowerCase());
      let delivery: { verificationEmailQueued: boolean; retryAfter: number } | undefined;
      try {
        delivery = await this.verificationEmail.enqueue(dto.email.toLowerCase(), otp.id, dto.name);
      } catch {
        // The account and code are saved. Never report registration failure just
        // because delivery is unavailable; the verification screen can resend.
        this.logger.error('Unable to queue verification email; resend required');
      }

      const user = response.user as any;
      const tokens = JwtUtil.generateTokens({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      });

      return {
        verificationEmailSent: delivery ? undefined : false,
        verificationEmailQueued: delivery?.verificationEmailQueued || false,
        retryAfter: delivery?.retryAfter || 0,
        user: response.user,
        session: (response as any).session || null,
        token: (response as any).token || (response as any).session?.token,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error: any) {
      this.logger.error(`Registration error for ${dto.email}`, error);
      throw new BadRequestException(error.message || 'Failed to register account');
    }
  }

  async login(dto: LoginDto, headers?: Headers) {
    try {
      const response = await auth.api.signInEmail({
        body: {
          email: dto.email.toLowerCase(),
          password: dto.password,
        },
        headers: headers || new Headers(),
      });

      if (!response || !response.user) {
        throw new UnauthorizedException('Invalid email or password');
      }

      const user = response.user as any;
      if (user.status === UserStatus.SUSPENDED) {
        throw new UnauthorizedException('Account has been suspended. Please contact support.');
      }
      if (!user.emailVerified) {
        throw new UnauthorizedException('Email not verified');
      }

      const tokens = JwtUtil.generateTokens({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      });

      return {
        user: response.user,
        session: (response as any).session || null,
        token: (response as any).token || (response as any).session?.token,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    } catch (error: any) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.warn(`Login failed for ${dto.email}: ${error.message}`);
      throw new UnauthorizedException('Invalid email or password');
    }
  }

  async refreshToken(refreshTokenStr?: string) {
    if (!refreshTokenStr) {
      throw new UnauthorizedException('Refresh token is required');
    }

    let user: any = null;

    // 1. Try decoding/verifying as JWT refresh token or access token
    let payload: any = null;
    try {
      payload = JwtUtil.verifyRefreshToken(refreshTokenStr);
    } catch {
      try {
        payload = JwtUtil.verifyAccessToken(refreshTokenStr);
      } catch {
        // Not a standard JWT token, or expired JWT
      }
    }

    const rawUserId = payload?.id || payload?.userId || payload?._id || payload?.sub;
    const userEmail = payload?.email;

    if (isValidObjectId(rawUserId)) {
      try {
        user = await this.prisma.user.findUnique({
          where: { id: rawUserId },
        });
      } catch (err) {
        this.logger.warn(`Prisma user query error by ID: ${err}`);
      }
    }

    if (!user && userEmail) {
      try {
        user = await this.prisma.user.findUnique({
          where: { email: userEmail.toLowerCase() },
        });
      } catch (err) {
        this.logger.warn(`Prisma user query error by email: ${err}`);
      }
    }

    // 2. Fallback: If not found via JWT, check if refreshTokenStr is a Better Auth session token
    if (!user) {
      try {
        const sessionRecord = await this.prisma.session.findUnique({
          where: { token: refreshTokenStr },
          include: { user: true },
        });

        if (sessionRecord && sessionRecord.expiresAt > new Date()) {
          user = sessionRecord.user;
        }
      } catch (err) {
        this.logger.warn(`Prisma session lookup error: ${err}`);
      }
    }

    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (user.status === UserStatus.SUSPENDED) {
      throw new UnauthorizedException('Account has been suspended. Please contact support.');
    }

    if (user.status === UserStatus.INACTIVE) {
      throw new UnauthorizedException('Account is inactive.');
    }

    if (!user.emailVerified) {
      throw new UnauthorizedException('Please verify your email address.');
    }

    const tokens = JwtUtil.generateTokens({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    });

    const session = await this.prisma.session.findFirst({
      where: {
        userId: user.id,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        image: user.image,
        phoneNumber: user.phoneNumber,
        emailVerified: user.emailVerified,
      },
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      token: session?.token || '',
    };
  }

  async logout(headers?: Headers): Promise<boolean> {

    try {
      await auth.api.signOut({
        headers: headers || new Headers(),
      });
      return true;
    } catch (error: any) {
      this.logger.warn(`Sign out error: ${error.message}`);
      return true;
    }
  }

  async getMe(userId: string) {
    let user: any = null;

    if (isValidObjectId(userId)) {
      try {
        user = await this.prisma.user.findUnique({
          where: { id: userId },
          include: { adminProfile: true },
        });
      } catch (err) {
        this.logger.warn(`Prisma getMe query error: ${err}`);
      }
    }

    if (!user && userId && userId.includes('@')) {
      try {
        user = await this.prisma.user.findUnique({
          where: { email: userId.toLowerCase() },
          include: { adminProfile: true },
        });
      } catch (err) {
        this.logger.warn(`Prisma getMe email lookup error: ${err}`);
      }
    }

    if (!user) {
      throw new NotFoundException('User', userId);
    }

    return user;
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      // Do not leak whether user exists to prevent email enumeration
      return true;
    }

    // If user is not yet verified, send an Email Verification OTP code
    if (!user.emailVerified) {
      const verifyOtp = await this.otpService.createOtp(
        user.email,
        TokenType.EMAIL_VERIFICATION,
        15, // 15 mins
      );
      await this.emailService.sendOtpEmail(user.email, verifyOtp, user.name);
      return true;
    }

    // Otherwise send Password Reset 6-digit OTP code
    const resetOtp = await this.otpService.createOtp(
      user.email,
      TokenType.PASSWORD_RESET,
      15, // 15 mins
    );

    await this.emailService.sendOtpEmail(user.email, resetOtp, user.name);
    return true;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<boolean> {
    const code = dto.otp || dto.token;
    if (!code) {
      throw new BadRequestException('Reset code is required');
    }

    const whereClause: any = {
      token: code,
      type: TokenType.PASSWORD_RESET,
      isUsed: false,
      expiresAt: { gte: new Date() },
    };

    if (dto.email) {
      whereClause.identifier = dto.email.toLowerCase();
    }

    // Look for valid OTP token
    const tokenRecord = await this.prisma.otpToken.findFirst({
      where: whereClause,
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired password reset code');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: tokenRecord.identifier },
    });

    if (!user) {
      throw new NotFoundException('User');
    }

    // Hash new password using Better-Auth compatible hasher
    const { hashPassword } = await eval('import("better-auth/crypto")');
    const hashedPassword = await hashPassword(dto.newPassword);

    // Update password in account table
    const credentialAccount = await this.prisma.account.findFirst({
      where: {
        userId: user.id,
        providerId: 'credential',
      },
    });

    if (credentialAccount) {
      await this.prisma.account.update({
        where: { id: credentialAccount.id },
        data: {
          password: hashedPassword,
        },
      });
    } else {
      await this.prisma.account.create({
        data: {
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: hashedPassword,
        },
      });
    }

    // Mark token as used
    await this.prisma.otpToken.update({
      where: { id: tokenRecord.id },
      data: { isUsed: true },
    });

    // Terminate existing sessions for security
    await this.prisma.session.deleteMany({
      where: { userId: user.id },
    });

    return true;
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<boolean> {
    const code = dto.otp || dto.token;
    if (!code) {
      throw new BadRequestException('Verification code is required');
    }

    const whereClause: any = {
      token: code,
      type: TokenType.EMAIL_VERIFICATION,
      isUsed: false,
      expiresAt: { gte: new Date() },
    };

    if (dto.email) {
      whereClause.identifier = dto.email.toLowerCase();
    }

    const tokenRecord = await this.prisma.otpToken.findFirst({
      where: whereClause,
    });

    if (!tokenRecord) {
      throw new BadRequestException('Invalid or expired verification code');
    }

    await this.prisma.user.update({
      where: { email: tokenRecord.identifier },
      data: { emailVerified: true },
    });

    await this.prisma.otpToken.update({
      where: { id: tokenRecord.id },
      data: { isUsed: true },
    });

    return true;
  }

  async resendVerificationOtp(email: string): Promise<boolean> {
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { email: true, emailVerified: true, name: true },
    });

    if (!user) {
      return true;
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email is already verified');
    }

    const otp = await this.otpService.getOrCreateVerificationOtp(user.email);
    await this.verificationEmail.enqueue(user.email, otp.id, user.name);
    return true;
  }

  verificationEmailStatus(email: string) {
    return this.verificationEmail.getStatus(email.trim().toLowerCase());
  }
}
