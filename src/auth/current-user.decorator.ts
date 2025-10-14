import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Account } from 'src/users/entities/account.entity';

/**
 * Custom decorator to extract the authenticated user (Account) from the request object.
 */
export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): Account => {
    const request = ctx.switchToHttp().getRequest();

    // This assumes your authentication guard attaches the full account object to request.user
    return request.user;
  },
);
