import { Controller, Post, Body, Get, Param, Req, UseGuards } from '@nestjs/common';
import { NoticeAgreementService } from './notice-agreement.service';
import { CreateNoticeAgreementDto } from './dto/create-notice-agreement.dto';
import { RoleGuard } from 'src/auth/role.guard';

@Controller('notice-agreement')
export class NoticeAgreementController {
  constructor(private readonly service: NoticeAgreementService) {}

  @Post()
  create(@Body() dto: CreateNoticeAgreementDto) {
    return this.service.create(dto);
  }
  
  @UseGuards(RoleGuard)
  @Get()
  getAllNoticeAgreement(@Req() req: any){
    const owner_id = req?.user?.id
    return this.service.getAllNoticeAgreement(owner_id)
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }


}