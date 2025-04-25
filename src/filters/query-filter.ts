import { HttpException, HttpStatus } from '@nestjs/common';
import { PropertyFilter } from 'src/properties/dto/create-property.dto';
import { RentFilter } from 'src/rents/dto/create-rent.dto';
import { UserFilter } from 'src/users/dto/create-user.dto';
import { Between, ILike } from 'typeorm';
import { ServiceRequestFilter } from 'src/service-requests/dto/create-service-request.dto';
import { PropertyHistoryFilter } from 'src/property-history/dto/create-property-history.dto';

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

export const buildPropertyFilter = async (queryParams: PropertyFilter) => {
  const query = {};
  if (queryParams?.name) query['name'] = ILike(queryParams.name);
  if (queryParams?.owner_id) query['owner_id'] = queryParams.owner_id;
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
  if (queryParams.owner_id) {
    query['property'] = { owner_id: queryParams.owner_id };
  }
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
