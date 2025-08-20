"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateNoticeAgreementDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const notice_agreement_entity_1 = require("../entities/notice-agreement.entity");
class CreateNoticeAgreementDto {
    notice_type;
    effective_date;
    property_id;
    tenant_id;
    html_content;
    static _OPENAPI_METADATA_FACTORY() {
        return { notice_type: { required: true, enum: require("../entities/notice-agreement.entity").NoticeType }, effective_date: { required: true, type: () => Date }, property_id: { required: true, type: () => String, format: "uuid" }, tenant_id: { required: true, type: () => String, format: "uuid" }, html_content: { required: true, type: () => String } };
    }
}
exports.CreateNoticeAgreementDto = CreateNoticeAgreementDto;
__decorate([
    (0, class_validator_1.IsEnum)(notice_agreement_entity_1.NoticeType),
    __metadata("design:type", String)
], CreateNoticeAgreementDto.prototype, "notice_type", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", Date)
], CreateNoticeAgreementDto.prototype, "effective_date", void 0);
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateNoticeAgreementDto.prototype, "property_id", void 0);
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateNoticeAgreementDto.prototype, "tenant_id", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateNoticeAgreementDto.prototype, "html_content", void 0);
//# sourceMappingURL=create-notice-agreement.dto.js.map