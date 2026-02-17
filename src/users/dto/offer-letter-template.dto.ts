import {
  IsString,
  IsNotEmpty,
  IsArray,
  IsOptional,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiHideProperty } from '@nestjs/swagger';

/**
 * DTO for a single term of tenancy within the offer letter template.
 * Content can be either a single string or an array of sub-items.
 */
export class TemplateTermOfTenancyDto {
  @ApiProperty({ description: 'Term heading', example: 'Permitted Use' })
  @IsString()
  @IsNotEmpty({ message: 'Term title must not be empty' })
  title: string;

  /**
   * Content accepts both string and string[] types.
   * Validated manually: must be a non-empty string or a non-empty array of non-empty strings.
   * Typed as 'any' to prevent the NestJS Swagger CLI plugin from auto-generating
   * metadata for the union type (string | string[]) which causes a circular
   * dependency error in schema resolution.
   */
  @ApiHideProperty()
  @ValidateIf(() => true)
  content: any;

  @ApiProperty({
    required: false,
    description: 'Optional intro text before list items',
  })
  @IsOptional()
  @IsString()
  intro?: string;
}

/**
 * DTO for the complete offer letter template structure.
 * Validates all required fields per Requirements 9.1, 9.2, 9.3, 9.4.
 */
export class OfferLetterTemplateDto {
  @ApiProperty({ example: 'OFFER FOR RENT OF {propertyName}' })
  @IsString()
  @IsNotEmpty({ message: 'Offer title pattern must not be empty' })
  offerTitlePattern: string;

  @ApiProperty({
    example:
      'Following your visit and review of the property "{propertyName}"...',
  })
  @IsString()
  @IsNotEmpty({ message: 'Introduction text pattern must not be empty' })
  introTextPattern: string;

  @ApiProperty({ example: 'This Offer and the attached Terms of Tenancy...' })
  @IsString()
  @IsNotEmpty({ message: 'Agreement text must not be empty' })
  agreementText: string;

  @ApiProperty({ example: 'Yours faithfully,' })
  @IsString()
  @IsNotEmpty({ message: 'Closing text must not be empty' })
  closingText: string;

  @ApiProperty({ example: 'For Landlord' })
  @IsString()
  @IsNotEmpty({ message: 'For landlord text must not be empty' })
  forLandlordText: string;

  @ApiProperty({ type: [String], example: ['Footnote 1', 'Footnote 2'] })
  @IsArray()
  @IsString({ each: true })
  footnotes: string[];

  @ApiProperty({ type: () => [TemplateTermOfTenancyDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TemplateTermOfTenancyDto)
  termsOfTenancy: TemplateTermOfTenancyDto[];
}
