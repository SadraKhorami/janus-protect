import type {
  IssuedLicense,
  License,
  LicenseActivationResult,
  MessageResponse,
} from '@janus/contracts';
import {
  activateLicenseSchema,
  createLicenseSchema,
  deactivateLicenseSchema,
  validateLicenseSchema,
  type ActivateLicenseInput,
  type CreateLicenseInput,
  type ValidateLicenseInput,
} from '@janus/validation';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import type { JanusRequest } from '../common/http/janus-request';
import { ZodValidationPipe } from '../common/http/zod-validation.pipe';
import { errors } from '../common/errors/application-error';
import { LicensingService } from './licensing.service';

@ApiTags('Licensing')
@Controller('licenses')
export class PublicLicensingController {
  constructor(@Inject(LicensingService) private readonly licensing: LicensingService) {}

  @Post('activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate a license for a WordPress site' })
  activate(
    @Body(new ZodValidationPipe(activateLicenseSchema)) input: ActivateLicenseInput,
    @Req() request: JanusRequest,
  ): Promise<LicenseActivationResult> {
    return this.licensing.activate(input, clientKey(request));
  }

  @Post('validate')
  @HttpCode(200)
  validate(
    @Body(new ZodValidationPipe(validateLicenseSchema)) input: ValidateLicenseInput,
    @Req() request: JanusRequest,
  ): Promise<LicenseActivationResult> {
    return this.licensing.validate(input, clientKey(request));
  }

  @Post('deactivate')
  @HttpCode(200)
  async deactivate(
    @Body(new ZodValidationPipe(deactivateLicenseSchema)) input: ValidateLicenseInput,
    @Req() request: JanusRequest,
  ): Promise<MessageResponse> {
    await this.licensing.deactivate(input, clientKey(request));
    return { message: 'License deactivated.' };
  }
}

@ApiTags('Project licenses')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('projects/:projectId/licenses')
export class ProjectLicensingController {
  constructor(@Inject(LicensingService) private readonly licensing: LicensingService) {}

  @Post()
  create(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(createLicenseSchema)) input: CreateLicenseInput,
    @Req() request: JanusRequest,
  ): Promise<IssuedLicense> {
    const auth = requireAuth(request);
    requireManager(auth.role);
    return this.licensing.create(auth.organizationId, auth.userId, projectId, input);
  }

  @Get()
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Req() request: JanusRequest,
  ): Promise<License[]> {
    return this.licensing.list(requireAuth(request).organizationId, projectId);
  }

  @Post(':licenseId/revoke')
  @HttpCode(200)
  revoke(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('licenseId', ParseUUIDPipe) licenseId: string,
    @Req() request: JanusRequest,
  ): Promise<License> {
    const auth = requireAuth(request);
    requireManager(auth.role);
    return this.licensing.revoke(auth.organizationId, auth.userId, projectId, licenseId);
  }
}

function clientKey(request: JanusRequest): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

function requireAuth(request: JanusRequest) {
  if (!request.auth) throw new Error('Authentication context is missing.');
  return request.auth;
}

function requireManager(role: string): void {
  if (role !== 'OWNER' && role !== 'ADMIN') throw errors.forbidden();
}
