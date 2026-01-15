
import { DataSource } from "typeorm";
import { config } from "dotenv-flow";
config();

// Adjust the path to your data-source file
import { AppDataSource } from "./src/data-source";

async function checkColumns() {
    await AppDataSource.initialize();
    const queryRunner = AppDataSource.createQueryRunner();

    console.log("Checking 'tenant_kyc' columns:");
    const tenantColumns = await queryRunner.getTable("tenant_kyc");
    if (tenantColumns) {
        tenantColumns.columns.forEach(c => console.log(` - ${c.name} (${c.type})`));
    } else {
        console.log("Table 'tenant_kyc' not found.");
    }

    console.log("\nChecking 'kyc_applications' columns:");
    const kycColumns = await queryRunner.getTable("kyc_applications");
    if (kycColumns) {
        kycColumns.columns.forEach(c => console.log(` - ${c.name} (${c.type})`));
    } else {
        console.log("Table 'kyc_applications' not found.");
    }

    await AppDataSource.destroy();
}

checkColumns().catch(error => console.log(error));
