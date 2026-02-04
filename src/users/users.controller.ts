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
  UploadedFile,
  Patch,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { SyncTenantDataService } from './sync-tenant-data.service';
import {
  CreateAdminDto,
  CreateCustomerRepDto,
  CreateLandlordDto,
  CreateTenantDto,
  CreateUserDto,
  LoginDto,
  ResetDto,
  UploadLogoDto,
  UserFilter,
} from './dto/create-user.dto';
import { AttachTenantFromKycDto } from './dto/attach-tenant-from-kyc.dto';
import { AttachTenantToPropertyDto } from './dto/attach-tenant-to-property.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { RoleGuard } from 'src/auth/role.guard';
import { Roles } from 'src/auth/role.decorator';
import { ADMIN_ROLES, RolesEnum } from 'src/base.entity';
import { Response } from 'express';
import { SkipAuth } from 'src/auth/auth.decorator';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
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
import { UserPaginationResponseDto } from './dto/paginate.dto';
import { FilesInterceptor, FileInterceptor } from '@nestjs/platform-express';
import { CreateKycDto } from './dto/create-kyc.dto';
import { KYC } from './entities/kyc.entity';
import { UpdateKycDto } from './dto/update-kyc.dto';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { CurrentUser } from 'src/auth/current-user.decorator';
import { Account } from 'src/users/entities/account.entity';
import { Team } from 'src/users/entities/team.entity';
import { TeamMemberDto } from 'src/users/dto/team-member.dto';

