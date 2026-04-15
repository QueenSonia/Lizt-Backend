import { Client } from 'pg';
import { config } from 'dotenv-flow';
import * as fs from 'fs';

config({ default_node_env: 'production' });

const {
    PROD_PORT,
    PROD_DB_NAME,
    PROD_DB_HOST,
    PROD_DB_PASSWORD,
    PROD_DB_USERNAME,
} = process.env;

async function dumpSchema() {
    const client = new Client({
        host: PROD_DB_HOST,
        port: Number(PROD_PORT),
        database: PROD_DB_NAME,
        user: PROD_DB_USERNAME,
        password: PROD_DB_PASSWORD,
        ssl: { rejectUnauthorized: false },
    });

    await client.connect();

    const tableRes = await client.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name;
    `);
    const tables = tableRes.rows.map(r => r.table_name);

    const results: Record<string, string[]> = {};
    for (const table of tables) {
        const colRes = await client.query(
            `SELECT column_name
             FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1
             ORDER BY column_name;`,
            [table]
        );
        results[table] = colRes.rows.map(r => r.column_name);
    }

    fs.writeFileSync('db_schema_dump.json', JSON.stringify(results, null, 2));
    await client.end();
    console.log(`Schema dumped to db_schema_dump.json (${tables.length} tables)`);
}

dumpSchema().catch(error => {
    fs.writeFileSync('db_schema_error.txt', error.stack || error.message);
    console.error(error);
    process.exit(1);
});
