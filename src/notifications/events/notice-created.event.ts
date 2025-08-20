export interface NoticeAgreementCreatedEvent {
  notice_id: number;
  user_id: string;
  date: string;
  property_id: string;
  property_name:string;
  tenant_name: string;
}