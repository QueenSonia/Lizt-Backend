// import { SetMetadata } from '@nestjs/common';
// import { ADMIN_ROLES } from 'src/base.entity';

// export const ROLES_KEY = 'roles';
// export const Roles = (...roles: ADMIN_ROLES[]) => SetMetadata(ROLES_KEY, roles);

import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export type UserRole = 'user' | 'admin';

export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
