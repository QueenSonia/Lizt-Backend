import {
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
} from 'class-validator';
import { RolesEnum } from 'src/base.entity';
import { NormalizePhoneNumber } from '../../utils/phone-number.transformer';
import { IsValidPhoneNumber } from '../../common/validation/is-valid-phone.decorator';

/**
 * Response/display shape for a team member (not used for input validation).
 */
export class TeamMemberDto {
  id: string;
  name: string;
  email: string;
  phone_number: string;
  role: string;
  date: string;
}

/**
 * Input DTO for POST /users/assign-collaborator. Validates and normalizes the
 * collaborator's phone number (any country) at the request boundary.
 */
export class AssignCollaboratorDto {
  @IsEmail()
  email: string;

  @IsArray()
  @IsString({ each: true })
  permissions: string[];

  @IsEnum(RolesEnum)
  role: RolesEnum;

  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsValidPhoneNumber()
  @NormalizePhoneNumber()
  phone_number: string;
}

/**
 * Input DTO for PUT /users/team-members/:id.
 */
export class UpdateTeamMemberDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsValidPhoneNumber()
  @NormalizePhoneNumber()
  phone: string;
}
