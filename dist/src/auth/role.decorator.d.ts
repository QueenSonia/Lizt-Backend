export declare const ROLES_KEY = "roles";
export type UserRole = 'user' | 'admin';
export declare const Roles: (...roles: UserRole[]) => import("@nestjs/common").CustomDecorator<string>;
