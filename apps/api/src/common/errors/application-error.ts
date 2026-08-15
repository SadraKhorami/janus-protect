export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}

export const errors = {
  conflict: (message = 'An account with those details already exists.') =>
    new ApplicationError('ACCOUNT_CONFLICT', message, 409),
  invalidVerification: () =>
    new ApplicationError(
      'VERIFICATION_INVALID',
      'The verification code is invalid or expired.',
      400,
    ),
  verificationAttempts: () =>
    new ApplicationError(
      'VERIFICATION_ATTEMPTS_EXCEEDED',
      'The verification code can no longer be used. Request a new code.',
      429,
    ),
  invalidCredentials: () =>
    new ApplicationError('AUTHENTICATION_FAILED', 'The supplied credentials are invalid.', 401),
  emailNotVerified: () =>
    new ApplicationError('EMAIL_NOT_VERIFIED', 'Verify your email before signing in.', 403),
  accountUnavailable: () =>
    new ApplicationError('ACCOUNT_UNAVAILABLE', 'This account is not available.', 403),
  invalidSession: () =>
    new ApplicationError('SESSION_INVALID', 'The session is invalid or expired.', 401),
  invalidReset: () =>
    new ApplicationError('PASSWORD_RESET_INVALID', 'The reset link is invalid or expired.', 400),
  rateLimited: (retryAfterSeconds: number) =>
    new ApplicationError(
      'RATE_LIMITED',
      `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
      429,
    ),
  unauthorized: () => new ApplicationError('UNAUTHORIZED', 'Authentication is required.', 401),
  forbidden: () => new ApplicationError('FORBIDDEN', 'You cannot access this resource.', 403),
  notFound: (resource = 'Resource') =>
    new ApplicationError('NOT_FOUND', `${resource} was not found.`, 404),
  archiveInvalid: (code: string, message: string) => new ApplicationError(code, message, 422),
  projectConflict: () =>
    new ApplicationError('PROJECT_CONFLICT', 'A project with this slug already exists.', 409),
  viewerQuota: (resource: string) =>
    new ApplicationError(
      'VIEWER_QUOTA_EXCEEDED',
      `Viewer accounts may create only one ${resource}.`,
      409,
    ),
  sourceRequired: () =>
    new ApplicationError('PROJECT_SOURCE_REQUIRED', 'Upload project source before building.', 409),
  buildConflict: () =>
    new ApplicationError('BUILD_VERSION_CONFLICT', 'This project version already exists.', 409),
  licenseInvalid: () =>
    new ApplicationError('LICENSE_INVALID', 'The license is invalid, expired, or revoked.', 403),
  activationLimit: () =>
    new ApplicationError('LICENSE_ACTIVATION_LIMIT', 'The activation limit has been reached.', 409),
  serviceUnavailable: () =>
    new ApplicationError('DEPENDENCY_UNAVAILABLE', 'A required service is unavailable.', 503),
};
