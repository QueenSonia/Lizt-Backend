import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_ROLES, IReqUser } from 'src/base.entity';
import { ROLES_KEY } from './role.decorator';
import { IS_PUBLIC_KEY } from './auth.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
      // ✅ Skip roles guard if route is public
      const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (isPublic) return true;
      
    const roles = this.reflector.getAllAndOverride<ADMIN_ROLES[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    

    if (!roles) return true;

    const req = context.switchToHttp().getRequest();
    const user: IReqUser = req?.user ? req.user : {};

    const isAllowed = roles.some((role) => user?.role === role);

    if (!isAllowed) {
      throw new HttpException('Not Authorized', HttpStatus.UNAUTHORIZED);
    }

    return isAllowed;
  }
}
