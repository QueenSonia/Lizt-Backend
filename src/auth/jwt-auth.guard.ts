import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './auth.decorator';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from 'src/users/entities/account.entity';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {
    super();
  }

  // Override to attach the full Account entity (from DB) to request.user
  async canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Call passport's JWT auth first to validate the token and populate request.user (payload)
    const passportCan = (await super.canActivate(context)) as boolean;
    if (!passportCan) return false;

    const req = context.switchToHttp().getRequest();
    const jwtUser = req.user;

    // If the JWT payload provided an id, fetch the full Account from DB and replace request.user
    if (jwtUser && jwtUser.id) {
      try {
        const account = await this.accountRepository.findOne({
          where: { id: jwtUser.id },
          relations: ['user'],
        });
        if (account) {
          req.user = account;
        }
      } catch (error) {
        // If DB lookup fails, keep the JWT payload on request.user and allow guard to succeed
        // Logging omitted here to avoid noisy logs in guard
      }
    }

    return true;
  }
}
