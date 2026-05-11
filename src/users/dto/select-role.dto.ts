import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { RolesEnum } from 'src/base.entity';

/**
 * Body of POST /users/login/select-role.
 *
 * Issued after a successful password check on /users/login when the account
 * has multiple roles. The frontend collects the user's choice from the role
 * picker and exchanges this DTO for a real session.
 */
export class SelectRoleDto {
  @ApiProperty({
    description:
      'Short-lived JWT (5 min) returned by /users/login when the account has multiple roles.',
  })
  @IsString()
  @IsNotEmpty()
  roleSelectionToken: string;

  @ApiProperty({
    description: 'The role the user picked from the role picker.',
    enum: RolesEnum,
    example: RolesEnum.LANDLORD,
  })
  @IsEnum(RolesEnum)
  role: RolesEnum;
}
