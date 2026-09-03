-- AlterTable
ALTER TABLE `activitylog` 
    MODIFY `userId` VARCHAR(191) NULL,
    MODIFY `resource` VARCHAR(191) NULL,
    ADD COLUMN `userEmail` VARCHAR(191) NULL,
    ADD COLUMN `userRole` VARCHAR(191) NULL,
    ADD COLUMN `resourceType` VARCHAR(191) NULL,
    ADD COLUMN `resourceId` VARCHAR(191) NULL,
    ADD COLUMN `requestMethod` VARCHAR(191) NULL,
    ADD COLUMN `route` VARCHAR(191) NULL,
    ADD COLUMN `ipAddress` VARCHAR(191) NULL,
    ADD COLUMN `userAgent` VARCHAR(512) NULL,
    ADD COLUMN `success` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `failureReason` VARCHAR(512) NULL;
