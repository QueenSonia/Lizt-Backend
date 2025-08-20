import { NoticeAgreement } from '../entities/notice-agreement.entity';
import { Users } from 'src/users/entities/user.entity';
export declare const generatePdfBufferFromEditor: (htmlContent: string) => Promise<Buffer>;
export declare const generatePdfBufferFromHtml: (html: string) => Promise<Buffer>;
export declare const generatePdfFromTemplate: (agreement: NoticeAgreement, tenant: Users) => Promise<string>;
export declare const generatePdfBufferFromTemplate: (agreement: any, tenant: Users) => Promise<Buffer>;
