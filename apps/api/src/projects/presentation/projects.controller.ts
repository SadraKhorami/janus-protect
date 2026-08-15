import type { Build, Project, ProjectSource, ProtectionProfile } from '@janus/contracts';
import {
  createBuildSchema,
  createProjectSchema,
  protectionProfileSchema,
  updateProjectSchema,
  type CreateBuildInput,
  type CreateProjectInput,
  type ProtectionProfileInput,
  type UpdateProjectInput,
} from '@janus/validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AccessTokenGuard } from '../../auth/presentation/access-token.guard';
import type { JanusRequest } from '../../common/http/janus-request';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { ProjectService } from '../application/project.service';

@ApiTags('Projects and builds')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller('projects')
export class ProjectsController {
  constructor(@Inject(ProjectService) private readonly projects: ProjectService) {}

  @Post()
  @ApiOperation({ summary: 'Create a tenant-owned WordPress project' })
  create(
    @Req() request: JanusRequest,
    @Body(new ZodValidationPipe(createProjectSchema)) input: CreateProjectInput,
  ): Promise<Project> {
    return this.projects.create(requireAuth(request), input);
  }

  @Get()
  list(@Req() request: JanusRequest): Promise<Project[]> {
    return this.projects.list(requireAuth(request).organizationId);
  }

  @Get(':projectId')
  get(
    @Req() request: JanusRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Project> {
    return this.projects.get(requireAuth(request).organizationId, projectId);
  }

  @Patch(':projectId')
  update(
    @Req() request: JanusRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) input: UpdateProjectInput,
  ): Promise<Project> {
    return this.projects.update(requireAuth(request).organizationId, projectId, input);
  }

  @Delete(':projectId')
  @HttpCode(204)
  async archive(
    @Req() request: JanusRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<void> {
    await this.projects.archive(requireAuth(request), projectId);
  }

  @Post(':projectId/source/upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  uploadSource(
    @Req() request: JanusRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @UploadedFile()
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined,
  ): Promise<ProjectSource> {
    return this.projects.uploadSource(requireAuth(request), projectId, file);
  }

  @Get(':projectId/protection')
  getProtection(
    @Req() request: JanusRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProtectionProfile> {
    return this.projects.getProtection(requireAuth(request).organizationId, projectId);
  }

  @Put(':projectId/protection')
  setProtection(
    @Req() request: JanusRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(protectionProfileSchema)) input: ProtectionProfileInput,
  ): Promise<ProtectionProfile> {
    return this.projects.setProtection(requireAuth(request).organizationId, projectId, input);
  }

  @Post(':projectId/builds')
  createBuild(
    @Req() request: JanusRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(createBuildSchema)) input: CreateBuildInput,
  ): Promise<Build> {
    return this.projects.createBuild(requireAuth(request), projectId, input);
  }

  @Get(':projectId/builds/:buildId')
  getBuild(
    @Req() request: JanusRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('buildId', ParseUUIDPipe) buildId: string,
  ): Promise<Build> {
    return this.projects.getBuild(requireAuth(request).organizationId, projectId, buildId);
  }

  @Get(':projectId/builds/:buildId/artifacts/:artifactId')
  async downloadArtifact(
    @Req() request: JanusRequest,
    @Res() response: Response,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('buildId', ParseUUIDPipe) buildId: string,
    @Param('artifactId', ParseUUIDPipe) artifactId: string,
  ): Promise<void> {
    const artifact = await this.projects.downloadArtifact(
      requireAuth(request).organizationId,
      projectId,
      buildId,
      artifactId,
    );
    response.setHeader('content-type', artifact.contentType);
    response.setHeader('content-disposition', `attachment; filename="${artifact.filename}"`);
    response.send(artifact.body);
  }
}

function requireAuth(request: JanusRequest): {
  userId: string;
  organizationId: string;
  role: string;
} {
  if (!request.auth) throw new Error('Authentication guard did not populate the request.');
  return {
    userId: request.auth.userId,
    organizationId: request.auth.organizationId,
    role: request.auth.role,
  };
}
