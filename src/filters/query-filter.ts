import { HttpException, HttpStatus } from '@nestjs/common';
import { PropertyFilter } from 'src/properties/dto/create-property.dto';
import { UserFilter } from 'src/users/dto/create-user.dto';
import { Between, ILike } from 'typeorm';

export const buildUserFilter = async (queryParams: UserFilter) => {
  const query = {};

  if (queryParams?.first_name)
    query['first_name'] = queryParams.first_name.toLowerCase();
  if (queryParams?.last_name)
    query['last_name'] = queryParams.last_name.toLowerCase();
  if (queryParams?.email) query['email'] = queryParams.email.toLowerCase();
  if (queryParams?.role) query['role'] = queryParams.role.toLowerCase();
  if (queryParams?.phone_number)
    query['phone_number'] = queryParams.phone_number;

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

export const buildPropertyFilter = async (queryParams: PropertyFilter) => {
  const query = {};
  if (queryParams?.name) query['name'] = ILike(queryParams.name);
  if (queryParams?.tenant_id) query['tenant_id'] = queryParams.tenant_id;
  if (queryParams?.location)
    query['location'] = queryParams.location.toLowerCase();
  if (queryParams?.property_status)
    query['property_status'] = queryParams.property_status.toLowerCase();

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
