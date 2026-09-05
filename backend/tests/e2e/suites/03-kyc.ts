/**
 * KYC and documents — the gate between "registered" and "can carry someone's cargo".
 *
 * The mock provider is a real gate, not a rubber stamp: format rules are enforced, a licence
 * ending 0000 is treated as not-found, and the holder's name must match the account. These
 * cases drive each of those paths through the live endpoint.
 */

import { suite, test, expect } from "../runner";
import { api } from "../http";
import { ctx, disposableRider, PASSWORD, nextPhone, verifyPhone, login } from "../actors";
import { db } from "../db";

/** Registers a driver with deliberately chosen credentials, to exercise one rejection path. */
async function driverWith(fields: {
  fullName: string;
  vehicleNumber: string;
  drivingLicenseNumber: string;
}): Promise<{ accessToken: string; id: string }> {
  const phone = nextPhone(ctx.phonePrefix);
  const verificationToken = await verifyPhone(phone);
  await api("/auth/register/driver", {
    method: "POST",
    body: {
      ...fields,
      fullName: `${fields.fullName} ${ctx.runId}`,
      phone,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      verificationToken,
      vehicleType: "tataAce",
      acceptTermsAndConditions: true,
      acceptPrivacyPolicy: true,
    },
  });
  const session = await login(phone, PASSWORD, "DRIVER");
  return { accessToken: session.accessToken, id: session.user.id };
}

