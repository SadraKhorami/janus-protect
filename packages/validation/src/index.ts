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

const projectSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
const excludePath = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => {
    if (value.startsWith('/') || value.includes('\\') || value.includes('\0')) return false;
    const withoutGlob = value.endsWith('/**') ? value.slice(0, -3) : value;
    return (
      withoutGlob.length > 0 &&
      withoutGlob.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..') &&
      !withoutGlob.includes('*')
    );
  }, 'Use a safe relative file or directory path; only a trailing /** glob is supported.');

export const createProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: projectSlug,
    description: z.string().trim().max(1000).optional(),
  })
  .strict();

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    slug: projectSlug.optional(),
    description: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required.');

export const protectionProfileSchema = z
  .object({
    level: z.enum(['BASIC', 'STANDARD', 'STRONG']),
    runtimeInjection: z.boolean(),
    integrity: z.boolean(),
    obfuscation: z.boolean(),
    excludePaths: z.array(excludePath).max(50).default([]),
  })
  .strict()
  .refine((value) => !value.runtimeInjection || value.integrity, {
    message: 'Runtime injection requires integrity protection.',
    path: ['integrity'],
  });

export const createBuildSchema = z
  .object({
    version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Use a semantic version.'),
    protectionLevel: z.enum(['BASIC', 'STANDARD', 'STRONG']).optional(),
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProtectionProfileInput = z.infer<typeof protectionProfileSchema>;
export type CreateBuildInput = z.infer<typeof createBuildSchema>;
