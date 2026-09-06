/**
 * Builders for the shapes the screens actually receive.
 *
 * Every default here matches a real server response, so a test that overrides one field is
 * testing that field rather than accidentally testing a fixture nobody checked.
 */

import type { VerificationStatus } from '@/lib/auth-context';

export function driver(over: Record<string, unknown> = {}) {
  return {
    id: 'drv_1',
    role: 'DRIVER',
    fullName: 'Mock Verified Holder Owner',
    phone: '9876543210',
    email: null,
    driverProfile: {
      vehicleType: 'tataAce',
      vehicleNumber: 'KL07AB1234',
      drivingLicenseNumber: 'KL0120240001234',
      verificationStatus: 'APPROVED' as VerificationStatus,
      isOnline: false,
      ratingAvg: 4.8,
      ratingCount: 124,
      ...(over.driverProfile as object),
    },
    ...over,
  };
}

export function booking(over: Record<string, unknown> = {}) {
  return {
    id: 'bkg_1',
    reference: 'TRK-4F2A91',
    status: 'ACCEPTED',
    pickupAddress: 'Marine Drive, Kochi',
    dropAddress: 'Thrissur Round, Thrissur',
    pickupLat: 9.9312,
    pickupLng: 76.2673,
    dropLat: 10.5276,
    dropLng: 76.2144,
    routePolyline: null,
    distanceKm: 84.02,
    estimatedFare: 4200,
    actualFare: null,
    vehicleType: 'tataAce',
    myBid: null,
    ...over,
  };
}

export function documentRow(type: string, over: Record<string, unknown> = {}) {
  return {
    type,
    required: true,
    status: 'PENDING' as VerificationStatus,
    number: null,
    expiresAt: null,
    rejectionReason: null,
    hasFile: false,
    ...over,
  };
}

/** The five gating documents, as `GET /drivers/documents` returns them. */
export function documentsResponse(over: Record<string, unknown> = {}) {
  return {
    verificationStatus: 'PENDING' as VerificationStatus,
    rejectionReason: null,
    approvedAt: null,
    documents: [
      documentRow('DRIVING_LICENSE'),
      documentRow('VEHICLE_RC'),
      documentRow('INSURANCE'),
      documentRow('FITNESS_CERTIFICATE'),
      documentRow('PERMIT'),
    ],
    ...over,
  };
}

export function message(over: Record<string, unknown> = {}) {
  return {
    id: `msg_${Math.random().toString(36).slice(2, 8)}`,
    bookingId: 'bkg_1',
    senderId: 'drv_1',
    text: 'On my way.',
    createdAt: new Date().toISOString(),
    ...over,
  };
}
