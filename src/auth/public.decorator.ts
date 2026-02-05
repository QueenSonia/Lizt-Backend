import { SetMetadata } from '@nestjs/common';

// Re-export from auth.decorator to maintain a single source of truth
export { IS_PUBLIC_KEY, SkipAuth as Public } from './auth.decorator';
