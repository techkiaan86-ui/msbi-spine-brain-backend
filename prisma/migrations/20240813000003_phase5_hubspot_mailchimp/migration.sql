ALTER TABLE `Lead` ADD COLUMN `externalLeadId` VARCHAR(191) NULL,
                   ADD COLUMN `leadPlatform` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Lead_leadPlatform_externalLeadId_key` ON `Lead`(`leadPlatform`, `externalLeadId`);

CREATE TABLE `EmailCampaignMetric` (
  `id` VARCHAR(191) NOT NULL,
  `campaignId` VARCHAR(191) NOT NULL,
  `sent` INTEGER NULL,
  `opens` INTEGER NULL,
  `clicks` INTEGER NULL,
  `unsubscribes` INTEGER NULL,
  `bounces` INTEGER NULL,
  `openRate` DOUBLE NULL,
  `clickRate` DOUBLE NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `EmailCampaignMetric_campaignId_key`(`campaignId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `EmailCampaignMetric` ADD CONSTRAINT `EmailCampaignMetric_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `Campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
