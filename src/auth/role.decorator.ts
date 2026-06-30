import { SetMetadata } from '@nestjs/common';
import { RolesEnum } from 'src/base.entity';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route to one or more roles. Pass {@link RolesEnum} members
 * (type-safe — bare strings are rejected at compile time). The RoleGuard
 * compares the caller's ACTIVE session role against this list.
 */
export const Roles = (...roles: RolesEnum[]) => SetMetadata(ROLES_KEY, roles);
