import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { InfrastructureModule } from './infrastructure.module';
import { LicensingModule } from './licensing/licensing.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [InfrastructureModule, AuthModule, ProjectsModule, LicensingModule],
  controllers: [HealthController],
})
export class AppModule {}
