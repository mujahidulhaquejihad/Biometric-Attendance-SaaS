-- AlterTable
ALTER TABLE "ApiKey" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "AttendanceDay" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "BiometricTemplate" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Branch" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Consent" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Department" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Designation" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "DeviceCommand" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "birthDate" DATE,
ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

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
ALTER TABLE "OrgSettings" ALTER COLUMN "organizationId" SET DEFAULT current_setting('app.org_id');

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

-- CreateTable
CREATE TABLE "CompOffRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'),
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "days" DOUBLE PRECISION NOT NULL,
    "reason" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL DEFAULT current_setting('app.org_id'),
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "expiresOn" DATE,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompOffRequest_organizationId_status_idx" ON "CompOffRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Notice_organizationId_createdAt_idx" ON "Notice"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "CompOffRequest" ADD CONSTRAINT "CompOffRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
