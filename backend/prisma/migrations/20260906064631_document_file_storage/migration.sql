-- CreateTable
CREATE TABLE "DocumentFile" (
    "key" VARCHAR(64) NOT NULL,
    "contentType" VARCHAR(64) NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentFile_pkey" PRIMARY KEY ("key")
);
