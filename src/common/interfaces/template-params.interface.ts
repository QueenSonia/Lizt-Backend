/**
 * Template parameter types for WhatsApp messaging
 * Used by TemplateSenderService for sending templated messages
 */

export interface CurrencyParameter {
  fallback_value: string;
  code: string;
  amount_1000: number;
}

export interface DateTimeParameter {
  fallback_value: string;
}

export interface MediaParameter {
  link: string;
}

export type TemplateParameterType =
  | 'text'
  | 'currency'
  | 'date_time'
  | 'image'
  | 'document'
  | 'video';

export interface TemplateParameter {
  type: TemplateParameterType;
  text?: string;
  currency?: CurrencyParameter;
  date_time?: DateTimeParameter;
  image?: MediaParameter;
  document?: MediaParameter;
  video?: MediaParameter;
}

export type TemplateComponentType = 'header' | 'body' | 'button';

export interface TemplateComponent {
  type: TemplateComponentType;
  parameters: TemplateParameter[];
}

export interface TemplateParams {
  phone_number: string;
  template_name: string;
  language_code: string;
  components: TemplateComponent[];
}

export interface FMTemplateParams {
  phone_number: string;
  name: string;
  team: string;
  role: string;
  password?: string;
}

export interface TenantWelcomeParams {
  phone_number: string;
  tenant_name: string;
  landlord_name: string;
}

export interface PropertyTemplateParams {
  phone_number: string;
  name: string;
  property_name: string;
}

export interface UserAddedParams {
  phone_number: string;
  name: string;
  user: string;
  property_name: string;
}

export interface TenantConfirmParams {
  phone_number: string;
  tenant_name: string;
  property_name: string;
  landlord_name: string;
  move_in_date: string;
}
