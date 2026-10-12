-- A bank account belongs to one school: KCB routes account notifications by account number.
DROP INDEX "bank_accounts_schoolId_bank_accountNumber_key";
CREATE UNIQUE INDEX "bank_accounts_bank_accountNumber_key" ON "bank_accounts"("bank", "accountNumber");
