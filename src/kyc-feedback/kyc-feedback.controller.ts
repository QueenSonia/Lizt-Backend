import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse } from '@nestjs/swagger';
import { KycFeedbackService } from './kyc-feedback.service';
import { CreateKycFeedbackDto } from './dto';
import { SkipAuth } from 'src/auth/auth.decorator';
import { RoleGuard } from 'src/auth/role.guard';
import { RolesEnum } from 'src/base.entity';
import { Roles } from 'src/auth/role.decorator';
import { CurrentUser } from 'src/lib/utils';

@Controller('kyc-feedback')
export class KycFeedbackController {
  constructor(private readonly feedbackService: KycFeedbackService) {}

  /**
   * Submit KYC form feedback
   * @remarks Allows tenants to submit feedback after completing KYC form
   * @throws {422} `Unprocessable Entity` - Failed payload validation
   * @throws {500} `Internal Server Error`
   */
  @SkipAuth()
  @ApiOkResponse({ description: 'Feedback submitted successfully' })
  @HttpCode(HttpStatus.OK)
  @Post()
  create(@Body() createFeedbackDto: CreateKycFeedbackDto) {
    return this.feedbackService.create(createFeedbackDto);
  }

  /**
   * Get all feedback for landlord
   * @remarks Only accessible by landlords
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  @Get()
  findAll(@CurrentUser('id') landlord_id: string) {
    return this.feedbackService.findAll(landlord_id);
  }

  /**
   * Get feedback statistics
   * @remarks Only accessible by landlords
   * @throws {401} `Unauthorized`
   * @throws {403} `Forbidden` - Access denied due to insufficient role permissions
   * @throws {500} `Internal Server Error`
   */
  @ApiOkResponse({ description: 'Operation successful' })
  @ApiBearerAuth()
  @UseGuards(RoleGuard)
  @Roles(RolesEnum.LANDLORD)
  @Get('statistics')
  getStatistics(@CurrentUser('id') landlord_id: string) {
    return this.feedbackService.getStatistics(landlord_id);
  }

  /**
   * Get all feedback statistics (admin)
   * @remarks No authentication required - password protected on frontend
   * @throws {500} `Internal Server Error`
   */
  @SkipAuth()
  @ApiOkResponse({ description: 'Operation successful' })
  @HttpCode(HttpStatus.OK)
  @Get('admin/statistics')
  getAdminStatistics() {
    return this.feedbackService.getAdminStatistics();
  }
}
