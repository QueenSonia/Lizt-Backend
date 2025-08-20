"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdateUserPhoneNumbersWithCountryCode1689000000000 = void 0;
class UpdateUserPhoneNumbersWithCountryCode1689000000000 {
    async up(queryRunner) {
        await queryRunner.query(`
            UPDATE users
            SET phone_number = '+234' || SUBSTRING(phone_number FROM 2)
            WHERE phone_number ~ '^0\\d{10}$';
        `);
    }
    async down(queryRunner) {
        await queryRunner.query(`
            UPDATE users
            SET phone_number = '0' || SUBSTRING(phone_number FROM 5)
            WHERE phone_number ~ '^\\+234\\d{10}$';
        `);
    }
}
exports.UpdateUserPhoneNumbersWithCountryCode1689000000000 = UpdateUserPhoneNumbersWithCountryCode1689000000000;
//# sourceMappingURL=1689000000000-UpdateUserPhoneNumbersWithCountryCode.js.map