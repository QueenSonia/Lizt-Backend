import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { TwilioService } from './services/twilio.service';
import { CreateTwilioDto } from './dto/create-twilio.dto';
import {
  ApiOperation,
  ApiBody,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { AfricaTalkingService } from './services/africastalking.service';

@ApiTags('Twilio')
@Controller('twilio')
export class WhatsAppController {
  constructor(
    private readonly twilioService: TwilioService,
     private readonly africaTalkingService: AfricaTalkingService
  ) {}

  @ApiOperation({ summary: 'Send WhatsApp Message with Media' })
  @ApiBody({ type: CreateTwilioDto })
  @ApiCreatedResponse({ description: 'Message sent successfully' })
  @ApiBadRequestResponse({ description: 'Failed to send message' })
  @ApiSecurity('access_token')
@Post('send-whatsapp')
async TwilioSendWhatsAppMedia(@Body() payload: CreateTwilioDto) {
  try {
    const { to, mediaUrl, body } = payload;
    const result = await this.twilioService.sendWhatsAppMediaMessage(
      to,
      mediaUrl,
      body,
    );
    return { message: 'WhatsApp message sent successfully', data: result };
  } catch (error) {
    throw new BadRequestException(error.message || 'Failed to send WhatsApp message');
  }
}

async AfricaTalkingSendWhatsAppMedia(@Body() payload: any) {
  try {
    const { to, message } = payload;
    const result = await this.africaTalkingService.sendWhatsAppMessage(
      to,
      message
    );
    return { message: 'WhatsApp message sent successfully', data: result };
  } catch (error) {
    throw new BadRequestException(error.message || 'Failed to send WhatsApp message');
  }
}

}
