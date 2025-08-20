"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadNoticeDocumentDto = void 0;
const openapi = require("@nestjs/swagger");
class UploadNoticeDocumentDto {
    document_url;
    static _OPENAPI_METADATA_FACTORY() {
        return { document_url: { required: true, type: () => [String] } };
    }
}
exports.UploadNoticeDocumentDto = UploadNoticeDocumentDto;
//# sourceMappingURL=uplaod-notice-document.dto.js.map