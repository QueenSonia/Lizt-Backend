
import { DataSource } from "typeorm";
import { config } from "dotenv-flow";
import * as fs from 'fs';
config();

import { AppDataSource } from "./src/data-source";

async function dumpSchema() {
    await AppDataSource.initialize();
    const queryRunner = AppDataSource.createQueryRunner();

    const results: any = {};

    const tables = ['tenant_kyc', 'kyc_applications'];
    for (const table of tables) {
        const columns = await queryRunner.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = '${table}'
            ORDER BY column_name;
        `);
        results[table] = columns.map((c: any) => c.column_name);
    }

    fs.writeFileSync('db_schema_dump.json', JSON.stringify(results, null, 2));
    await AppDataSource.destroy();
    console.log("Schema dumped to db_schema_dump.json");
}

dumpSchema().catch(error => {
    fs.writeFileSync('db_schema_error.txt', error.stack || error.message);
    process.exit(1);
});
