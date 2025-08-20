"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateTenantKycDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const create_tenant_kyc_dto_1 = require("./create-tenant-kyc.dto");
class UpdateTenantKycDto extends (0, swagger_1.PartialType)(create_tenant_kyc_dto_1.CreateTenantKycDto) {
    static _OPENAPI_METADATA_FACTORY() {
        return {};
    }
}
exports.UpdateTenantKycDto = UpdateTenantKycDto;
//# sourceMappingURL=update-tenant-kyc.dto.js.map