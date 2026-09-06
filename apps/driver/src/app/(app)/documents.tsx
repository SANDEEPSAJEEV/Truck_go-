import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ActionSheetIOS, ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { AppBar } from '@/components/ui/app-bar';
import { Button } from '@/components/ui/button';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { useAuth, type VerificationStatus } from '@/lib/auth-context';
import {
  captureDocument,
  pickDocumentFile,
  pickDocumentImage,
  uploadDocument,
  UploadError,
} from '@/lib/upload';

type DocumentRow = {
  type: string;
  required: boolean;
  status: VerificationStatus;
  number: string | null;
  expiresAt: string | null;
  rejectionReason: string | null;
  hasFile: boolean;
};

type PickSource = 'camera' | 'gallery' | 'file';

type DocumentsResponse = {
  verificationStatus: VerificationStatus;
  rejectionReason: string | null;
  documents: DocumentRow[];
};

const DOCUMENT_LABELS: Record<string, string> = {
  DRIVING_LICENSE: 'Driving Licence',
  VEHICLE_RC: 'Vehicle Registration (RC)',
  INSURANCE: 'Insurance',
  FITNESS_CERTIFICATE: 'Fitness Certificate',
  PERMIT: 'Goods Permit',
  PAN: 'PAN Card',
  AADHAAR: 'Aadhaar',
  PHOTO: 'Profile Photo',
};

// Copy is written for the driver's situation, not the database's: it says what is happening
// and what they can do about it.
const STATUS_COPY: Record<VerificationStatus, { label: string; body: string; tone: 'info' | 'warning' | 'success' | 'danger' }> = {
  PENDING: {
    label: 'Verification pending',
    body: "We're checking your documents against government records. This usually takes a moment.",
    tone: 'info',
  },
  IN_REVIEW: {
    label: 'Under review',
    body: "Something needs a person to look at it. Our team will get back to you shortly.",
    tone: 'warning',
  },
  APPROVED: {
    label: 'Verified',
    body: 'You can go online and start accepting trips.',
    tone: 'success',
  },
  REJECTED: {
    label: 'Verification rejected',
    body: 'Fix the issue below and run the check again.',
    tone: 'danger',
  },
  EXPIRED: {
    label: 'Document expired',
    body: 'Update the expired document to start accepting trips again.',
    tone: 'danger',
  },
  SUSPENDED: {
    label: 'Account suspended',
    body: 'Contact support for help with your account.',
    tone: 'danger',
  },
};

// Each row's icon sits in a tinted circle rather than floating bare — approved reads calm
// (navy on its own tint), anything needing attention reads as the same orange used for the
// verification banner above, so the two visual languages agree on what "needs a look" means.
const ROW_ICON: Record<
  string,
  { name: keyof typeof MaterialIcons.glyphMap; fg: string; bg: string }
> = {
  APPROVED: { name: 'check', fg: Colors.primary, bg: 'rgba(0,32,69,0.1)' },
  PENDING: { name: 'schedule', fg: Colors.secondary, bg: 'rgba(237,137,54,0.15)' },
  IN_REVIEW: { name: 'hourglass-empty', fg: Colors.secondary, bg: 'rgba(237,137,54,0.15)' },
  REJECTED: { name: 'close', fg: Colors.error, bg: Colors.errorContainer },
  EXPIRED: { name: 'error-outline', fg: Colors.error, bg: Colors.errorContainer },
  SUSPENDED: { name: 'block', fg: Colors.error, bg: Colors.errorContainer },
};

