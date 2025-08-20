import { HttpException, HttpStatus } from '@nestjs/common';
import { PropertyFilter } from 'src/properties/dto/create-property.dto';
import { RentFilter } from 'src/rents/dto/create-rent.dto';
import { UserFilter } from 'src/users/dto/create-user.dto';
import { Between, FindOptionsWhere, ILike, SelectQueryBuilder } from 'typeorm';
import { ServiceRequestFilter } from 'src/service-requests/dto/create-service-request.dto';
import { PropertyHistoryFilter } from 'src/property-history/dto/create-property-history.dto';
import { Property } from 'src/properties/entities/property.entity';

export const buildUserFilter = async (queryParams: UserFilter) => {
  const query = {};

  if (queryParams?.search) {
    query['first_name'] = ILike(`%${queryParams.search}%`);
  }
  if (queryParams?.first_name)
    query['first_name'] = queryParams.first_name.toLowerCase();
  if (queryParams?.last_name)
    query['last_name'] = queryParams.last_name.toLowerCase();
  if (queryParams?.email) query['email'] = queryParams.email.toLowerCase();
  if (queryParams?.role) query['role'] = queryParams.role.toLowerCase();
  if (queryParams?.phone_number)
    query['phone_number'] = queryParams.phone_number;
  if (queryParams?.creator_id) query['creator_id'] = queryParams.creator_id;

  if (queryParams?.start_date && queryParams?.end_date) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(queryParams?.start_date)) {
      throw new HttpException(
        `use date format yy-mm-dd`,
        HttpStatus.NOT_ACCEPTABLE,
      );
    }
    query['created_at'] = Between(
      new Date(queryParams.start_date),
      new Date(queryParams.end_date),
    );
  }
  return query;
};

export const buildUserFilterQB = (
  qb: SelectQueryBuilder<any>,
  queryParams: UserFilter,
) => {
  qb.where('1=1'); // initialize where block

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
      throw new HttpException(
        'Invalid date format (use YYYY-MM-DD)',
        HttpStatus.NOT_ACCEPTABLE,
      );
    }
    qb.andWhere('user.created_at BETWEEN :start AND :end', {
      start,
      end,
    });
  }

  if (queryParams.search) {
    const keyword = `%${queryParams.search.toLowerCase()}%`;
    qb.andWhere(
      `LOWER(user.first_name) ILIKE :keyword 
       OR LOWER(user.last_name) ILIKE :keyword 
       OR LOWER(CONCAT(user.first_name, ' ', user.last_name)) ILIKE :keyword`,
      { keyword },
    );
  }

  return qb;
};


export const buildPropertyFilter = async (
  queryParams: PropertyFilter,
): Promise<{ query: FindOptionsWhere<Property>; order: Record<string, 'ASC' | 'DESC'> }> => {
  const query: FindOptionsWhere<Property> = {};
  const order: Record<string, 'ASC' | 'DESC'> = {};

  // Filtering
  if (queryParams?.search) {
    query['name'] = ILike(`%${queryParams.search}%`);
  }
  if (queryParams?.name) query['name'] = ILike(`%${queryParams.name}%`);
  if (queryParams?.owner_id) query['owner_id'] = queryParams.owner_id;
  if (queryParams?.location) query['location'] = queryParams.location.toLowerCase();
  if (queryParams?.property_status) query['property_status'] = queryParams.property_status.toLowerCase();

  // Date Range
  if (queryParams?.start_date && queryParams?.end_date) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(queryParams.start_date)) {
      throw new HttpException(`Use date format yyyy-mm-dd`, HttpStatus.NOT_ACCEPTABLE);
    }
    query['created_at'] = Between(new Date(queryParams.start_date), new Date(queryParams.end_date));
  }

  // Sorting
  if (queryParams?.sort_by && queryParams?.sort_order) {
    const allowedSortFields = ['name', 'created_at', 'rent']; // whitelist fields
    if (allowedSortFields.includes(queryParams.sort_by)) {
      if(queryParams.sort_by === 'rent'){
        order[`rents.rental_price`] = queryParams.sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      }
      order[queryParams.sort_by] = queryParams.sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    }
  }

  return { query, order };
};


export const buildRentFilter = async (queryParams: RentFilter) => {
  const query = {};
  if (queryParams?.property_id) query['property_id'] = queryParams.property_id;
  if (queryParams?.tenant_id) query['tenant_id'] = queryParams.tenant_id;
  if (queryParams?.owner_id)
    query['property'] = { owner_id: queryParams.owner_id };
  if (queryParams?.status) query['status'] = queryParams.status.toLowerCase();

  if (queryParams?.start_date && queryParams?.end_date) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(queryParams?.start_date)) {
      throw new HttpException(
        `use date format yy-mm-dd`,
        HttpStatus.NOT_ACCEPTABLE,
      );
    }
    query['created_at'] = Between(
      new Date(queryParams.start_date),
      new Date(queryParams.end_date),
    );
  }
  return query;
};

export const buildServiceRequestFilter = async (
  queryParams: ServiceRequestFilter,
) => {
  const query = {};
  if (queryParams?.tenant_id) query['tenant_id'] = queryParams.tenant_id;
  if (queryParams?.property_id) query['property_id'] = queryParams.property_id;
  //   query['property'] = { owner_id: queryParams.owner_id };

  if (queryParams?.start_date && queryParams?.end_date) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(queryParams?.start_date)) {
      throw new HttpException(
        `use date format yy-mm-dd`,
        HttpStatus.NOT_ACCEPTABLE,
      );
    }
    query['created_at'] = Between(
      new Date(queryParams.start_date),
      new Date(queryParams.end_date),
    );
  }
  return query;
};

export const buildPropertyHistoryFilter = async (
  queryParams: PropertyHistoryFilter,
) => {
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
      throw new HttpException(
        `use date format yy-mm-dd`,
        HttpStatus.NOT_ACCEPTABLE,
      );
    }
    query['created_at'] = Between(
      new Date(queryParams.start_date),
      new Date(queryParams.end_date),
    );
  }

  return query;
};
