CREATE TABLE `document_outlines` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`documentId` char(36) NOT NULL,
	`status` enum('draft','approved','skipped') NOT NULL DEFAULT 'draft',
	`sections` json NOT NULL DEFAULT (JSON_ARRAY()),
	`generatedByJobId` char(36),
	`approvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `document_outlines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_references` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`sourceDocumentId` char(36) NOT NULL,
	`referencedDocumentId` char(36) NOT NULL,
	`referencedVersionId` char(36) NOT NULL,
	`stalenessAcknowledgedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `document_references_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`matterId` char(36) NOT NULL,
	`title` varchar(256) NOT NULL,
	`documentType` varchar(64) NOT NULL,
	`customTypeLabel` varchar(256),
	`draftingMode` enum('template','iterative') NOT NULL,
	`templateBindingStatus` enum('bound','detached') NOT NULL DEFAULT 'bound',
	`templateVersionId` char(36),
	`templateSnapshot` json,
	`variableMap` json,
	`workflowState` enum('drafting','substantively_accepted','finalizing','complete','archived') NOT NULL DEFAULT 'drafting',
	`currentVersionId` char(36),
	`officialSubstantiveVersionNumber` int,
	`officialFinalVersionNumber` int,
	`completedAt` timestamp,
	`archivedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedback` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`documentId` char(36) NOT NULL,
	`versionId` char(36) NOT NULL,
	`iterationNumber` int NOT NULL,
	`reviewSessionId` char(36),
	`jobId` char(36) NOT NULL,
	`reviewerRole` varchar(32) NOT NULL,
	`reviewerModel` varchar(64) NOT NULL,
	`reviewerTitle` varchar(128) NOT NULL,
	`suggestions` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedback_evaluations` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`documentId` char(36) NOT NULL,
	`iterationNumber` int NOT NULL,
	`jobId` char(36) NOT NULL,
	`dispositions` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `feedback_evaluations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedback_manual_selections` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`documentId` char(36) NOT NULL,
	`iterationNumber` int NOT NULL,
	`reviewSessionId` char(36) NOT NULL,
	`suggestionId` varchar(64) NOT NULL,
	`attorneyNote` text,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `feedback_manual_selections_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_manual_selections` UNIQUE(`reviewSessionId`,`suggestionId`)
);
--> statement-breakpoint
CREATE TABLE `information_request_items` (
	`id` char(36) NOT NULL,
	`informationRequestId` char(36) NOT NULL,
	`category` varchar(64) NOT NULL,
	`questionText` text NOT NULL,
	`answerText` text,
	`orderIndex` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `information_request_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `information_requests` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`matterId` char(36) NOT NULL,
	`status` enum('draft','exported','receiving_answers','complete') NOT NULL DEFAULT 'draft',
	`archivedAt` timestamp,
	`activeMatterKey` char(36),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `information_requests_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_active_matrix_per_matter` UNIQUE(`activeMatterKey`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`matterId` char(36),
	`documentId` char(36),
	`jobType` varchar(64) NOT NULL,
	`providerId` varchar(32) NOT NULL,
	`modelId` varchar(64) NOT NULL,
	`promptVersion` varchar(32) NOT NULL,
	`status` enum('queued','running','completed','failed','timed_out','cancelled') NOT NULL DEFAULT 'queued',
	`queuedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`startedAt` timestamp,
	`completedAt` timestamp,
	`lastHeartbeatAt` timestamp,
	`input` json NOT NULL,
	`output` json,
	`errorClass` varchar(64),
	`errorMessage` text,
	`tokensPrompt` int,
	`tokensCompletion` int,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `matter_materials` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`matterId` char(36) NOT NULL,
	`filename` varchar(512),
	`mimeType` varchar(128),
	`fileSize` int,
	`storageKey` varchar(512),
	`textContent` mediumtext,
	`extractionStatus` enum('extracted','partial','failed','not_supported') NOT NULL,
	`extractionError` text,
	`tags` json NOT NULL DEFAULT (JSON_ARRAY()),
	`description` text,
	`pinned` boolean NOT NULL DEFAULT false,
	`uploadSource` enum('upload','paste') NOT NULL,
	`deletedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `matter_materials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `matters` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`title` varchar(256) NOT NULL,
	`clientName` varchar(256),
	`practiceArea` varchar(128),
	`phase` enum('intake','drafting','complete') NOT NULL DEFAULT 'intake',
	`archivedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `matters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_sessions` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`documentId` char(36) NOT NULL,
	`iterationNumber` int NOT NULL,
	`state` enum('active','regenerated','abandoned') NOT NULL DEFAULT 'active',
	`selections` json NOT NULL DEFAULT (JSON_ARRAY()),
	`selectedReviewers` json NOT NULL DEFAULT (JSON_ARRAY()),
	`globalInstructions` text NOT NULL DEFAULT (''),
	`lastAutosavedAt` timestamp,
	`activeSessionKey` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `review_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_active_review_session` UNIQUE(`activeSessionKey`)
);
--> statement-breakpoint
CREATE TABLE `telemetry_events` (
	`eventId` char(36) NOT NULL,
	`eventType` varchar(128) NOT NULL,
	`userId` char(36) NOT NULL,
	`matterId` char(36),
	`documentId` char(36),
	`jobId` char(36),
	`timestamp` varchar(30) NOT NULL,
	`payload` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `telemetry_events_eventId` PRIMARY KEY(`eventId`)
);
--> statement-breakpoint
CREATE TABLE `template_variable_schemas` (
	`id` char(36) NOT NULL,
	`templateVersionId` char(36) NOT NULL,
	`schema` json NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `template_variable_schemas_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_schema_version` UNIQUE(`templateVersionId`)
);
--> statement-breakpoint
CREATE TABLE `template_versions` (
	`id` char(36) NOT NULL,
	`templateId` char(36) NOT NULL,
	`versionNumber` int NOT NULL,
	`fileStorageKey` varchar(512) NOT NULL,
	`handlebarsSource` mediumtext NOT NULL,
	`validationStatus` enum('pending','valid','invalid') NOT NULL DEFAULT 'pending',
	`validationErrors` json,
	`activated` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `template_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_template_versions` UNIQUE(`templateId`,`versionNumber`)
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`name` varchar(256) NOT NULL,
	`documentType` varchar(64) NOT NULL,
	`activeVersionId` char(36),
	`archivedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`userId` char(36) NOT NULL,
	`preferences` json NOT NULL DEFAULT (JSON_OBJECT()),
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_preferences_userId` PRIMARY KEY(`userId`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`username` varchar(64) NOT NULL,
	`passwordHash` varchar(100) NOT NULL,
	`displayName` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_username_unique` UNIQUE(`username`)
);
--> statement-breakpoint
CREATE TABLE `versions` (
	`id` char(36) NOT NULL,
	`userId` char(36) NOT NULL,
	`documentId` char(36) NOT NULL,
	`versionNumber` int NOT NULL,
	`content` mediumtext NOT NULL,
	`generatedByJobId` char(36),
	`iterationNumber` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_version_per_document` UNIQUE(`documentId`,`versionNumber`)
);
--> statement-breakpoint
CREATE INDEX `idx_outlines_user_document` ON `document_outlines` (`userId`,`documentId`);--> statement-breakpoint
CREATE INDEX `idx_references_source` ON `document_references` (`sourceDocumentId`);--> statement-breakpoint
CREATE INDEX `idx_references_referenced` ON `document_references` (`referencedDocumentId`);--> statement-breakpoint
CREATE INDEX `idx_documents_matter_state` ON `documents` (`userId`,`matterId`,`workflowState`,`archivedAt`);--> statement-breakpoint
CREATE INDEX `idx_documents_matter_created` ON `documents` (`userId`,`matterId`,`archivedAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_feedback_user_document_iter` ON `feedback` (`userId`,`documentId`,`iterationNumber`);--> statement-breakpoint
CREATE INDEX `idx_feedback_session` ON `feedback` (`reviewSessionId`);--> statement-breakpoint
CREATE INDEX `idx_feedback_eval_document_iter` ON `feedback_evaluations` (`documentId`,`iterationNumber`);--> statement-breakpoint
CREATE INDEX `idx_manual_selections_session` ON `feedback_manual_selections` (`reviewSessionId`);--> statement-breakpoint
CREATE INDEX `idx_manual_selections_document_iter` ON `feedback_manual_selections` (`documentId`,`iterationNumber`);--> statement-breakpoint
CREATE INDEX `idx_info_items_request_order` ON `information_request_items` (`informationRequestId`,`orderIndex`);--> statement-breakpoint
CREATE INDEX `idx_info_requests_matter` ON `information_requests` (`userId`,`matterId`,`archivedAt`);--> statement-breakpoint
CREATE INDEX `idx_jobs_user_status` ON `jobs` (`userId`,`status`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `idx_jobs_document` ON `jobs` (`documentId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_matter` ON `jobs` (`matterId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_materials_user_matter_created` ON `matter_materials` (`userId`,`matterId`,`deletedAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_materials_user_matter_pinned` ON `matter_materials` (`userId`,`matterId`,`deletedAt`,`pinned`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_matters_user_phase` ON `matters` (`userId`,`phase`,`archivedAt`,`updatedAt`);--> statement-breakpoint
CREATE INDEX `idx_matters_user_created` ON `matters` (`userId`,`archivedAt`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_review_sessions_user_document` ON `review_sessions` (`userId`,`documentId`,`iterationNumber`);--> statement-breakpoint
CREATE INDEX `idx_templates_user_type` ON `templates` (`userId`,`documentType`,`archivedAt`);--> statement-breakpoint
CREATE INDEX `idx_versions_document_number` ON `versions` (`documentId`,`versionNumber`);