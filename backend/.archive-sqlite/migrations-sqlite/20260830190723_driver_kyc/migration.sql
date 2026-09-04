-- CreateTable
CREATE TABLE "DriverDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "driverId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "number" TEXT,
    "fileKey" TEXT,
    "issuedAt" DATETIME,
    "expiresAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "providerData" TEXT,
    "verifiedAt" DATETIME,
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DriverDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile" ("userId") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DriverProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL,
    "vehicleNumber" TEXT NOT NULL,
    "drivingLicenseNumber" TEXT NOT NULL,
    "panCardNumber" TEXT,
    "accountHolderName" TEXT,
    "bankAccountNumber" TEXT,
    "ifscCode" TEXT,
    "panCardImageUrl" TEXT,
    "drivingLicenseFrontImageUrl" TEXT,
    "drivingLicenseBackImageUrl" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "currentLat" REAL,
    "currentLng" REAL,
    "locationAt" DATETIME,
    "ratingAvg" REAL NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verificationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAt" DATETIME,
    "approvedBy" TEXT,
    "rejectionReason" TEXT,
    CONSTRAINT "DriverProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DriverProfile" ("accountHolderName", "bankAccountNumber", "createdAt", "currentLat", "currentLng", "drivingLicenseBackImageUrl", "drivingLicenseFrontImageUrl", "drivingLicenseNumber", "id", "ifscCode", "isOnline", "locationAt", "panCardImageUrl", "panCardNumber", "ratingAvg", "ratingCount", "userId", "vehicleNumber", "vehicleType") SELECT "accountHolderName", "bankAccountNumber", "createdAt", "currentLat", "currentLng", "drivingLicenseBackImageUrl", "drivingLicenseFrontImageUrl", "drivingLicenseNumber", "id", "ifscCode", "isOnline", "locationAt", "panCardImageUrl", "panCardNumber", "ratingAvg", "ratingCount", "userId", "vehicleNumber", "vehicleType" FROM "DriverProfile";
DROP TABLE "DriverProfile";
ALTER TABLE "new_DriverProfile" RENAME TO "DriverProfile";
CREATE UNIQUE INDEX "DriverProfile_userId_key" ON "DriverProfile"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DriverDocument_status_idx" ON "DriverDocument"("status");

-- CreateIndex
CREATE INDEX "DriverDocument_expiresAt_idx" ON "DriverDocument"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriverDocument_driverId_type_key" ON "DriverDocument"("driverId", "type");
