-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PunchSource" ADD VALUE 'IMPORT';
ALTER TYPE "PunchSource" ADD VALUE 'WEB';

-- AlterTable
ALTER TABLE "ApiKey" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "AttendanceDay" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "BiometricTemplate" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "radiusM" INTEGER NOT NULL DEFAULT 200,
ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Consent" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Designation" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "DeviceCommand" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Holiday" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "LeaveBalance" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "LeaveRequest" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "LeaveType" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "OrgSettings" ADD COLUMN     "webPunch" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "OvertimeRequest" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Punch" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "PunchPhoto" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Regularization" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "ReportSchedule" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Shift" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "ShiftAssignment" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Subscription" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Visitor" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Webhook" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');
