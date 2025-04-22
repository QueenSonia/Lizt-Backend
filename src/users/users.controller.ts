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
import { Response } from 'express';
import { UsersService } from './users.service';
import { CreateUserDto, LoginDto, UserFilter } from './dto/create-user.dto';
import { UpdateUserDto, UpdateUserResponseDto } from './dto/update-user.dto';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { ADMIN_ROLES } from 'src/base.entity';
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
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthGuard } from 'src/auth/auth.guard';

@ApiTags('Users')
@ApiCookieAuth('access_token')
@ApiSecurity('access_token')
@UseGuards(AuthGuard, RoleGuard)
@Roles(ADMIN_ROLES.ADMIN)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('test')
  getTest() {
    return { message: 'This should work without auth' };
  }

  @SkipAuth()
  @ApiOperation({ summary: 'User Login' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, type: CreateUserDto })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiUnauthorizedResponse({ description: 'Invalid password' })
  @Post('login')
  async login(@Body() body: LoginDto, @Res() res: Response) {
    return this.usersService.loginUser(body, res);
  }

  @SkipAuth()
  @ApiOperation({ summary: 'Logout User' })
  @ApiOkResponse()
  @Post('logout')
  async logout(@Res() res: Response) {
    return this.usersService.logoutUser(res);
  } 

  @ApiOperation({ summary: 'Create User' })
  @ApiBody({ type: CreateUserDto })
  @ApiCreatedResponse({ type: CreateUserDto })
  @ApiResponse({ status: 422, description: 'User with email already exist' })
  @Post()
  async createUser(@Body() body: CreateUserDto) {
    return this.usersService.createUser(body);
  }

  // @SkipAuth()
  @ApiOperation({ summary: 'Get All Users' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'first_name', required: false, type: String })
  @ApiQuery({ name: 'last_name', required: false, type: String })
  @ApiQuery({ name: 'role', required: false, type: String })
  @ApiQuery({ name: 'email', required: false, type: String })
  @ApiQuery({ name: 'phone_number', required: false, type: String })
  @ApiQuery({ name: 'start_date', required: false, type: String })
  @ApiQuery({ name: 'end_date', required: false, type: String })
  @ApiOkResponse({ type: PaginationResponseDto })
  @ApiBadRequestResponse()
  @Get()
  getAllUsers(@Query() query: UserFilter) {
    return this.usersService.getAllUsers(query);
  }

  @ApiOperation({ summary: 'Get One User' })
  @ApiOkResponse({ type: CreateUserDto })
  @ApiNotFoundResponse({ description: 'User not found' })
  @Get(':id')
  getUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.getUserById(id);
  }

  @ApiOperation({ summary: 'Update User' })
  @ApiBody({ type: UpdateUserResponseDto })
  @ApiOkResponse({ description: 'User successfully updated' })
  @Put(':id')
  updateUserById(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
  ) {
    return this.usersService.updateUserById(id, body);
  }

  @ApiOperation({ summary: 'Delete User' })
  @ApiOkResponse()
  @Delete(':id')
  deleteUserById(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.deleteUserById(id);
  }

  @ApiOperation({ summary: 'Get Tenant and Property They Occupy' })
  @ApiOkResponse({ type: CreateUserDto })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @Get('tenant-property/:tenant_id')
  getTenantAndPropertyInfo(
    @Param('tenant_id', ParseUUIDPipe) tenant_id: string,
  ) {
    return this.usersService.getTenantAndPropertyInfo(tenant_id);
  }
}
