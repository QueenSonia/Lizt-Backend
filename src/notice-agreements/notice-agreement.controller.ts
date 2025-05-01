import { Controller, Post, Body, Get, Param } from '@nestjs/common';
import { NoticeAgreementService } from './notice-agreement.service';
import { CreateNoticeAgreementDto } from './dto/create-notice-agreement.dto';

@Controller('notice-agreement')
export class NoticeAgreementController {
  constructor(private readonly service: NoticeAgreementService) {}

  @Post()
  create(@Body() dto: CreateNoticeAgreementDto) {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}