/**
 * WhatsApp API payload types
 * Used for communication with the WhatsApp Business API
 */

import { TemplateComponent } from './template-params.interface';

export interface WhatsappTemplate {
  name: string;
  language: { code: string };
  components: TemplateComponent[];
}

export interface WhatsappText {
  preview_url: boolean;
  body: string;
}

export interface InteractiveHeader {
  type: 'text' | 'image' | 'video' | 'document';
  text?: string;
}

export interface InteractiveBody {
  text: string;
}

export interface InteractiveFooter {
  text: string;
}

export interface InteractiveButtonReply {
  id: string;
  title: string;
}

export interface InteractiveButton {
  type: 'reply';
  reply: InteractiveButtonReply;
}

export interface InteractiveSectionRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveSection {
  title: string;
  rows: InteractiveSectionRow[];
}

export interface InteractiveAction {
  buttons?: InteractiveButton[];
  sections?: InteractiveSection[];
}

export type WhatsappInteractiveType = 'button' | 'list';

export interface WhatsappInteractive {
  type: WhatsappInteractiveType;
  header?: InteractiveHeader;
  body: InteractiveBody;
  footer?: InteractiveFooter;
  action: InteractiveAction;
}

export type WhatsappMessageType = 'template' | 'text' | 'interactive';

export interface WhatsappPayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: WhatsappMessageType;
  template?: WhatsappTemplate;
  text?: WhatsappText;
  interactive?: WhatsappInteractive;
}
