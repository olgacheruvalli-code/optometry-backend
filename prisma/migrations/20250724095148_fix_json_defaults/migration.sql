/*
  Warnings:

  - Made the column `eyeBank` on table `Report` required. This step will fail if there are existing NULL values in that column.
  - Made the column `visionCenter` on table `Report` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Report" ALTER COLUMN "eyeBank" SET NOT NULL,
ALTER COLUMN "visionCenter" SET NOT NULL;

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "district" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "phone" TEXT NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
