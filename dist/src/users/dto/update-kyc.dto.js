"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateKycDto = void 0;
const openapi = require("@nestjs/swagger");
const mapped_types_1 = require("@nestjs/mapped-types");
const create_kyc_dto_1 = require("./create-kyc.dto");
class UpdateKycDto extends (0, mapped_types_1.PartialType)(create_kyc_dto_1.CreateKycDto) {
    static _OPENAPI_METADATA_FACTORY() {
        return {};
    }
}
exports.UpdateKycDto = UpdateKycDto;
//# sourceMappingURL=update-kyc.dto.js.map