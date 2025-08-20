import { DataSource, DataSourceOptions } from 'typeorm';
export declare const config: DataSourceOptions;
declare const _default: (() => DataSourceOptions) & import("@nestjs/config").ConfigFactoryKeyHost<DataSourceOptions>;
export default _default;
export declare const connectionSource: DataSource;
