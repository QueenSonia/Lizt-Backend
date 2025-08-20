export type WhatsAppWebhookPayload = WhatsAppIncomingMessagePayload | WhatsAppStatusUpdatePayload;
export type IncomingMessage = {
    from: string;
    id: string;
    timestamp: string;
    type: string;
    text?: {
        body: string;
    };
    interactive?: {
        type: string;
        button_reply: {
            id: string;
            title: string;
        };
    };
    context?: {
        from: string;
        id: string;
    };
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
                    profile: {
                        name: string;
                    };
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
                        expiration_timestamp?: string;
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
