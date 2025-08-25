import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  ForbiddenException,
  Req,
  Res,
  HttpCode,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';

import { WhatsappBotService } from './whatsapp-bot.service';
import { CreateWhatsAppBotMessage } from './dto/create-whatsapp-bot-message.dto';
import { SkipAuth } from 'src/auth/auth.decorator';
import {
  decryptRequest,
  encryptResponse,
  FlowEndpointException,
  WhatsAppWebhookPayload,
} from './utils';
import { isRequestSignatureValid } from './utils/validate-request';
import { Public } from 'src/auth/public.decorator';

@Controller('whatsapp')
export class WhatsappBotController {
  constructor(
    private readonly whatsappBotService: WhatsappBotService,
    private readonly config: ConfigService,
  ) {}

  @SkipAuth()
  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const verifyToken = this.config.get('WEBHOOK_VERIFICATION_TOKEN');
    console.log(
      `Webhook verification: mode=${mode}, token=${token}, challenge=${challenge}`,
    );

    if (mode === 'subscribe' && token === verifyToken) return challenge;

    throw new ForbiddenException();
  }

  @SkipAuth()
  @Post('webhook')
  async create(@Body() payload: WhatsAppWebhookPayload) {
    try {
      const value: any = payload?.entry?.[0]?.changes?.[0]?.value;
      const messages = value?.messages;
      if (Array.isArray(messages)) {
        await this.whatsappBotService.handleMessage(messages);
      }
    } catch (error) {
      console.error('Webhook error:', error);
    }
  }

  @SkipAuth()
  @HttpCode(200)
  @Post('')
  async handleRequest(@Req() req: Request, @Res() res: Response) {
    console.log('hi');
    if (!process.env.PRIVATE_KEY) {
      throw new Error(
        'Private key is empty. Please check your env variable "PRIVATE_KEY".',
      );
    }

    const app_secret = this.config.get('M4D_APP_SECRET');

    if (!isRequestSignatureValid(req, app_secret)) {
      // Return status code 432 if request signature does not match.
      // To learn more about return error codes visit: https://developers.facebook.com/docs/whatsapp/flows/reference/error-codes#endpoint_error_codes
      return res.status(432).send();
    }

    let decryptedRequest: any = null;
    try {
      decryptedRequest = decryptRequest(
        req.body,
        process.env.PRIVATE_KEY,
        process.env.PASSPHRASE!,
      );
    } catch (err) {
      console.error(err);
      if (err instanceof FlowEndpointException) {
        return res.status(err.statusCode).send();
      }
      return res.status(500).send();
    }

    const { aesKeyBuffer, initialVectorBuffer, decryptedBody } =
      decryptedRequest;
    // console.log('💬 Decrypted Request:', decryptedBody);

    // TODO: Uncomment this block and add your flow token validation logic.
    // If the flow token becomes invalid, return HTTP code 427 to disable the flow and show the message in `error_msg` to the user
    // Refer to the docs for details https://developers.facebook.com/docs/whatsapp/flows/reference/error-codes#endpoint_error_codes

    /*
  if (!isValidFlowToken(decryptedBody.flow_token)) {
    const error_response = {
      error_msg: `The message is no longer available`,
    };
    return res
      .status(427)
      .send(
        encryptResponse(error_response, aesKeyBuffer, initialVectorBuffer)
      );
  }
  */

    const screenResponse =
      await this.whatsappBotService.getNextScreen(decryptedBody);
    console.log('👉 Response to Encrypt:', screenResponse);

    res.send(
      encryptResponse(screenResponse, aesKeyBuffer, initialVectorBuffer),
    );
  }

  @Post('/user-message')
  async sendToUserWithTemplate(@Req() req: Request) {
    try {
      const { phone_number, customer_name } = req.body as {
        phone_number: string;
        customer_name: string;
      };
      const response =
        await this.whatsappBotService.sendToAgentWithTemplate(phone_number);
      return response;
    } catch (error) {
      console.error('Error sending user message:', error);
      throw error;
    }
  }

  @Post('/facility-message')
  async sendToFacilityManagerWithTemplate(@Req() req: Request) {
    try {
      const { phone_number, name, team, role } = req.body as any;
      const response =
        await this.whatsappBotService.sendToFacilityManagerWithTemplate({
          phone_number,
          name,
          team,
          role,
        });
      return response;
    } catch (error) {
      console.error('Error sending user message:', error);
      throw error;
    }
  }
}
