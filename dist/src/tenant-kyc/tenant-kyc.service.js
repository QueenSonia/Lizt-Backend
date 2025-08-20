"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantKycService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const tenant_kyc_entity_1 = require("./entities/tenant-kyc.entity");
const utils_1 = require("../lib/utils");
const account_entity_1 = require("../users/entities/account.entity");
const base_entity_1 = require("../base.entity");
let TenantKycService = class TenantKycService {
    tenantKycRepo;
    accountRepo;
    constructor(tenantKycRepo, accountRepo) {
        this.tenantKycRepo = tenantKycRepo;
        this.accountRepo = accountRepo;
    }
    async create(dto) {
        const admin = await this.accountRepo.findOneBy({
            id: dto.admin_id,
            role: base_entity_1.RolesEnum.ADMIN,
        });
        if (!admin)
            throw new common_1.BadRequestException(`Invalid or non-existent ref with id: ${dto.admin_id}`);
        const identity_hash = this.generateIdentityHash(dto);
        const existingKyc = await this.tenantKycRepo.findOneBy({ identity_hash });
        if (existingKyc)
            throw new common_1.ConflictException('Duplicate request; awaiting review.');
        await this.tenantKycRepo.save({ ...dto, identity_hash });
    }
    async findAll(admin_id, query) {
        const { limit, page, fields } = query;
        const selectFields = fields ? fields.split(',').filter(Boolean) : undefined;
        const { data, pagination } = await (0, utils_1.paginate)(this.tenantKycRepo, {
            page,
            limit,
            options: {
                where: { admin_id },
                select: selectFields,
                order: { created_at: 'DESC' },
            },
        });
        return { data, pagination };
    }
    async findOne(admin_id, id) {
        const kyc_data = await this.tenantKycRepo.findOneBy({
            id,
            admin_id,
        });
        if (!kyc_data)
            throw new common_1.NotFoundException();
        return kyc_data;
    }
    async update(admin_id, id, dto) {
        const kyc_data = await this.tenantKycRepo.findOneBy({
            id,
            admin_id,
        });
        if (!kyc_data)
            throw new common_1.NotFoundException();
        Object.assign(kyc_data, dto);
        return await this.tenantKycRepo.save(kyc_data);
    }
    async deleteOne(admin_id, id) {
        const result = await this.tenantKycRepo.delete({ id, admin_id });
        if (result.affected === 0)
            throw new common_1.NotFoundException('KYC record not found');
    }
    async deleteMany(admin_id, { ids }) {
        await this.tenantKycRepo.delete(ids.map((id) => ({ id, admin_id })));
    }
    async deleteAll(admin_id) {
        await this.tenantKycRepo.delete({ admin_id });
    }
    generateIdentityHash(dto) {
        const fields = [
            dto.first_name.trim().toLowerCase(),
            dto.last_name.trim().toLowerCase(),
            dto.date_of_birth,
            dto.email?.toLowerCase() || '',
            dto.phone_number || '',
        ];
        return crypto.createHash('sha256').update(fields.join('|')).digest('hex');
    }
};
exports.TenantKycService = TenantKycService;
exports.TenantKycService = TenantKycService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(tenant_kyc_entity_1.TenantKyc)),
    __param(1, (0, typeorm_1.InjectRepository)(account_entity_1.Account)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository])
], TenantKycService);
//# sourceMappingURL=tenant-kyc.service.js.map