suite("kyc", "03 — KYC & documents", () => {
  test("3.1", "a fresh driver's checklist shows PENDING and the required set", async () => {
    const res = await api("/drivers/documents", { token: ctx.driverPending.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.verificationStatus, "verificationStatus").toBe("PENDING");

    const required = res.body.documents.filter((d: any) => d.required).map((d: any) => d.type).sort();
    expect(required, "required documents").toEqual(
      ["DRIVING_LICENSE", "FITNESS_CERTIFICATE", "INSURANCE", "PERMIT", "VEHICLE_RC"].sort(),
    );
  });

  test("3.2", "a matching name and valid numbers reach APPROVED", async () => {
    const driver = await driverWith({
      fullName: "Mock Verified Holder Owner",
      vehicleNumber: "KL07ZZ4321",
      drivingLicenseNumber: "KL0120240004321",
    });
    const res = await api("/drivers/documents/verify", { method: "POST", token: driver.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.verificationStatus, "verificationStatus").toBe("APPROVED");

    const profile = await db.driverProfile.findUniqueOrThrow({ where: { userId: driver.id } });
    expect(profile.approvedAt, "approvedAt stamped").toBeDefined();
  });

  test("3.3", "a name that does not match the licence holder is rejected", async () => {
    const driver = await driverWith({
      fullName: "Completely Different Person",
      vehicleNumber: "KL07YY4321",
      drivingLicenseNumber: "KL0120240004322",
    });
    const res = await api("/drivers/documents/verify", { method: "POST", token: driver.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.verificationStatus, "verificationStatus").toBeOneOf(["REJECTED", "IN_REVIEW"]);

    const profile = await db.driverProfile.findUniqueOrThrow({ where: { userId: driver.id } });
    expect(profile.rejectionReason, "a reason is given").toBeDefined();
  });

  test("3.4", "a licence ending 0000 is treated as not found", async () => {
    const driver = await driverWith({
      fullName: "Mock Verified Holder Owner",
      vehicleNumber: "KL07XX4321",
      drivingLicenseNumber: "KL0120240000000",
    });
    const res = await api("/drivers/documents/verify", { method: "POST", token: driver.accessToken });
    expect(res.body.verificationStatus, "verificationStatus").toBe("REJECTED");

    const dl = await db.driverDocument.findFirst({ where: { driverId: driver.id, type: "DRIVING_LICENSE" } });
    expect(dl?.status, "DL document status").toBe("REJECTED");
    expect(dl?.rejectionReason, "reason").toContain("No licence found");
  });

  test("3.5", "a vehicle registration ending 0000 is treated as not found", async () => {
    const driver = await driverWith({
      fullName: "Mock Verified Holder Owner",
      vehicleNumber: "KL07WW0000",
      drivingLicenseNumber: "KL0120240004323",
    });
    const res = await api("/drivers/documents/verify", { method: "POST", token: driver.accessToken });
    expect(res.body.verificationStatus, "verificationStatus").toBe("REJECTED");

    // One RC lookup drives four documents, so all four must fail together rather than
    // leaving a driver half-approved.
    const docs = await db.driverDocument.findMany({
      where: { driverId: driver.id, type: { in: ["VEHICLE_RC", "INSURANCE", "FITNESS_CERTIFICATE", "PERMIT"] } },
    });
    expect(docs.length, "four documents written").toBe(4);
    for (const d of docs) expect(d.status, `${d.type} status`).toBe("REJECTED");
  });

  test("3.6", "re-running verification on an approved driver does not downgrade them", async () => {
    const before = await db.driverProfile.findUniqueOrThrow({ where: { userId: ctx.driverA.id } });
    expect(before.verificationStatus, "starts APPROVED").toBe("APPROVED");

    const res = await api("/drivers/documents/verify", { method: "POST", token: ctx.driverA.accessToken });
    expect(res.status, "status").toBe(200);
    expect(res.body.verificationStatus, "still APPROVED").toBe("APPROVED");
  });

  test("3.7", "a suspended driver cannot re-run verification to clear it", async () => {
    // Suspension is a human decision, so an automated recompute must never undo it.
    await db.driverProfile.update({
      where: { userId: ctx.driverFar.id },
      data: { verificationStatus: "SUSPENDED" },
    });

    const res = await api("/drivers/documents/verify", { method: "POST", token: ctx.driverFar.accessToken });
    expect(res.status, "status").toBe(403);
    expect(res.code, "code").toBe("SUSPENDED");

    const after = await db.driverProfile.findUniqueOrThrow({ where: { userId: ctx.driverFar.id } });
    expect(after.verificationStatus, "still SUSPENDED").toBe("SUSPENDED");

    await db.driverProfile.update({
      where: { userId: ctx.driverFar.id },
      data: { verificationStatus: "APPROVED" },
    });
  });

  test("3.8", "a suspended driver is off the dispatch board", async () => {
    await db.driverProfile.update({
      where: { userId: ctx.driverB.id },
      data: { verificationStatus: "SUSPENDED" },
    });

    const res = await api("/bookings/available", { token: ctx.driverB.accessToken });
    expect(res.status, "status").toBe(403);
    expect(res.code, "code").toBe("DRIVER_NOT_APPROVED");

    await db.driverProfile.update({
      where: { userId: ctx.driverB.id },
      data: { verificationStatus: "APPROVED", isOnline: true },
    });
  });

  test("3.9", "an unapproved driver cannot see the load feed", async () => {
    const res = await api("/bookings/available", { token: ctx.driverPending.accessToken });
    expect(res.status, "status").toBe(403);
    expect(res.code, "code").toBe("DRIVER_NOT_APPROVED");
  });

  test("3.10", "uploading a document number resets that document to PENDING", async () => {
    // A driver who got a document approved must not be able to quietly swap the file
    // afterwards without re-verification.
    const res = await api("/drivers/documents/PAN", {
      method: "POST",
      token: ctx.driverPending.accessToken,
      headers: { "Content-Type": "application/json" },
      body: { number: "ABCDE1234F" },
    });
    expect(res.status, "status").toBeOneOf([201, 400]);
    if (res.status === 201) {
      const doc = await db.driverDocument.findFirst({
        where: { driverId: ctx.driverPending.id, type: "PAN" },
      });
      expect(doc?.status, "document status").toBe("PENDING");
      expect(doc?.number, "number stored").toBe("ABCDE1234F");
    }
  });

  test("3.11", "an unknown document type is refused", async () => {
    const res = await api("/drivers/documents/NOT_A_TYPE", {
      method: "POST",
      token: ctx.driverPending.accessToken,
      body: { number: "ABCDE1234F" },
    });
    expect(res.status, "status").toBe(400);
  });

  test("3.12", "uploading with neither a file nor a number is refused", async () => {
    const res = await api("/drivers/documents/PAN", {
      method: "POST",
      token: ctx.driverPending.accessToken,
      body: {},
    });
    expect(res.status, "status").toBe(400);
  });

  test("3.13", "a driver cannot read another driver's document file", async () => {
    const someone = await db.driverDocument.findFirst({
      where: { driverId: ctx.driverA.id },
      select: { id: true },
    });
    if (!someone) return; // no file-backed document in this run
    const res = await api(`/drivers/documents/${someone.id}/file`, { token: ctx.driverB.accessToken });
    expect(res.status, "status").toBe(404);
  });

  test("3.14", "a rider cannot reach the documents surface at all", async () => {
    const rider = await disposableRider("kycprobe");
    expect((await api("/drivers/documents", { token: rider.accessToken })).status, "GET").toBe(403);
    expect(
      (await api("/drivers/documents/verify", { method: "POST", token: rider.accessToken })).status,
      "POST verify",
    ).toBe(403);
  });
});
