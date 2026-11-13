-- Runs once, when the volume is first initialized.
--
-- `prisma migrate dev` and the CI drift gate need an EMPTY shadow database next
-- to the application database, and the integration suite needs a disposable one
-- (it drops and recreates the public schema).

CREATE DATABASE kiteos_dev_shadow;

CREATE DATABASE kiteos_test;
CREATE DATABASE kiteos_test_shadow;
