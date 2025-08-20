import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IReqUser } from 'src/base.entity';
export declare class AuthService {
    private jwtService;
    private configService;
    constructor(jwtService: JwtService, configService: ConfigService);
    generateToken(user: IReqUser): Promise<string>;
}
