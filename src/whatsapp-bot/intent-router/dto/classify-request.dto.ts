export interface ClassifyRequest {
  text: string;
  priorBotMessage?: string | null;
  priorBotType?: string | null;
  tenant: {
    accountId: string;
    name: string;
    propertyCount: number;
  };
}

export interface ClassifyContext {
  phoneNumber: string;
  tenant: ClassifyRequest['tenant'];
  landlordId: string;
}
