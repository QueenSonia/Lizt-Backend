/**
 * Tenant-related types
 * Used by TenantManagementService and related services
 */

export interface TenantInfo {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
}

export enum PropertyStatusEnum {
  VACANT = 'vacant',
  OCCUPIED = 'occupied',
  MAINTENANCE = 'maintenance',
  READY_FOR_MARKETING = 'ready_for_marketing',
}

export interface PropertyInfo {
  id: string;
  name: string;
  address: string;
  status: PropertyStatusEnum;
}

export enum RentStatusEnum {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  PENDING = 'pending',
  CANCELLED = 'cancelled',
}

export enum RentPaymentStatusEnum {
  PAID = 'paid',
  UNPAID = 'unpaid',
  PARTIAL = 'partial',
  OVERDUE = 'overdue',
}

export interface RentInfo {
  id: string;
  amount: number;
  dueDate: Date;
  status: RentStatusEnum;
  paymentStatus: RentPaymentStatusEnum;
}

export interface TenantPropertyInfo {
  tenant: TenantInfo;
  property: PropertyInfo | null;
  rent: RentInfo | null;
}

export interface AttachResult {
  success: boolean;
  message: string;
  tenantId: string;
  propertyId: string;
}

export interface KycAttachDto {
  kycApplicationId: string;
  propertyId: string;
  rentAmount: number;
  rentFrequency: string;
  tenancyStartDate: string;
  rentDueDate: string;
  serviceCharge: number;
}

export interface TeamMemberInput {
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber: string;
  role: string;
}

export interface UpdateTeamMemberDto {
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  role?: string;
}
