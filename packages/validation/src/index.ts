import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const username = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(32)
  .regex(/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/, 'Use letters, numbers, underscores, or hyphens.');
const password = z.string().min(12).max(128);
const verificationCode = z.string().regex(/^\d{6}$/);

export const registerSchema = z.object({ email, username, password }).strict();
export const verifyEmailSchema = z.object({ email, code: verificationCode }).strict();
export const resendVerificationSchema = z.object({ email }).strict();
export const loginSchema = z
  .object({ identifier: z.string().trim().min(3).max(254), password })
  .strict();
export const forgotPasswordSchema = z.object({ email }).strict();
export const resetPasswordSchema = z
  .object({ token: z.string().min(32).max(512), password })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
