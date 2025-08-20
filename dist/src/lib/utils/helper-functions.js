"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginate = paginate;
async function paginate(repository, { page = 1, limit, defaultLimit = 10, maxLimit = 50, options = {}, }) {
    const take = Math.min(limit || defaultLimit, maxLimit);
    const skip = (page - 1) * take;
    const [data, total] = await repository.findAndCount({
        ...options,
        take,
        skip,
    });
    return {
        data,
        pagination: {
            total,
            page,
            limit: take,
            totalPages: Math.ceil(total / take),
        },
    };
}
//# sourceMappingURL=helper-functions.js.map