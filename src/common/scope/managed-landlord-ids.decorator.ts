import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Injects `string[]` — the landlord account ids the current requester manages /
 * may see, as resolved by {@link ManagedScopeInterceptor}. The controller MUST
 * apply `@UseInterceptors(ManagedScopeInterceptor)` or this is always [].
 *
 * An empty array means "no landlords in scope" — downstream queries must treat
 * it as "return nothing", never "no filter".
 */
export const ManagedLandlordIds = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string[] => {
    const req = ctx.switchToHttp().getRequest();
    return (req.managedLandlordIds as string[]) ?? [];
  },
);
