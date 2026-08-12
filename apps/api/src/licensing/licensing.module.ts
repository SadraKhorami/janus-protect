import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectLicensingController, PublicLicensingController } from './licensing.controller';
import { LicensingService } from './licensing.service';

@Module({
  imports: [AuthModule],
  controllers: [PublicLicensingController, ProjectLicensingController],
  providers: [LicensingService],
})
export class LicensingModule {}
