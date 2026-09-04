import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';

export type BottomSheetProps = {
  /** Visible heights in px, ascending. e.g. [150, 400, 700] */
  snapPoints: number[];
  /** Controlled index into `snapPoints`. */
  index: number;
  onIndexChange: (index: number) => void;
  /** Rendered under the grabber, above the scrolling content. */
  header?: ReactNode;
  children: ReactNode;
};

/**
 * Draggable sheet built on core Animated + PanResponder.
 *
 * Deliberately not @gorhom/bottom-sheet: that needs Reanimated (present in package.json
 * but with zero call sites in this app, so never actually exercised) plus a
 * GestureHandlerRootView at the root, which this app doesn't mount. Both are real
 * crash-on-launch surfaces, and EAS builds here are rationed. Core Animated adds no
 * dependency, touches no root tree, and renders identically on web — so the sheet can be
 * verified in the browser instead of costing a build to find out.
 *
 * The pan handler is attached to the grabber only, never the body. That makes
 * drag-versus-scroll conflicts structurally impossible without any gesture composition:
 * the list scrolls because the sheet simply isn't listening there.
 */
export function BottomSheet({
  snapPoints,
  index,
  onIndexChange,
  header,
  children,
}: BottomSheetProps) {
  const { height: screenH } = useWindowDimensions();
  const maxHeight = snapPoints[snapPoints.length - 1];

  // translateY is measured from "sheet fully extended". Larger = more collapsed.
  const offsetFor = (i: number) => maxHeight - snapPoints[i];

  const translateY = useRef(new Animated.Value(offsetFor(index))).current;

  // Handlers close over refs, never props — React Compiler is enabled, and a responder
  // built from stale props drags once and then dies.
  const indexRef = useRef(index);
  const snapRef = useRef(snapPoints);
  const startRef = useRef(0);
  const onChangeRef = useRef(onIndexChange);
  indexRef.current = index;
  snapRef.current = snapPoints;
  onChangeRef.current = onIndexChange;

  useEffect(() => {
    Animated.spring(translateY, {
      toValue: maxHeight - snapPoints[index],
      tension: 90,
      friction: 14,
      useNativeDriver: true,
    }).start();
  }, [index, maxHeight, snapPoints, translateY]);

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        const points = snapRef.current;
        startRef.current = points[points.length - 1] - points[indexRef.current];
        translateY.stopAnimation();
      },
      onPanResponderMove: (_e, g) => {
        const points = snapRef.current;
        const max = points[points.length - 1];
        const next = startRef.current + g.dy;
        // Clamp: never past fully-open, never below the smallest detent.
        translateY.setValue(Math.min(Math.max(next, 0), max - points[0]));
      },
      onPanResponderRelease: (_e, g) => {
        const points = snapRef.current;
        const max = points[points.length - 1];
        const current = max - (startRef.current + g.dy);
        // Velocity carries intent: a fast flick should overshoot to the next detent
        // rather than snapping back to whatever is geometrically nearest.
        const projected = current - g.vy * 120;

        let best = 0;
        for (let i = 1; i < points.length; i += 1) {
          if (Math.abs(points[i] - projected) < Math.abs(points[best] - projected)) best = i;
        }
        onChangeRef.current(best);
        Animated.spring(translateY, {
          toValue: max - points[best],
          tension: 90,
          friction: 14,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[
        styles.sheet,
        { height: maxHeight, maxHeight: screenH * 0.92, transform: [{ translateY }] },
      ]}>
      <View {...pan.panHandlers} style={styles.grabArea}>
        <View style={styles.grabber} />
        {header}
      </View>
      <View style={styles.body}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.surfaceContainerLowest,
    borderTopLeftRadius: Radii.xl,
    borderTopRightRadius: Radii.xl,
    ...Shadows.lg,
  },
  grabArea: { paddingTop: Spacing.sm, paddingHorizontal: Spacing.containerMargin },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radii.pill,
    backgroundColor: Colors.outlineVariant,
    marginBottom: Spacing.sm,
  },
  body: { flex: 1 },
});
