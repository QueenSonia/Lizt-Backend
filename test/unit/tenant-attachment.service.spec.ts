import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { TenantAttachmentService } from '../../src/kyc-links/tenant-attachment.service';
import {
  KYCApplication,
  ApplicationStatus,
} from '../../src/kyc-links/entities/kyc-application.entity';
import { KYCLink } from '../../src/kyc-links/entities/kyc-link.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { Prop