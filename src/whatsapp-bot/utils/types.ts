export type WhatsAppWebhookPayload =
  | WhatsAppIncomingMessagePayload
  | WhatsAppStatusUpdatePayload;

export type IncomingMessage = {
  from: string;
  id: string;
  timestamp: string;
  type: string; // e.g. "text", "image", "button", etc.
  text?: {
    body: string;
  };

  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
    // Sent when a user completes a Flow (clicks the terminal screen's
    // `complete` action). `response_json` is a stringified JSON of the
    // payload from that screen.
    nfm_reply?: { name: string; body: string; response_json: string };
  };

  button?: {
    text: string;
    payload?: string;
  };

  // Inbound media. `id` is Meta's media id, resolved to a download URL via the
  // Graph API (see WhatsAppMediaService.downloadInboundMedia). `link` is a
  // pre-hosted public URL set by the in-house simulator (used directly).
  image?: {
    id?: string;
    mime_type?: string;
    caption?: string;
    sha256?: string;
    link?: string;
  };
  video?: {
    id?: string;
    mime_type?: string;
    caption?: string;
    sha256?: string;
    link?: string;
  };

  // Emoji reaction to a previous message. `message_id` is the wamid of the
  // message being reacted to; `emoji` is absent/empty when the user removes
  // their reaction.
  reaction?: {
    message_id?: string;
    emoji?: string;
  };

  context?: {
    from: string;
    id: string;
  };

  // Simulator-specific field to identify simulated messages
  is_simulated?: boolean;
};

export type WhatsAppIncomingMessagePayload = {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      field: 'messages';
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts: Array<{
          profile: { name: string };
          wa_id: string;
        }>;
        messages: IncomingMessage[];
      };
    }>;
  }>;
};

export type WhatsAppStatusUpdatePayload = {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      field: 'messages';
      value: {
        messaging_product: 'whatsapp';
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        statuses: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed' | string;
          timestamp: string;
          recipient_id: string;
          conversation: {
            id: string;
            origin: {
              type: 'service' | string;
            };
            expiration_timestamp?: string; // usually only in "sent"
          };
          pricing: {
            billable: boolean;
            pricing_model: string;
            category: string;
            type: string;
          };
        }>;
      };
    }>;
  }>;
};
