import { IsEnum, IsOptional, IsString } from 'class-validator';
import { InvoiceStatus, PlanInterval } from '../../db/schema';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class ChangePlanDto {
  @IsString()
  planId!: string;

  @IsEnum(PlanInterval)
  interval!: PlanInterval;
}

export class InvoiceListQueryDto extends PaginationDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;
}