@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly syncTenantDataService: SyncTenantDataService,
  ) {}

  // @SkipAuth()
  // @Get('/test-dev')
  // async testDev() {
  //   return 'dev is working';
  // }

  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  @Get('/waitlist')
  async getWaitlist() {
    return this.usersService.getWaitlist();
  }

  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  @Get('/landlord')
  async getLandlords() {
    return this.usersService.getLandlords();
  }

  @UseGuards(JwtAuthGuard)
  @Get('team-members')
  async getTeamMembers(
    @CurrentUser() requester: Account,
  ): Promise<TeamMemberDto[]> {
    return this.usersService.getTeamMembers(requester);
  }

  @UseGuards(JwtAuthGuard)
  @Put('team-members/:id')
  async updateTeamMember(
    @Param('id') id: string,
    @Body() body: { name: string; phone: string },
    @CurrentUser() requester: Account,
  ) {
    return this.usersService.updateTeamMember(id, body, requester);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('team-members/:id')
  async deleteTeamMember(
    @Param('id') id: string,
    @CurrentUser() requester: Account,
  ) {
    return this.usersService.deleteTeamMember(id, requester);
  }

  @Post()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async addTenant(@Body() body: CreateTenantDto, @Req() req: any) {
    try {
      const user_id = req?.user?.id;
      return this.usersService.addTenant(user_id, body);
    } catch (error) {
      throw error;
    }
  }

  @Post('attach-tenant-from-kyc')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async attachTenantFromKyc(
    @Body() body: AttachTenantFromKycDto,
    @Req() req: any,
  ) {
    try {
      const landlordId = req?.user?.id;
      return this.usersService.attachTenantFromKyc(landlordId, body);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Attach existing tenant to a property' })
  @ApiOkResponse({ description: 'Tenant successfully attached to property' })
  @ApiBadRequestResponse({ description: 'Invalid request data' })
  @ApiNotFoundResponse({ description: 'Tenant or property not found' })
  @ApiSecurity('access_token')
  @Post(':tenantId/attach-to-property')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  async attachTenantToProperty(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() body: AttachTenantToPropertyDto,
    @Req() req: any,
  ) {
    try {
      const landlordId = req?.user?.id;
      return this.usersService.attachTenantToProperty(
        tenantId,
        body,
        landlordId,
      );
    } catch (error) {
      throw error;
    }
  }

  // @Post()
  // @UseGuards(RoleGuard)
  // @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  // async createUser(@Body() body: CreateUserDto, @Req() req: any) {
  //   try {
  //     const user_id = req?.user?.id;
  //     return this.usersService.createUser(body, user_id);
  //   } catch (error) {
  //     throw error;
  //   }
  // }

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
    type: UserPaginationResponseDto,
    description: 'Paginated list of users',
  })
  @ApiBadRequestResponse()
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @ApiBearerAuth()
  @Get('/tenants')
  getAllTenants(@Query() query: UserFilter) {
    try {
      return this.usersService.getAllTenants(query);
    } catch (error) {
      throw error;
    }
  }

  @Get('/profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@Req() req: any, @Query('user_id') targetUserId?: string) {
    try {
      const currentUserId = req.user.id;
      const isAdmin = req.user.role === 'admin';

      // Only admins can view other users' profiles
      const userId = targetUserId && isAdmin ? targetUserId : currentUserId;
      return this.usersService.getAccountById(userId);
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
    type: UserPaginationResponseDto,
    description: 'Paginated list of users',
  })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Get('tenant-list')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  getTenantsOfAnAdmin(@Query() query: UserFilter, @Req() req: any) {
    try {
      const creator_id = req?.user?.id;

      return this.usersService.getTenantsOfAnAdmin(creator_id, query);
    } catch (error) {
      throw error;
    }
  }

  @Get('tenant-list/:tenant_id')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  getSingleTenantOfAnAdmin(@Req() req: any) {
    try {
      const adminId = req?.user?.id;
      const tenant_id = req?.params.tenant_id;

      return this.usersService.getSingleTenantOfAnAdmin(tenant_id, adminId);
    } catch (error) {
      throw error;
    }
  }

  @ApiOperation({ summary: 'Get Tenant and Property They Occupy' })
  @ApiOkResponse({ type: CreateUserDto })
  @ApiNotFoundResponse({ description: 'Tenant not found' })
  @Get('tenant-property')
  getTenantAndPropertyInfo(@Req() req: any) {
    try {
      return this.usersService.getTenantAndPropertyInfo(req.user.id);
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
    type: UserPaginationResponseDto,
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
  async login(@Body() body: LoginDto, @Res() res: Response, @Req() req: any) {
    try {
      return this.usersService.loginUser(body, res, req);
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
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  deleteUserById(@Param('id', new ParseUUIDPipe()) id: string) {
    try {
      return this.usersService.deleteUserById(id);
    } catch (error) {
      throw error;
    }
  }

  @SkipAuth()
  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }, @Res() res: Response) {
    try {
      const { email } = body;
      await this.usersService.forgotPassword(email);
      return res.status(200).json({ message: 'Check your Email' });
    } catch (error) {
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  @SkipAuth()
  @Post('validate-otp')
  async validateOtp(@Body() body: { otp: string }, @Res() res: Response) {
    try {
      const { otp } = body;
      const response = await this.usersService.validateOtp(otp);
      return res.status(200).json(response);
    } catch (error) {
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  @SkipAuth()
  @Post('resend-otp')
  async resendOtp(@Body() body: { token: string }, @Res() res: Response) {
    try {
      const { token } = body;
      const response = await this.usersService.resendOtp(token);
      return res.status(200).json(response);
    } catch (error) {
      return res.status(500).json({ message: 'Internal Server Error' });
    }
  }

  @SkipAuth()
  @Post('reset-password')
  async resetPassword(@Body() body: ResetDto, @Res() res: Response) {
    const { token, newPassword } = body;
    await this.usersService.resetPassword({ token, newPassword }, res);
    return { message: 'Password reset successful' };
  }

  @ApiOperation({ summary: 'Change Password (Authenticated User)' })
  @ApiOkResponse({ description: 'Password changed successfully' })
  @ApiBadRequestResponse({ description: 'Invalid current password' })
  @ApiSecurity('access_token')
  @Put('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @Body() body: { currentPassword: string; newPassword: string },
    @Req() req: any,
  ) {
    const userId = req?.user?.id;
    return this.usersService.changePassword(
      userId,
      body.currentPassword,
      body.newPassword,
    );
  }

  @ApiOperation({ summary: 'Upload Admin Logos' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: UploadLogoDto })
  @ApiOkResponse({ description: 'Logos uploaded successfully' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post('upload-logos')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
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

  @ApiOperation({ summary: 'Upload Branding Asset (Letterhead or Signature)' })
  @ApiConsumes('multipart/form-data')
  @ApiOkResponse({ description: 'Branding asset uploaded successfully' })
  @ApiBadRequestResponse()
  @ApiSecurity('access_token')
  @Post('upload-branding-asset')
  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN, RolesEnum.LANDLORD)
  @UseInterceptors(FileInterceptor('file'))
  async uploadBrandingAsset(
    @UploadedFile() file: Express.Multer.File,
    @Body('assetType') assetType: 'letterhead' | 'signature',
    @Req() req: any,
  ) {
    try {
      const userId = req?.user?.id;
      return await this.usersService.uploadBrandingAsset(
        userId,
        file,
        assetType,
      );
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

  // @SkipAuth()
  // @Post('admin')
  // async createAdmin(@Body() createUserDto: CreateAdminDto) {
  //   return this.usersService.createAdmin(createUserDto);
  // }

  // @SkipAuth()
  // @Post('landlord')
  // async createLandlord(@Body() createUserDto: CreateLandlordDto) {
  //   return this.usersService.createLandlord(createUserDto);
  // }

  // @SkipAuth()
  // @Post('rep')
  // async createCustomerRep(@Body() createUserDto: CreateCustomerRepDto) {
  //   return this.usersService.createCustomerRep(createUserDto);
  // }

  @Get('sub-accounts')
  async getSubAccounts(@Req() req) {
    const adminId = req.user.id;
    return this.usersService.getSubAccounts(adminId);
  }

  @Get('switch-account/:id')
  async switchAccount(
    @Param('id') id: string,
    @Req() req,
    @Res() res: Response,
  ) {
    const currentAccount = req.user;
    return this.usersService.switchAccount({
      targetAccountId: id,
      currentAccount,
      res,
    });
  }

  @Post('assign-collaborator')
  async assignCollaborator(
    @Body()
    team_member: {
      email: string;
      permissions: string[];
      role: RolesEnum;
      first_name: string;
      last_name: string;
      phone_number: string;
    },
    @Req() req: any,
  ) {
    return this.usersService.assignCollaboratorToTeam(req.user.id, team_member);
  }

  @UseGuards(RoleGuard)
  @Roles(ADMIN_ROLES.ADMIN)
  @Post('sync-tenant-data')
  async syncTenantData() {
    return this.syncTenantDataService.syncTenantNames();
  }
}
