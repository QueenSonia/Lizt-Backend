import {
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn()
  public created_at?: Date | string;

  @UpdateDateColumn()
  public updated_at?: Date | string;

  @Column({ default: null, nullable: true })
  public deleted_at?: Date;
}

export interface IPagination {
  totalRows: number;
  perPage: number;
  currentPage: number;
  totalPages: number;
  hasNextPage: boolean;
}

export interface IReqUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  role: string;
}

export enum ADMIN_ROLES {
  ADMIN = 'admin',
}

export enum RolesEnum {
  ADMIN = 'admin',
  TENANT = 'tenant',
  REP = 'rep',
  FACILITY_MANAGER = 'facility_manager',
  LANDLORD = 'landlord',
}

// const a = '';
