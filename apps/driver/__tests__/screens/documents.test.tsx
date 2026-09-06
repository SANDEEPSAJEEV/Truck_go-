/**
 * The documents screen — the one that decides whether a driver can work at all.
 *
 * Before upload existed, a rejected driver could only re-run a check against numbers they had
 * no way to change. These cases cover the path out of that, including the parts that must
 * *not* happen: a cancelled picker is not an error, and a file the server would refuse never
 * leaves the phone.
 */

import React from 'react';
// `render` is asynchronous in RNTL v14 — awaiting it is what populates `screen`.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';

import Documents from '@/app/(app)/documents';
import { ApiError } from '@/lib/api';
import * as upload from '@/lib/upload';
import { documentRow, documentsResponse } from '../fixtures';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, apiFetch: jest.fn() };
});

jest.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ refreshUser: jest.fn(), user: null }),
}));

const { apiFetch } = jest.requireMock('@/lib/api') as { apiFetch: jest.Mock };

/**
 * The suite resolves as Android, matching the APK that ships. The screen's iOS branch — the
 * native action sheet — is not reachable from here and is on the on-device list instead.
 */

function loadWith(response: unknown) {
  apiFetch.mockImplementation((path: string) => {
    if (path === '/drivers/documents') return Promise.resolve(response);
    return Promise.resolve({});
  });
}

