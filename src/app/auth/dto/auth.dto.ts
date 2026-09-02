import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(6, 'Password must be at least 6 characters'),
  phoneNumber: z.string().optional().nullable(),
  role: z.string().optional().nullable(),
  image: z.string().optional().nullable(),
});

export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginDto = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export type ForgotPasswordDto = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    email: z.string().email('Invalid email address').optional().nullable(),
    token: z.string().optional().nullable(),
    otp: z.string().optional().nullable(),
    newPassword: z.string().min(6, 'Password must be at least 6 characters'),
  })
  .refine((data) => Boolean(data.token || data.otp), {
    message: 'Reset code is required',
    path: ['otp'],
  });

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const verifyEmailSchema = z
  .object({
    email: z.string().email('Invalid email address').optional().nullable(),
    token: z.string().optional().nullable(),
    otp: z.string().optional().nullable(),
  })
  .refine((data) => Boolean(data.token || data.otp), {
    message: 'Verification code is required',
    path: ['otp'],
  });

export type VerifyEmailDto = z.infer<typeof verifyEmailSchema>;
