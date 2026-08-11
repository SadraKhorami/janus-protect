import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { InfrastructureModule } from './infrastructure.module';

@Module({
  imports: [InfrastructureModule, AuthModule],
  controllers: [HealthController],
})
export class AppModule {}
