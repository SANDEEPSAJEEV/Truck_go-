import { Colors, StatusColors, type StatusTone } from '@/constants/theme';

/**
 * The original app ships a single light palette — there is no dark variant in its
 * bundle — so this is a static lookup kept as a hook for call-site compatibility.
 */
export function useTheme() {
  return Colors;
}

/** Background/foreground pair for a status pill, matching the original's tone set. */
export function statusTone(tone: StatusTone) {
  return {
    background: StatusColors[`${tone}Bg`],
    foreground: StatusColors[`${tone}Fg`],
  };
}
