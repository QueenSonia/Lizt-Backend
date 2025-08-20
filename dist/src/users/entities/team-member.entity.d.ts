import { BaseEntity } from 'src/base.entity';
import { Account } from './account.entity';
import { Team } from './team.entity';
export declare class TeamMember extends BaseEntity {
    email: string;
    team_id: string;
    team: Team;
    account_id: string;
    account: Account;
    role: string;
    permissions: string[];
}
