import { View, type ViewProps } from 'react-native';

import { Colors } from '@/constants/theme';

type ScreenProps = ViewProps & {
  /** Which surface token to paint. Defaults to the app background. */
  surface?: 'background' | 'surface' | 'surfaceContainerLowest' | 'surfaceContainer';
};

export function Screen({ surface = 'background', style, ...rest }: ScreenProps) {
  return <View style={[{ flex: 1, backgroundColor: Colors[surface] }, style]} {...rest} />;
}
