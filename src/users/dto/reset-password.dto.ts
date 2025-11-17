import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'Password5%',
    description: 'Password of the user (admin only)',
    required: false,
  })
  @IsString()
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/,
    {
      message:
        'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    },
  )
  newPassword: string;

  //    @ApiProperty({
  //       example: '90b7f325-be27-45a7-9688-fa49630cac8f',
  //       description: 'UUID of the property',
  //       required: false,
  //     })
  @IsString()
  // @IsOptional()
  token: string;
}
