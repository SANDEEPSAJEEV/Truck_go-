import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { API_URL, ApiError, getAccessToken } from '@/lib/api';

/**
 * Picking and uploading a KYC document.
 *
 * Kept out of the screen because the same three-way choice — camera, gallery, PDF — belongs
 * to every document type, and because the upload itself is the one request in the app that
 * cannot go through `apiFetch`: multipart bodies need the runtime to set their own
 * `Content-Type` boundary, and `apiFetch` always sets `application/json`.
 */

/** Mirrors ALLOWED_UPLOAD_TYPES on the server. Rejecting here saves an 8MB round trip. */
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 8 * 1024 * 1024;

export type PickedFile = { uri: string; name: string; mimeType: string; size?: number };

export class UploadError extends Error {}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'jpg';
}

/** Photograph the document. Returns null when the driver backs out. */
export async function captureDocument(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    throw new UploadError('Camera access is needed to photograph the document.');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: 'images',
    // A licence has to stay legible after compression, but an 8MB original is a slow upload
    // on the roadside connection this will usually happen on.
    quality: 0.7,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? `document.${extensionFor(asset.mimeType ?? 'image/jpeg')}`,
    mimeType: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize,
  };
}

/** Pick an existing photo. */
export async function pickDocumentImage(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    throw new UploadError('Photo access is needed to choose a document.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.7 });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? `document.${extensionFor(asset.mimeType ?? 'image/jpeg')}`,
    mimeType: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize,
  };
}

/** Pick a PDF — insurance and permits usually arrive as one. */
export async function pickDocumentFile(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ACCEPTED,
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.name ?? 'document.pdf',
    mimeType: asset.mimeType ?? 'application/pdf',
    size: asset.size ?? undefined,
  };
}

/**
 * Sends the file to `POST /drivers/documents/:type`.
 *
 * A re-upload always resets that document to PENDING server-side, so a driver cannot get one
 * approved and then quietly swap the file.
 */
export async function uploadDocument(
  type: string,
  file: PickedFile,
  meta?: { number?: string; expiresAt?: string },
): Promise<void> {
  if (!ACCEPTED.includes(file.mimeType)) {
    throw new UploadError('Use a JPG, PNG or PDF.');
  }
  if (file.size != null && file.size > MAX_BYTES) {
    throw new UploadError('That file is over 8MB. Try photographing it instead of attaching a scan.');
  }

  const body = new FormData();
  // React Native's FormData takes this shape for a file part; it is not a browser Blob.
  body.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);
  if (meta?.number) body.append('number', meta.number);
  if (meta?.expiresAt) body.append('expiresAt', meta.expiresAt);

  const token = await getAccessToken();
  const res = await fetch(new URL(`/drivers/documents/${type}`, API_URL).toString(), {
    method: 'POST',
    // Content-Type is deliberately omitted: the runtime appends the multipart boundary, and
    // setting it by hand produces a body the server cannot parse.
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(
      res.status,
      data?.error?.code ?? 'UPLOAD_FAILED',
      data?.error?.message ?? 'Could not upload that document. Please try again.',
    );
  }
}