export default function Documents() {
  const { refreshUser } = useAuth();
  const [data, setData] = useState<DocumentsResponse | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [verifying, setVerifying] = useState(false);
  /** Which document is mid-upload, so only that row shows a spinner. */
  const [uploading, setUploading] = useState<string | null>(null);
  /** Which row has its source picker open. Null on iOS, which uses the native sheet. */
  const [picking, setPicking] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<DocumentsResponse>('/drivers/documents')
      .then((d) => {
        setData(d);
        setLoadError('');
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Could not load your documents.'));
  }, []);

  useFocusEffect(load);

  async function upload(type: string, source: PickSource) {
    setPicking(null);
    setActionError('');
    try {
      const file =
        source === 'camera'
          ? await captureDocument()
          : source === 'gallery'
            ? await pickDocumentImage()
            : await pickDocumentFile();
      // Backing out of the picker is not an error and needs no message.
      if (!file) return;

      setUploading(type);
      await uploadDocument(type, file);
      load();
    } catch (e) {
      setActionError(
        e instanceof UploadError || e instanceof ApiError
          ? e.message
          : 'Could not upload that document. Please try again.',
      );
    } finally {
      setUploading(null);
    }
  }

  function chooseSource(type: string) {
    setActionError('');
    if (Platform.OS !== 'ios') {
      setPicking((current) => (current === type ? null : type));
      return;
    }
    // iOS has a native sheet for exactly this and users expect it.
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ['Cancel', 'Take a photo', 'Choose from photos', 'Choose a PDF'],
        cancelButtonIndex: 0,
      },
      (index) => {
        if (index === 1) upload(type, 'camera');
        if (index === 2) upload(type, 'gallery');
        if (index === 3) upload(type, 'file');
      },
    );
  }

  async function runVerification() {
    setVerifying(true);
    setActionError('');
    try {
      await apiFetch('/drivers/documents/verify', { method: 'POST' });
      load();
      // The dashboard's online toggle reads verification status from the session user.
      await refreshUser();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'Could not run verification. Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  if (!data) {
    return (
      <Screen style={styles.centered}>
        {loadError ? (
          <>
            <AppText variant="bodyLg" color="error" align="center">
              {loadError}
            </AppText>
            <Button label="Retry" variant="outline" onPress={load} style={styles.retry} />
          </>
        ) : (
          <ActivityIndicator color={Colors.primary} />
        )}
      </Screen>
    );
  }

  const status = STATUS_COPY[data.verificationStatus];
  const required = data.documents.filter((d) => d.required);

  return (
    <Screen>
      <AppBar back title="Documents & KYC" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.banner, bannerStyle(status.tone)]}>
          <AppText
            variant="headlineSm"
            color={
              status.tone === 'success'
                ? 'onPrimaryContainer'
                : status.tone === 'info' || status.tone === 'warning'
                  ? 'onSecondaryContainer'
                  : 'onSurface'
            }
          >
            {status.label}
          </AppText>
          <AppText
            variant="bodySm"
            color={
              status.tone === 'success'
                ? 'onPrimaryContainer'
                : status.tone === 'info' || status.tone === 'warning'
                  ? 'onSecondaryContainer'
                  : 'onSurfaceVariant'
            }
          >
            {data.rejectionReason ?? status.body}
          </AppText>
        </View>

        <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
          Required documents
        </AppText>

        {required.map((doc) => {
          const icon = ROW_ICON[doc.status] ?? ROW_ICON.PENDING;
          const busy = uploading === doc.type;
          const open = picking === doc.type;
          return (
            <View key={doc.type} style={styles.docBlock}>
              <View style={styles.row}>
                <View style={[styles.iconCircle, { backgroundColor: icon.bg }]}>
                  <MaterialIcons name={icon.name} size={18} color={icon.fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppText variant="headlineSm">{DOCUMENT_LABELS[doc.type] ?? doc.type}</AppText>
                  <AppText variant="bodySm" color="onSurfaceVariant">
                    {doc.rejectionReason ??
                      (doc.expiresAt
                        ? `Valid until ${new Date(doc.expiresAt).toLocaleDateString()}`
                        : doc.status === 'APPROVED'
                          ? 'Verified'
                          : doc.hasFile
                            ? 'Uploaded — awaiting verification'
                            : 'Not uploaded yet')}
                  </AppText>
                </View>

                {busy ? (
                  <ActivityIndicator color={Colors.primary} />
                ) : (
                  <Pressable
                    onPress={() => chooseSource(doc.type)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${doc.hasFile ? 'Replace' : 'Upload'} ${DOCUMENT_LABELS[doc.type] ?? doc.type}`}
                    style={styles.uploadBtn}
                  >
                    <MaterialIcons
                      name={doc.hasFile ? 'refresh' : 'file-upload'}
                      size={16}
                      color={Colors.primary}
                    />
                    <AppText variant="bodySm" color="primary">
                      {doc.hasFile ? 'Replace' : 'Upload'}
                    </AppText>
                  </Pressable>
                )}
              </View>

              {open ? (
                <View style={styles.sourceRow}>
                  <SourceButton icon="photo-camera" label="Camera" onPress={() => upload(doc.type, 'camera')} />
                  <SourceButton icon="photo-library" label="Photos" onPress={() => upload(doc.type, 'gallery')} />
                  <SourceButton icon="picture-as-pdf" label="PDF" onPress={() => upload(doc.type, 'file')} />
                </View>
              ) : null}
            </View>
          );
        })}

        {actionError ? (
          <AppText variant="bodySm" color="error">
            {actionError}
          </AppText>
        ) : null}

        {data.verificationStatus !== 'APPROVED' && data.verificationStatus !== 'SUSPENDED' ? (
          <Button label="Run verification" onPress={runVerification} loading={verifying} />
        ) : null}

        <AppText variant="bodySm" color="onSurfaceVariant">
          Your licence and vehicle details are checked against government records. Keep insurance,
          fitness and permit current — trips stop automatically when one expires.
        </AppText>

        <AppText variant="bodySm" color="onSurfaceVariant">
          Photograph documents in good light with all four corners visible. Replacing a document
          sends it for checking again.
        </AppText>
      </ScrollView>
    </Screen>
  );
}

/** One of the three ways to supply a document. Android only — iOS gets the native sheet. */
function SourceButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.sourceBtn} accessibilityRole="button">
      <MaterialIcons name={icon} size={20} color={Colors.primary} />
      <AppText variant="bodySm">{label}</AppText>
    </Pressable>
  );
}

function bannerStyle(tone: 'info' | 'warning' | 'success' | 'danger') {
  if (tone === 'success') return { backgroundColor: Colors.primaryContainer };
  if (tone === 'danger') return { backgroundColor: Colors.errorContainer };
  // info/warning ("pending" / "under review") share the same orange treatment as the
  // dashboard's verification banner, so the two screens read as one visual language.
  return { backgroundColor: 'rgba(237,137,54,0.1)', borderWidth: 1, borderColor: 'rgba(237,137,54,0.5)' };
}

const styles = StyleSheet.create({
  container: { padding: Spacing.lg, gap: Spacing.md },
  centered: { alignItems: 'center', justifyContent: 'center', gap: Spacing.md, padding: Spacing.lg },
  retry: { minWidth: 160 },
  banner: { borderRadius: Radii.lg, padding: Spacing.md, gap: Spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.outlineVariant,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  docBlock: { gap: Spacing.sm },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs / 2,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
  },
  sourceRow: { flexDirection: 'row', gap: Spacing.sm, paddingBottom: Spacing.sm },
  sourceBtn: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.xs / 2,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    backgroundColor: Colors.surfaceContainerLowest,
  },
});
