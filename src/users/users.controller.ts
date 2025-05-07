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
  Req,
  UseInterceptors,
  UploadedFiles,
  Patch,
} from '@nestjs/common';
import { UsersService } from './users.service';
import {
  CreateUserDto,
  LoginDto,
  UploadLogoDto,
  UserFilter,
} from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { ADMIN_ROLES } from 'src/base.entity';
import { Response } from 'express';
import { SkipAuth } from 'src/auth/auth.decorator';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
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
import { FilesInterceptor } from '@nestjs/platform-express';
import { CreateKycDto } from './dto/create-kyc.dto';
import { KYC } from './entities/kyc.entity';
import { UpdateKycDto } from './dto/update-kyc.dto';

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
  async createUser(@Body() body: CreateUserDto, @Req() req: any) {
    try {
      const user_id = req?.user?.id;
      return this.usersService.createUser(body, user_id);
    } catch (error) {
      throw error;
    }
  }

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
  @ApiOkResponse({
    type: PaginationResponseDto,
    description: 'Paginated list of users',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('/tenants')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  getAllTenants(@Query() query: UserFilter) {
    try {
      return this.usersService.getAllTenants(query);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get Tenants Created By An Admin' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'first_name', required: false, type: String })
  @ApiQuery({ name: 'last_name', required: false, type: String })
  @ApiQuery({ name: 'email', required: false, type: String })
  @ApiQuery({ name: 'phone_number', required: false, type: String })
  @ApiQuery({ name: 'start_date', required: false, type: String })
  @ApiQuery({ name: 'end_date', required: false, type: String })
  @ApiOkResponse({
    type: PaginationResponseDto,
    description: 'Paginated list of users',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('tenant-list')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  getTenantsOfAnAdmin(@Query() query: UserFilter, @Req() req: any) {
    try {
      query.creator_id = req?.user?.id;
      return this.usersService.getTenantsOfAnAdmin(query);
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

  @ApiOperation({ summary: 'Get Specific User Fields' })
  @ApiQuery({
    name: 'fields',
    required: true,
    type: [String],
    description: 'Array of user fields to retrieve',
    example: [
      'id',
      'first_name',
      'last_name',
      'email',
      'phone_number',
      'role',
      'is_verified',
      'logo_urls',
      'creator_id',
      'created_at',
      'updated_at',
    ],
  })
  @ApiOkResponse({ description: 'User fields retrieved successfully' })
  @ApiNotFoundResponse({ description: 'User not found' })
  @ApiSecurity('access_token')
  @Get('fields/:user_id')
  async getUserFields(
    @Param('user_id', new ParseUUIDPipe()) user_id: string,
    @Query('fields') fields: string[],
  ) {
    if (!fields.length) {
      throw new Error('Fields query parameter is required');
    }
    console.log('fields', fields);
    return this.usersService.getUserFields(user_id, fields);
  }

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
  getTenantAndPropertyInfo(
    @Param('tenant_id', new ParseUUIDPipe()) tenant_id: string,
  ) {
    try {
      return this.usersService.getTenantAndPropertyInfo(tenant_id);
    } catch (error) {
      throw error;
    }
  }

  @SkipAuth()
  @Post('reset-password')
  async resetPassword(
    @Body() body: { token: string; newPassword: string },
    @Res() res: Response,
  ) {
    const { token, newPassword } = body;
    await this.usersService.resetPassword(token, newPassword, res);
    return { message: 'Password reset successful' };
  }

  @ApiOperation({ summary: 'Upload Admin Logos' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadLogoDto })
  @ApiOkResponse({ description: 'Logos uploaded successfully' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post('upload-logos')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  @UseInterceptors(FilesInterceptor('logos', 10))
  async uploadLogos(
    @UploadedFiles() files: Array<Express.Multer.File>,
    @Req() req: any,
  ) {
    try {
      const userId = req?.user?.id;
      return await this.usersService.uploadLogos(userId, files);
    } catch (error) {
      throw error;
    }
  }
  @SkipAuth()
  @Post('complete-kyc/:userId')
  async completeKyc(
    @Param('userId') userId: string,
    @Body() createKycDto: CreateKycDto,
  ): Promise<KYC> {
    return this.usersService.createUserKyc(userId, createKycDto);
  }

  @SkipAuth()
  @Patch('update-kyc')
  async updateKyc(
    @Param('userId') userId: string,
    @Body() updateKycDto: UpdateKycDto,
  ): Promise<KYC> {
    return this.usersService.update(userId, updateKycDto);
  }
}
