-- Backfill with the original event creation time so existing published posts remain visible.
ALTER TABLE "Workstation" ADD COLUMN "createdAt" TIMESTAMP(3);
UPDATE "Workstation" AS w SET "createdAt"=e."createdAt" FROM "Event" AS e WHERE w."eventId"=e."id";
ALTER TABLE "Workstation" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Workstation" ALTER COLUMN "createdAt" SET NOT NULL;
