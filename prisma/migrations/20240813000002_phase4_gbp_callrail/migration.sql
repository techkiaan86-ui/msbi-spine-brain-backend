-- AlterTable
ALTER TABLE `calllog` ADD COLUMN `externalCallId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `review` ADD COLUMN `externalReviewId` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `CallLog_externalCallId_key` ON `CallLog`(`externalCallId`);

-- CreateIndex
CREATE UNIQUE INDEX `Review_platform_externalReviewId_key` ON `Review`(`platform`, `externalReviewId`);