describe('rendering each verification state', () => {
  it('shows the five gating documents and their status', async () => {
    loadWith(documentsResponse());
    await render(<Documents />);

    expect(await screen.findByText('Driving Licence')).toBeTruthy();
    expect(screen.getByText('Vehicle Registration (RC)')).toBeTruthy();
    expect(screen.getByText('Insurance')).toBeTruthy();
    expect(screen.getByText('Fitness Certificate')).toBeTruthy();
    expect(screen.getByText('Goods Permit')).toBeTruthy();
  });

  it('tells a rejected driver what is wrong and offers the check again', async () => {
    loadWith(
      documentsResponse({
        verificationStatus: 'REJECTED',
        rejectionReason: 'The name on this licence does not match the registered account holder.',
        documents: [documentRow('DRIVING_LICENSE', { status: 'REJECTED', rejectionReason: 'No licence found with that number.' })],
      }),
    );
    await render(<Documents />);

    expect(await screen.findByText(/does not match the registered account holder/)).toBeTruthy();
    expect(screen.getByText('No licence found with that number.')).toBeTruthy();
    expect(screen.getByText('Run verification')).toBeTruthy();
  });

  it('hides "Run verification" once approved — there is nothing left to run', async () => {
    loadWith(documentsResponse({ verificationStatus: 'APPROVED' }));
    await render(<Documents />);

    expect(await screen.findByText('Verified')).toBeTruthy();
    expect(screen.queryByText('Run verification')).toBeNull();
  });

  it('hides it for a suspended account, which no re-check can clear', async () => {
    loadWith(documentsResponse({ verificationStatus: 'SUSPENDED' }));
    await render(<Documents />);

    expect(await screen.findByText('Account suspended')).toBeTruthy();
    expect(screen.queryByText('Run verification')).toBeNull();
  });

  it('distinguishes "uploaded, waiting" from "not uploaded yet"', async () => {
    // These read identically before the upload work, which is the difference between
    // waiting and being stuck.
    loadWith(
      documentsResponse({
        documents: [
          documentRow('DRIVING_LICENSE', { hasFile: true }),
          documentRow('VEHICLE_RC', { hasFile: false }),
        ],
      }),
    );
    await render(<Documents />);

    expect(await screen.findByText('Uploaded — awaiting verification')).toBeTruthy();
    expect(screen.getByText('Not uploaded yet')).toBeTruthy();
  });

  it('offers Replace for a document already on file, Upload for one that is not', async () => {
    loadWith(
      documentsResponse({
        documents: [
          documentRow('DRIVING_LICENSE', { hasFile: true }),
          documentRow('VEHICLE_RC', { hasFile: false }),
        ],
      }),
    );
    await render(<Documents />);

    expect(await screen.findByText('Replace')).toBeTruthy();
    expect(screen.getByText('Upload')).toBeTruthy();
  });

  it('surfaces a load failure with a way back', async () => {
    apiFetch.mockRejectedValue(new ApiError(500, 'INTERNAL', 'Could not load your documents.'));
    await render(<Documents />);

    expect(await screen.findByText('Could not load your documents.')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});

describe('uploading', () => {
  it('offers camera, photos and PDF when a document is tapped', async () => {
    loadWith(documentsResponse());
    await render(<Documents />);

    fireEvent.press(await screen.findByLabelText('Upload Driving Licence'));

    // findBy rather than getBy: a press schedules the state update, it does not apply it
    // synchronously, so asserting immediately reads the tree from before the tap.
    expect(await screen.findByText('Camera')).toBeTruthy();
    expect(screen.getByText('Photos')).toBeTruthy();
    expect(screen.getByText('PDF')).toBeTruthy();
  });

  it('sends the picked file and reloads the list', async () => {
    loadWith(documentsResponse());
    const uploadSpy = jest.spyOn(upload, 'uploadDocument').mockResolvedValue(undefined);
    jest.spyOn(upload, 'pickDocumentImage').mockResolvedValue({
      uri: 'file:///tmp/dl.jpg',
      name: 'dl.jpg',
      mimeType: 'image/jpeg',
      size: 2048,
    });

    await render(<Documents />);
    fireEvent.press(await screen.findByLabelText('Upload Driving Licence'));
    fireEvent.press(await screen.findByText('Photos'));

    await waitFor(() => expect(uploadSpy).toHaveBeenCalledWith('DRIVING_LICENSE', expect.objectContaining({ name: 'dl.jpg' })));
    // Re-fetched, so the row reflects the new state rather than the stale one.
    await waitFor(() => expect(apiFetch.mock.calls.filter(([p]) => p === '/drivers/documents').length).toBeGreaterThan(1));
  });

  it('treats backing out of the picker as nothing at all', async () => {
    loadWith(documentsResponse());
    const uploadSpy = jest.spyOn(upload, 'uploadDocument');
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: true, assets: null });

    await render(<Documents />);
    fireEvent.press(await screen.findByLabelText('Upload Driving Licence'));
    fireEvent.press(await screen.findByText('Photos'));

    await waitFor(() => expect(screen.queryByText('Camera')).toBeNull());
    expect(uploadSpy).not.toHaveBeenCalled();
    // Cancelling is not a failure and must not leave an error on screen.
    expect(screen.queryByText(/Could not upload/)).toBeNull();
  });

  it('explains a rejected file instead of failing silently', async () => {
    loadWith(documentsResponse());
    jest
      .spyOn(upload, 'pickDocumentImage')
      .mockResolvedValue({ uri: 'f', name: 'x.heic', mimeType: 'image/heic', size: 10 });
    jest.spyOn(upload, 'uploadDocument').mockRejectedValue(new upload.UploadError('Use a JPG, PNG or PDF.'));

    await render(<Documents />);
    fireEvent.press(await screen.findByLabelText('Upload Driving Licence'));
    fireEvent.press(await screen.findByText('Photos'));

    expect(await screen.findByText('Use a JPG, PNG or PDF.')).toBeTruthy();
  });

  it('shows the server’s own message when an upload is refused', async () => {
    loadWith(documentsResponse());
    jest
      .spyOn(upload, 'pickDocumentFile')
      .mockResolvedValue({ uri: 'f', name: 'p.pdf', mimeType: 'application/pdf', size: 10 });
    jest
      .spyOn(upload, 'uploadDocument')
      .mockRejectedValue(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'That request was too large.'));

    await render(<Documents />);
    fireEvent.press(await screen.findByLabelText('Upload Goods Permit'));
    fireEvent.press(await screen.findByText('PDF'));

    expect(await screen.findByText('That request was too large.')).toBeTruthy();
  });
});

describe('running verification', () => {
  it('reports the service being unavailable rather than appearing to hang', async () => {
    // This is what a missing KYC vendor produces. It used to hang until the host gave up.
    apiFetch.mockImplementation((path: string) => {
      if (path === '/drivers/documents') return Promise.resolve(documentsResponse());
      return Promise.reject(
        new ApiError(503, 'VERIFICATION_UNAVAILABLE', 'Document verification is unavailable right now. Please try again shortly.'),
      );
    });

    await render(<Documents />);
    fireEvent.press(await screen.findByText('Run verification'));

    expect(await screen.findByText(/unavailable right now/)).toBeTruthy();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});
