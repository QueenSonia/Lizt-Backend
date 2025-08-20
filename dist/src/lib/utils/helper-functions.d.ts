import { Repository, FindManyOptions, ObjectLiteral } from 'typeorm';
interface PaginateOptions<T extends ObjectLiteral> {
    page?: number;
    limit?: number;
    defaultLimit?: number;
    maxLimit?: number;
    options?: FindManyOptions<T>;
}
export declare function paginate<T extends ObjectLiteral>(repository: Repository<T>, { page, limit, defaultLimit, maxLimit, options, }: PaginateOptions<T>): Promise<{
    data: T[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}>;
export {};
