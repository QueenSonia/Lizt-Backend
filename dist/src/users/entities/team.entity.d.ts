import { BaseEntity } from "src/base.entity";
import { TeamMember } from "./team-member.entity";
export declare class Team extends BaseEntity {
    name: string;
    creator_id: string;
    members: TeamMember[];
}
