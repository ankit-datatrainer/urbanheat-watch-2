import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

/** Fades and springs its children up into place; `index` staggers siblings. */
export default function Reveal({
  index = 0,
  children,
  style,
}: {
  index?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Animated.View
      entering={FadeInDown.delay(60 + index * 70)
        .springify()
        .damping(18)
        .stiffness(140)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
