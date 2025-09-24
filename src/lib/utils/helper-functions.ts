import { Repository, FindManyOptions, ObjectLiteral } from 'typeorm';

interface PaginateOptions<T extends ObjectLiteral> {
  page?: number;
  limit?: number;
  defaultLimit?: number;
  maxLimit?: number;
  options?: FindManyOptions<T>;
}

export async function paginate<T extends ObjectLiteral>(
  repository: Repository<T>,
  {
    page = 1,
    limit,
    defaultLimit = 10,
    maxLimit = 50,
    options = {},
  }: PaginateOptions<T>,
) {
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
