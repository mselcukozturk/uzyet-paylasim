ALTER TABLE "profiles" DROP COLUMN "pin_hash";
ALTER TABLE "profiles" ADD COLUMN "pin_encrypted" text;
