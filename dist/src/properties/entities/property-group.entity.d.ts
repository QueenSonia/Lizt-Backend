import { BaseEntity } from '../../base.entity';
import { Users } from '../../users/entities/user.entity';
export declare class PropertyGroup extends BaseEntity {
    name: string;
    owner_id: string;
    property_ids: string[];
    owner: Users;
}
