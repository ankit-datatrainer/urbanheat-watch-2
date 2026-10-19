import { useEffect } from 'react';
import { View, StyleSheet, Image, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  ZoomIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { ONBOARDED_KEY } from '../lib/onboarding';
import { GUEST_KEY } from '../context/auth';
import AiMascot from '../components/ai/AiMascot';
import Credits from '../components/Credits';
import { C } from '../components/ui/theme';

const SPLASH_MS = 3000;

/** A soft colour blob that slowly breathes behind the logo. */
function Blob({
  color,
  size,
  top,
  left,
  delay,
}: {
  color: string;
  size: number;
  top: number;
  left: number;
  delay: number;
}) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.set(withDelay(delay, withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true)));
  }, [s, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.18 + s.value * 0.14,
    transform: [{ scale: 0.9 + s.value * 0.2 }, { translateY: -12 * s.value }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', top, left, width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        style,
      ]}
    />
  );
}

export default function SplashScreen() {
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(withTiming(1, { duration: SPLASH_MS - 150, easing: Easing.inOut(Easing.cubic) }));
  }, [progress]);

  const barStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  useEffect(() => {
    let isMounted = true;

    async function checkAuthAndNavigate() {
      try {
        const [{ data }, onboarded, guest] = await Promise.all([
          supabase.auth.getSession().catch(() => ({ data: { session: null } })),
          AsyncStorage.getItem(ONBOARDED_KEY).catch(() => null),
          AsyncStorage.getItem(GUEST_KEY).catch(() => null),
          new Promise((resolve) => setTimeout(resolve, SPLASH_MS)),
        ]);

        if (!isMounted) return;

        // First launch: walk through the app and pick a language before signing in.
        if (!onboarded) router.replace('/onboarding');
        else if (data?.session || guest === '1') router.replace('/(tabs)/home');
        else router.replace('/login');
      } catch {
        if (!isMounted) return;
        router.replace('/login');
      }
    }

    checkAuthAndNavigate();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <View style={styles.container}>
      <Blob color={C.brand} size={width * 0.9} top={-width * 0.25} left={-width * 0.35} delay={0} />
      <Blob color={C.leafLight} size={width * 0.8} top={height - width * 0.55} left={width * 0.4} delay={600} />

      <View style={styles.center}>
        <Animated.View entering={ZoomIn.springify().damping(10).stiffness(110)}>
          <AiMascot size={170} mood="happy" halo />
        </Animated.View>
        <Animated.View entering={FadeInUp.delay(450).springify().damping(16)}>
          <Image source={require('../Appname.png')} style={styles.appName} resizeMode="contain" />
        </Animated.View>
        <Animated.View entering={FadeIn.delay(800)} style={styles.track}>
          <Animated.View style={[styles.bar, barStyle]} />
        </Animated.View>
      </View>

      {/* Watermark: who made the app */}
      <Animated.View entering={FadeInDown.delay(1100).springify().damping(18)} style={styles.footer}>
        <Credits />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FBF1E4',
    overflow: 'hidden',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  appName: { height: 66, width: 330, marginTop: 12 },
  track: {
    width: 140,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(43,35,32,0.08)',
    marginTop: 26,
    overflow: 'hidden',
  },
  bar: { height: '100%', borderRadius: 2, backgroundColor: C.brand },
  footer: { paddingBottom: 36, paddingHorizontal: 24 },
});
