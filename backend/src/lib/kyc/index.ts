// Document verification sits behind an interface so the approval flow is buildable and
// testable before any vendor account exists. Surepass is the configured production
// provider; swapping to Signzy/Karza/IDfy means adding one class here.
//
// What matters is that these calls hit government sources (Sarathi for licences, Vahan for
// registrations). A human squinting at a photo cannot tell a good forgery from a real
// document, and cannot tell whether a licence covers commercial goods carriage at all.

export type DlVerification = {
  ok: boolean;
  holderName?: string;
  dob?: string;
  validFrom?: string;
  validUpto?: string;
  /** e.g. ["LMV", "HGMV", "TRANS"] — decides whether commercial goods carriage is allowed. */
  vehicleClasses?: string[];
  raw: unknown;
  failureReason?: string;
};

export type RcVerification = {
  ok: boolean;
  ownerName?: string;
  vehicleClass?: string;
  registrationDate?: string;
  fitnessUpto?: string;
  insuranceUpto?: string;
  permitUpto?: string;
  isCommercial?: boolean;
  raw: unknown;
  failureReason?: string;
};

export interface KycProvider {
  readonly name: string;
  verifyDrivingLicense(licenseNumber: string, dob?: string): Promise<DlVerification>;
  verifyVehicleRc(registrationNumber: string): Promise<RcVerification>;
}

/**
 * Deterministic stand-in for local development and tests.
 *
 * It is a real gate, not a rubber stamp: anything failing the government format rules is
 * rejected, and a licence number ending in `0000` is treated as not-found so the rejection
 * path can actually be exercised. That keeps the approval flow honest before a vendor
 * account exists.
 */
export class MockKycProvider implements KycProvider {
  readonly name = "mock";

  async verifyDrivingLicense(licenseNumber: string): Promise<DlVerification> {
    const normalized = licenseNumber.toUpperCase().replace(/[\s-]/g, "");
    if (!/^[A-Z]{2}[0-9]{2}[0-9]{11}$/.test(normalized)) {
      return { ok: false, raw: { mock: true }, failureReason: "Licence number format is not valid." };
    }
    if (normalized.endsWith("0000")) {
      return { ok: false, raw: { mock: true }, failureReason: "No licence found with that number." };
    }
    const validUpto = new Date(Date.now() + 3 * 365 * 86400_000).toISOString().slice(0, 10);
    return {
      ok: true,
      holderName: "MOCK VERIFIED HOLDER",
      validUpto,
      vehicleClasses: ["LMV", "HGMV", "TRANS"],
      raw: { mock: true, licenseNumber: normalized },
    };
  }

  async verifyVehicleRc(registrationNumber: string): Promise<RcVerification> {
    const normalized = registrationNumber.toUpperCase().replace(/[\s-]/g, "");
    if (!/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$/.test(normalized)) {
      return { ok: false, raw: { mock: true }, failureReason: "Vehicle number format is not valid." };
    }
    if (normalized.endsWith("0000")) {
      return { ok: false, raw: { mock: true }, failureReason: "No vehicle found with that registration." };
    }
    const plusYear = (y: number) => new Date(Date.now() + y * 365 * 86400_000).toISOString().slice(0, 10);
    return {
      ok: true,
      ownerName: "MOCK VERIFIED OWNER",
      vehicleClass: "HGV",
      fitnessUpto: plusYear(1),
      insuranceUpto: plusYear(1),
      permitUpto: plusYear(2),
      isCommercial: true,
      raw: { mock: true, registrationNumber: normalized },
    };
  }
}

export class SurepassProvider implements KycProvider {
  readonly name = "surepass";

  constructor(
    private readonly token: string,
    private readonly baseUrl = "https://kyc-api.surepass.io/api/v1",
  ) {}

  private async post(path: string, body: Record<string, unknown>) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  }

  async verifyDrivingLicense(licenseNumber: string, dob?: string): Promise<DlVerification> {
    const { ok, json } = await this.post("/driving-license/driving-license", {
      id_number: licenseNumber,
      dob,
    });
    const data = (json as any)?.data;
    if (!ok || !data) {
      return { ok: false, raw: json, failureReason: (json as any)?.message ?? "Licence could not be verified." };
    }
    return {
      ok: true,
      holderName: data.name,
      dob: data.dob,
      validFrom: data.doi,
      validUpto: data.doe,
      vehicleClasses: data.vehicle_classes ?? [],
      raw: json,
    };
  }

  async verifyVehicleRc(registrationNumber: string): Promise<RcVerification> {
    const { ok, json } = await this.post("/rc/rc-full", { id_number: registrationNumber });
    const data = (json as any)?.data;
    if (!ok || !data) {
      return { ok: false, raw: json, failureReason: (json as any)?.message ?? "Vehicle could not be verified." };
    }
    return {
      ok: true,
      ownerName: data.owner_name,
      vehicleClass: data.vehicle_category ?? data.vehicle_class,
      registrationDate: data.registration_date,
      fitnessUpto: data.fit_up_to,
      insuranceUpto: data.insurance_upto,
      permitUpto: data.permit_valid_upto,
      isCommercial: /commercial|transport|goods/i.test(String(data.vehicle_category ?? "")),
      raw: json,
    };
  }
}

let provider: KycProvider | null = null;

export function getKycProvider(): KycProvider {
  if (provider) return provider;

  const { SUREPASS_TOKEN, NODE_ENV } = process.env;
  if (SUREPASS_TOKEN) {
    provider = new SurepassProvider(SUREPASS_TOKEN);
  } else {
    if (NODE_ENV === "production" && process.env.ALLOW_MOCK_PROVIDERS !== "1") {
      // Approving real drivers against a mock would be the single most dangerous silent
      // failure in this system.
      throw new Error("No KYC provider configured. Set SUREPASS_TOKEN.");
    }
    if (NODE_ENV === "production") {
      // Same deliberate staging escape hatch as SMS. Worth being blunt about what it
      // means: with this set, "verified" means a deterministic stand-in said so, not that
      // anyone checked a licence against government records.
      console.warn(
        "[kyc] ALLOW_MOCK_PROVIDERS=1 — driver documents are NOT checked against " +
          "government records. Never leave this set on a deployment real drivers can reach.",
      );
    }
    provider = new MockKycProvider();
  }
  return provider;
}
