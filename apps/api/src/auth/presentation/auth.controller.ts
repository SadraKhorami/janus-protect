import type { AppConfig } from '@janus/config';
import type { Account, AuthResponse, MessageResponse } from '@janus/contracts';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResendVerificationInput,
  type ResetPasswordInput,
  type VerifyEmailInput,
} from '@janus/validation';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { APP_CONFIG } from '../../app.tokens';
import type { JanusRequest } from '../../common/http/janus-request';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { PasswordRecoveryService } from '../application/password-recovery.service';
import { RegistrationService } from '../application/registration.service';
import { SessionService, type LoginResult } from '../application/session.service';
import { AccessTokenGuard } from './access-token.guard';

const refreshCookie = 'janus_refresh';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(RegistrationService) private readonly registration: RegistrationService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PasswordRecoveryService) private readonly passwords: PasswordRecoveryService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register an unverified account and personal organization' })
  register(
    @Body(new ZodValidationPipe(registerSchema)) input: RegisterInput,
    @Req() request: JanusRequest,
  ): Promise<MessageResponse> {
    return this.registration.register(input, this.requestContext(request));
  }

  @Post('verify-email')
  @HttpCode(200)
  @ApiOperation({ summary: 'Verify an email using a single-use six-digit code' })
  verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema)) input: VerifyEmailInput,
    @Req() request: JanusRequest,
  ): Promise<MessageResponse> {
    return this.registration.verifyEmail(input, this.requestContext(request));
  }

  @Post('resend-verification')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request another verification code' })
  resendVerification(
    @Body(new ZodValidationPipe(resendVerificationSchema)) input: ResendVerificationInput,
    @Req() request: JanusRequest,
  ): Promise<MessageResponse> {
    return this.registration.resendVerification(input, this.requestContext(request));
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Create a rotating authentication session' })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) input: LoginInput,
    @Req() request: JanusRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const result = await this.sessions.login(input, {
      ...this.requestContext(request),
      userAgent: request.header('user-agent') ?? null,
    });
    return this.attachRefreshCookie(response, result);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate a refresh token and issue a new access token' })
  async refresh(
    @Req() request: JanusRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    this.requireTrustedClient(request);
    const result = await this.sessions.refresh(
      this.cookie(request, refreshCookie),
      this.requestContext(request).clientKey,
    );
    return this.attachRefreshCookie(response, result);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(
    @Req() request: JanusRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.requireTrustedClient(request);
    const token = this.cookie(request, refreshCookie);
    await this.sessions.logout(token ? token.split('.')[0] : undefined);
    response.clearCookie(refreshCookie, { path: '/api/v1/auth' });
  }

  @Post('forgot-password')
  @HttpCode(202)
  @ApiOperation({ summary: 'Request a password reset without account enumeration' })
  forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema)) input: ForgotPasswordInput,
    @Req() request: JanusRequest,
  ): Promise<MessageResponse> {
    return this.passwords.forgotPassword(input, this.requestContext(request));
  }

  @Post('reset-password')
  @HttpCode(200)
  @ApiOperation({ summary: 'Consume a single-use reset token and revoke active sessions' })
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema)) input: ResetPasswordInput,
    @Req() request: JanusRequest,
  ): Promise<MessageResponse> {
    return this.passwords.resetPassword(input, this.requestContext(request));
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the authenticated account and organization membership' })
  me(@Req() request: JanusRequest): Promise<Account> {
    if (!request.auth) throw new BadRequestException('Missing authentication context.');
    return this.sessions.me(request.auth.userId);
  }

  private attachRefreshCookie(response: Response, result: LoginResult): AuthResponse {
    response.cookie(refreshCookie, result.refreshToken, {
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: this.config.REFRESH_TOKEN_TTL_SECONDS * 1000,
    });
    return {
      account: result.account,
      accessToken: result.accessToken,
      accessTokenExpiresIn: result.accessTokenExpiresIn,
    };
  }

  private requestContext(request: JanusRequest): { clientKey: string; requestId?: string } {
    const clientKey = request.ip ?? request.socket.remoteAddress ?? 'unknown';
    return request.requestId ? { clientKey, requestId: request.requestId } : { clientKey };
  }

  private cookie(request: JanusRequest, name: string): string | undefined {
    const cookies = request.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[name];
  }

  private requireTrustedClient(request: JanusRequest): void {
    if (request.header('x-janus-client') !== 'web') {
      throw new BadRequestException('Missing client header.');
    }
  }
}
