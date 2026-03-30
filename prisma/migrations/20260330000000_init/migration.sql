-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "community_members" (
    "id" SERIAL NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "community_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_key_key" ON "whatsapp_sessions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "community_members_jid_key" ON "community_members"("jid");

-- CreateIndex
CREATE INDEX "community_members_communityId_idx" ON "community_members"("communityId");
