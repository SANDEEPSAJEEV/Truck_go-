/**
 * `upload.ts` — written for the document-upload feature and never executed until now.
 *
 * The validation matters more than it looks: this runs on a roadside connection, so a file
 * rejected here saves an 8MB upload that would have failed at the far end. And the header
 * detail matters most of all — setting Content-Type by hand produces a body the server
 * silently cannot parse.
 */

import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { ApiError, setTokens } from '@/lib/api';
import {
  captureDocument,
  pickDocumentFile,
  pickDocumentImage,
  uploadDocument,
  UploadError,
} from '@/lib/upload';

const jpg = { uri: 'file:///tmp/dl.jpg', name: 'dl.jpg', mimeType: 'image/jpeg', size: 1024 };

function reply(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}

describe('validation before any upload', () => {
  it('refuses a file type the server would reject', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    await expect(
      uploadDocument('DRIVING_LICENSE', { ...jpg, mimeType: 'image/heic', name: 'dl.heic' }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a file over 8MB before spending the upload', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const huge = { ...jpg, size: 9 * 1024 * 1024 };

    await expect(uploadDocument('INSURANCE', huge)).rejects.toThrow(/8MB/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a file whose size is unknown rather than blocking the driver', async () => {
    // Some pickers report no size. Refusing on a missing number would make the document
    // unuploadable for reasons the driver cannot see or fix.
    await setTokens('access-1', 'refresh-1');
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(201, { ok: true }));

    await expect(uploadDocument('PERMIT', { ...jpg, size: undefined })).resolves.toBeUndefined();
  });

  it('accepts every type the server accepts', async () => {
    await setTokens('access-1', 'refresh-1');
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(201, { ok: true }));
      await expect(uploadDocument('VEHICLE_RC', { ...jpg, mimeType })).resolves.toBeUndefined();
    }
  });
});

describe('the request itself', () => {
  it('posts multipart to the document type, without setting Content-Type', async () => {
    await setTokens('access-1', 'refresh-1');
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(201, { ok: true }));

    await uploadDocument('DRIVING_LICENSE', jpg, { number: 'KL0120240001234' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/drivers/documents/DRIVING_LICENSE');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);

    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-1');
    // The runtime appends the multipart boundary. Setting this by hand loses it, and the
    // server then cannot parse a body that looks perfectly fine from here.
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('content-type');
  });

  it('carries the document number and expiry when given, and omits them when not', async () => {
    await setTokens('access-1', 'refresh-1');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply(201, {}))
      .mockResolvedValueOnce(reply(201, {}));

    await uploadDocument('INSURANCE', jpg, { number: 'POL123', expiresAt: '2027-01-31' });
    await uploadDocument('INSURANCE', jpg);

    const withMeta = fetchMock.mock.calls[0][1]?.body as unknown as FormData;
    const withoutMeta = fetchMock.mock.calls[1][1]?.body as unknown as FormData;
    expect(withMeta.get('number')).toBe('POL123');
    expect(withMeta.get('expiresAt')).toBe('2027-01-31');
    expect(withoutMeta.get('number')).toBeNull();
    expect(withoutMeta.get('expiresAt')).toBeNull();
  });

  it('turns a server refusal into an ApiError carrying its code', async () => {
    await setTokens('access-1', 'refresh-1');
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(reply(400, { error: { code: 'VALIDATION', message: 'Unknown document type.' } }));

    const error = await uploadDocument('NONSENSE', jpg).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('VALIDATION');
    expect(error.message).toBe('Unknown document type.');
  });

  it('still fails usefully when the server sends no error envelope', async () => {
    await setTokens('access-1', 'refresh-1');
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(reply(502, undefined));

    const error = await uploadDocument('PERMIT', jpg).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.message.length).toBeGreaterThan(0);
  });
});

describe('picking a file', () => {
  it('returns null when the driver backs out of the camera', async () => {
    // Cancelling is not an error and must not produce a message.
    (ImagePicker.launchCameraAsync as jest.Mock).mockResolvedValueOnce({ canceled: true, assets: null });
    await expect(captureDocument()).resolves.toBeNull();
  });

  it('explains itself when camera permission is refused', async () => {
    (ImagePicker.requestCameraPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false });
    await expect(captureDocument()).rejects.toBeInstanceOf(UploadError);
  });

  it('falls back to a sensible filename when the picker gives none', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///tmp/x', fileName: null, mimeType: 'image/png', fileSize: 200 }],
    });

    const file = await pickDocumentImage();
    expect(file?.name).toBe('document.png');
    expect(file?.mimeType).toBe('image/png');
  });

  it('reads a PDF from the document picker', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///tmp/p.pdf', name: 'permit.pdf', mimeType: 'application/pdf', size: 4096 }],
    });

    const file = await pickDocumentFile();
    expect(file).toEqual({
      uri: 'file:///tmp/p.pdf',
      name: 'permit.pdf',
      mimeType: 'application/pdf',
      size: 4096,
    });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});
