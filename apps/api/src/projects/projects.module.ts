import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectService } from './application/project.service';
import { PROJECT_REPOSITORY } from './domain/project.ports';
import { PrismaProjectRepository } from './infrastructure/prisma-project.repository';
import { ProjectsController } from './presentation/projects.controller';

@Module({
  imports: [AuthModule],
  controllers: [ProjectsController],
  providers: [ProjectService, { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository }],
})
export class ProjectsModule {}
