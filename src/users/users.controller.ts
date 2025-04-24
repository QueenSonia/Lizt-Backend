/* eslint-disable prettier/prettier */
import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Get,
  Query,
  ParseUUIDPipe,
  Put,
  Res,
  Delete,
} from '@nestjs/common';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  LoginDto,
  UserFilter,
} from './dto/create-user.dto';
import { UpdateUserDto, UpdateUserResponseDto } from './dto/update-user.dto';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { ADMIN_ROLES } from 'src/base.entity';
import { Response } from 'express';
import { SkipAuth } from 'src/auth/auth.decorator';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PaginationResponseDto } from './dto/paginate.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @ApiOperation({ summary: 'Create User' })
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({ type: CreateUserDto })
  @ApiResponse({ status: 422, description: 'User with email already exist' })
  @ApiSecurity('access_token')
  @Post()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  async createUser(@Body() body: CreateUserDto) {
    try {
      return this.usersService.createUser(body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get All Users' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number for pagination' })
  @ApiQuery({ name: 'size', required: false, type: Number, description: 'Number of items per page' })
  @ApiQuery({ name: 'first_name', required: false, type: String, description: 'First name of users' })
  @ApiQuery({ name: 'last_name', required: false, type: String, description: 'Last name of users' })
  @ApiQuery({ name: 'role', required: false, type: String, description: 'Role of a user' })
  @ApiQuery({ name: 'email', required: false, type: String, description: 'Email of a user' })
  @ApiQuery({ name: 'phone_number', required: false, type: String, description: 'Phone number of a user' })
  @ApiQuery({ name: 'start_date', required: false, type: String, description: 'Filter users created starting from this date' })
  @ApiQuery({ name: 'end_date', required: false, type: String, description: 'Filter users created ending at this date' })
  @ApiOkResponse({
    type: PaginationResponseDto,
    description: 'Paginated list of users',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  getAllUsers(@Query() query: UserFilter) {
    try {
      return this.usersService.getAllUsers(query);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get One User' })
  @ApiOkResponse({
    type: CreateUserDto,
    description: 'User successfully fetched',
  })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get(':id')
  getUserById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.usersService.getUserById(id);
    } catch (error) {
      throw error;
    }
  }


  @ApiOperation({ summary: 'Update User' })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({ description: 'User successfully updated' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Put(':id')
  updateUserById(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateUserDto,
  ) {
    try {
      return this.usersService.updateUserById(id, body);
    } catch (error) {
      throw error;
    }
  }


  @ApiOperation({ summary: 'User Login' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: CreateUserDto })
  
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Invalid password' })
  @ApiCookieAuth('access_token')
  @SkipAuth()
  @Post('login')
  async login(@Body() body: LoginDto, @Res() res: Response) {
    try {
      return this.usersService.loginUser(body, res);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({
    summary: 'Logout User',
    description: 'User successfully logged out',
  })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @Post('logout')
  @SkipAuth()
  async logout(@Res() res: Response) {
    try {
      return this.usersService.logoutUser(res);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({
    summary: 'Delete User',
    description: 'User successfully deleted',
  })
  @ApiOkResponse()
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Delete(':id')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  deleteUserById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.usersService.deleteUserById(id);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get Tenant and Property They Occupy' })
  @ApiOkResponse({ type: CreateUserDto })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @Get('tenant-property/:tenant_id')
  getTenantAndPropertyInfo(@Param('tenant_id', new ParseUUIDPipe()) tenant_id: string) {
    try {
      return this.usersService.getTenantAndPropertyInfo(tenant_id);
    } catch (error) {
      throw error;
    }
  }
}
