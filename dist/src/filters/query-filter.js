"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPropertyHistoryFilter = exports.buildServiceRequestFilter = exports.buildRentFilter = exports.buildPropertyFilter = exports.buildUserFilterQB = exports.buildUserFilter = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const buildUserFilter = async (queryParams) => {
    const query = {};
    if (queryParams?.search) {
        query['first_name'] = (0, typeorm_1.ILike)(`%${queryParams.search}%`);
    }
    if (queryParams?.first_name)
        query['first_name'] = queryParams.first_name.toLowerCase();
    if (queryParams?.last_name)
        query['last_name'] = queryParams.last_name.toLowerCase();
    if (queryParams?.email)
        query['email'] = queryParams.email.toLowerCase();
    if (queryParams?.role)
        query['role'] = queryParams.role.toLowerCase();
    if (queryParams?.phone_number)
        query['phone_number'] = queryParams.phone_number;
    if (queryParams?.creator_id)
        query['creator_id'] = queryParams.creator_id;
    if (queryParams?.start_date && queryParams?.end_date) {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(queryParams?.start_date)) {
            throw new common_1.HttpException(`use date format yy-mm-dd`, common_1.HttpStatus.NOT_ACCEPTABLE);
        }
        query['created_at'] = (0, typeorm_1.Between)(new Date(queryParams.start_date), new Date(queryParams.end_date));
    }
    return query;
};
exports.buildUserFilter = buildUserFilter;
const buildUserFilterQB = (qb, queryParams) => {
    qb.where('1=1');
    if (queryParams.first_name)
        qb.andWhere('LOWER(user.first_name) = :first_name', {
            first_name: queryParams.first_name.toLowerCase(),
        });
    if (queryParams.last_name)
        qb.andWhere('LOWER(user.last_name) = :last_name', {
            last_name: queryParams.last_name.toLowerCase(),
        });
    if (queryParams.email)
        qb.andWhere('LOWER(user.email) = :email', {
            email: queryParams.email.toLowerCase(),
        });
    if (queryParams.phone_number)
        qb.andWhere('user.phone_number = :phone_number', {
            phone_number: queryParams.phone_number,
        });
    if (queryParams.creator_id)
        qb.andWhere('user.creator_id = :creator_id', {
            creator_id: queryParams.creator_id,
        });
    if (queryParams.start_date && queryParams.end_date) {
        const start = new Date(queryParams.start_date);
        const end = new Date(queryParams.end_date);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new common_1.HttpException('Invalid date format (use YYYY-MM-DD)', common_1.HttpStatus.NOT_ACCEPTABLE);
        }
        qb.andWhere('user.created_at BETWEEN :start AND :end', {
            start,
            end,
        });
    }
    if (queryParams.search) {
        const keyword = `%${queryParams.search.toLowerCase()}%`;
        qb.andWhere(`LOWER(user.first_name) ILIKE :keyword 
       OR LOWER(user.last_name) ILIKE :keyword 
       OR LOWER(CONCAT(user.first_name, ' ', user.last_name)) ILIKE :keyword`, { keyword });
    }
    return qb;
};
exports.buildUserFilterQB = buildUserFilterQB;
const buildPropertyFilter = async (queryParams) => {
    const query = {};
    const order = {};
    if (queryParams?.search) {
        query['name'] = (0, typeorm_1.ILike)(`%${queryParams.search}%`);
    }
    if (queryParams?.name)
        query['name'] = (0, typeorm_1.ILike)(`%${queryParams.name}%`);
    if (queryParams?.owner_id)
        query['owner_id'] = queryParams.owner_id;
    if (queryParams?.location)
        query['location'] = queryParams.location.toLowerCase();
    if (queryParams?.property_status)
        query['property_status'] = queryParams.property_status.toLowerCase();
    if (queryParams?.start_date && queryParams?.end_date) {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(queryParams.start_date)) {
            throw new common_1.HttpException(`Use date format yyyy-mm-dd`, common_1.HttpStatus.NOT_ACCEPTABLE);
        }
        query['created_at'] = (0, typeorm_1.Between)(new Date(queryParams.start_date), new Date(queryParams.end_date));
    }
    if (queryParams?.sort_by && queryParams?.sort_order) {
        const allowedSortFields = ['name', 'created_at', 'rent'];
        if (allowedSortFields.includes(queryParams.sort_by)) {
            if (queryParams.sort_by === 'rent') {
                order[`rents.rental_price`] = queryParams.sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            }
            order[queryParams.sort_by] = queryParams.sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        }
    }
    return { query, order };
};
exports.buildPropertyFilter = buildPropertyFilter;
const buildRentFilter = async (queryParams) => {
    const query = {};
    if (queryParams?.property_id)
        query['property_id'] = queryParams.property_id;
    if (queryParams?.tenant_id)
        query['tenant_id'] = queryParams.tenant_id;
    if (queryParams?.owner_id)
        query['property'] = { owner_id: queryParams.owner_id };
    if (queryParams?.status)
        query['status'] = queryParams.status.toLowerCase();
    if (queryParams?.start_date && queryParams?.end_date) {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(queryParams?.start_date)) {
            throw new common_1.HttpException(`use date format yy-mm-dd`, common_1.HttpStatus.NOT_ACCEPTABLE);
        }
        query['created_at'] = (0, typeorm_1.Between)(new Date(queryParams.start_date), new Date(queryParams.end_date));
    }
    return query;
};
exports.buildRentFilter = buildRentFilter;
const buildServiceRequestFilter = async (queryParams) => {
    const query = {};
    if (queryParams?.tenant_id)
        query['tenant_id'] = queryParams.tenant_id;
    if (queryParams?.property_id)
        query['property_id'] = queryParams.property_id;
    if (queryParams?.start_date && queryParams?.end_date) {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(queryParams?.start_date)) {
            throw new common_1.HttpException(`use date format yy-mm-dd`, common_1.HttpStatus.NOT_ACCEPTABLE);
        }
        query['created_at'] = (0, typeorm_1.Between)(new Date(queryParams.start_date), new Date(queryParams.end_date));
    }
    return query;
};
exports.buildServiceRequestFilter = buildServiceRequestFilter;
const buildPropertyHistoryFilter = async (queryParams) => {
    const query = {};
    if (queryParams?.tenant_id) {
        query['tenant_id'] = queryParams.tenant_id;
    }
    if (queryParams?.property_id) {
        query['property_id'] = queryParams.property_id;
    }
    if (queryParams?.move_in_date) {
        query['move_in_date'] = queryParams.move_in_date;
    }
    if (queryParams?.move_out_date) {
        query['move_out_date'] = queryParams.move_out_date;
    }
    if (queryParams?.start_date && queryParams?.end_date) {
        const regex = /^\d{4}-\d{2}-\d{2}$/;
        if (!regex.test(queryParams?.start_date)) {
            throw new common_1.HttpException(`use date format yy-mm-dd`, common_1.HttpStatus.NOT_ACCEPTABLE);
        }
        query['created_at'] = (0, typeorm_1.Between)(new Date(queryParams.start_date), new Date(queryParams.end_date));
    }
    return query;
};
exports.buildPropertyHistoryFilter = buildPropertyHistoryFilter;
//# sourceMappingURL=query-filter.js.map