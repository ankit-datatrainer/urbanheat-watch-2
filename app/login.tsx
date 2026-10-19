import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import Animated, { FadeInDown } from 'react-native-reanimated';
import AiMascot from '../components/ai/AiMascot';
import PressableScale from '../components/ui/PressableScale';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/auth';
import { useT, type TFunction } from '../lib/i18n';
import LanguageButton from '../components/LanguagePicker';
import { F } from '../components/ui/theme';

type Mode = 'signIn' | 'signUp';
type Notice = { tone: 'error' | 'success' | 'info'; text: string } | null;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function friendlyAuthError(message: string, t: TFunction): Notice {
  const lower = message.toLowerCase();
  if (lower.includes('invalid login credentials')) {
    return { tone: 'error', text: t('Incorrect email or password. Please try again.') };
  }
  // Older unconfirmed accounts are confirmed automatically on sign-in; this only shows if that failed.
  if (lower.includes('email not confirmed')) {
    return { tone: 'error', text: t('We could not sign you in right now. Please try again in a moment.') };
  }
  if (lower.includes('already registered') || lower.includes('already exists')) {
    return { tone: 'error', text: t('An account with this email already exists. Sign in instead.') };
  }
  // Supabase's built-in mailer allows only a few sign-up emails per hour. It is only used while
  // "Confirm email" is switched on in the Supabase project; with it off, sign-up sends no email.
  if (lower.includes('email rate limit')) {
    return { tone: 'error', text: t('Too many new accounts were created in the last hour. Please try again later.') };
  }
  if (lower.includes('rate limit')) {
    return { tone: 'error', text: t('Too many attempts. Please wait a few minutes and try again.') };
  }
  if (lower.includes('password')) {
    return { tone: 'error', text: message };
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return { tone: 'error', text: t('Could not reach the server. Check your internet connection.') };
  }
  return { tone: 'error', text: message };
}

function Field({
  icon,
  label,
  trailing,
  ...inputProps
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  trailing?: ReactNode;
} & ComponentProps<typeof TextInput>) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.fieldShell, focused && styles.fieldShellFocused]}>
        <Ionicons name={icon} size={18} color={focused ? '#F07B2E' : '#9C8E80'} />
        <TextInput
          placeholderTextColor="#A89B8D"
          style={styles.fieldInput}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...inputProps}
        />
        {trailing}
      </View>
    </View>
  );
}

export default function LoginScreen() {
  const { signIn, signUp, continueAsGuest } = useAuth();
  const t = useT();
  // An invite link sends people here first, then back to the invite once they're signed in.
  // "mode=signUp" opens the Create account form (used by the guest "register" button).
  const { next, mode: startMode } = useLocalSearchParams<{ next?: string; mode?: string }>();
  const goNext = () => router.replace((next ? String(next) : '/(tabs)/home') as Href);
  const [mode, setMode] = useState<Mode>(startMode === 'signUp' ? 'signUp' : 'signIn');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const isSignUp = mode === 'signUp';

  function switchMode(next: Mode) {
    setMode(next);
    setNotice(null);
    setConfirmPassword('');
  }

  function validate(): string | null {
    const trimmedEmail = email.trim();
    if (isSignUp && !fullName.trim()) return t('Please enter your full name.');
    if (!trimmedEmail) return t('Please enter your email address.');
    if (!EMAIL_PATTERN.test(trimmedEmail)) return t('Please enter a valid email address.');
    if (!password) return t('Please enter your password.');
    if (isSignUp && password.length < 6) return t('Password must be at least 6 characters.');
    if (isSignUp && password !== confirmPassword) return t('Passwords do not match.');
    return null;
  }

  async function handleSubmit() {
    const validationError = validate();
    if (validationError) {
      setNotice({ tone: 'error', text: validationError });
      return;
    }

    setLoading(true);
    setNotice(null);

    try {
      if (isSignUp) {
        const { data, error } = await signUp(email.trim(), password, fullName);
        if (error) {
          setNotice(friendlyAuthError(error.message, t));
          return;
        }
        // Supabase returns a user with no identities when the email is already registered.
        if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setNotice({ tone: 'error', text: t('An account with this email already exists. Sign in instead.') });
          return;
        }
        // New accounts go straight into the app: no verification email, no second sign-in.
        if (data?.session) {
          goNext();
          return;
        }
        const { error: signInError } = await signIn(email.trim(), password);
        if (!signInError) {
          goNext();
          return;
        }
        // Only reachable while "Confirm email" is still switched on in the Supabase project.
        setNotice({
          tone: 'info',
          text: t("Account created, but the server still asks for email confirmation, so you can't sign in yet."),
        });
      } else {
        const { error } = await signIn(email.trim(), password);
        if (error) {
          setNotice(friendlyAuthError(error.message, t));
          return;
        }
        goNext();
      }
    } catch (err: any) {
      setNotice(friendlyAuthError(err?.message || t('Something went wrong. Please try again.'), t));
    } finally {
      setLoading(false);
    }
  }

  async function handleGuest() {
    await continueAsGuest();
    router.replace('/(tabs)/home');
  }

  const noticeIcon =
    notice?.tone === 'success' ? 'checkmark-circle' : notice?.tone === 'info' ? 'mail-unread' : 'alert-circle';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View entering={FadeInDown.springify().damping(16)} style={styles.brandRow}>
            <AiMascot size={74} mood="happy" />
            <Text style={styles.title}>{t('Welcome to UrbanHeat Watch')}</Text>
            <LanguageButton />
          </Animated.View>

          <Image source={require('../border2.png')} style={styles.border} resizeMode="contain" />

          <Animated.View entering={FadeInDown.delay(120).springify().damping(18)}>
            <Text style={styles.heading}>{isSignUp ? t('Create your account') : t('Sign in')}</Text>
            <Text style={styles.subheading}>
              {isSignUp
                ? t('Register to get heat alerts, family check-ins and your AI history on every device.')
                : t('Use the email and password you registered with.')}
            </Text>

            <View style={styles.segment}>
              {(['signIn', 'signUp'] as Mode[]).map((m) => {
                const active = mode === m;
                return (
                  <Pressable
                    key={m}
                    onPress={() => switchMode(m)}
                    style={[styles.segmentItem, active && styles.segmentItemActive]}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {m === 'signIn' ? t('Sign in') : t('Create account')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {notice && (
              <View
                style={[
                  styles.notice,
                  notice.tone === 'error' && styles.noticeError,
                  notice.tone === 'success' && styles.noticeSuccess,
                  notice.tone === 'info' && styles.noticeInfo,
                ]}
              >
                <Ionicons
                  name={noticeIcon}
                  size={18}
                  color={notice.tone === 'error' ? '#B42318' : notice.tone === 'success' ? '#067647' : '#8A4B12'}
                />
                <View style={styles.flex}>
                  <Text style={styles.noticeText}>{notice.text}</Text>
                </View>
              </View>
            )}

            {isSignUp && (
              <Field
                icon="person-outline"
                label={t('Full name')}
                placeholder={t('Your name')}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
              />
            )}

            <Field
              icon="mail-outline"
              label={t('Email')}
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
            />

            <Field
              icon="lock-closed-outline"
              label={t('Password')}
              placeholder={isSignUp ? t('At least 6 characters') : t('Enter your password')}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              onSubmitEditing={isSignUp ? undefined : handleSubmit}
              trailing={
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  hitSlop={8}
                  accessibilityLabel={showPassword ? t('Hide password') : t('Show password')}
                >
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={19} color="#9C8E80" />
                </Pressable>
              }
            />

            {isSignUp && (
              <Field
                icon="shield-checkmark-outline"
                label={t('Confirm password')}
                placeholder={t('Re-enter your password')}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                onSubmitEditing={handleSubmit}
              />
            )}

            <PressableScale
              onPress={handleSubmit}
              disabled={loading}
              style={[styles.primaryButton, loading && styles.buttonDisabled]}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>{isSignUp ? t('Create account') : t('Sign in')}</Text>
              )}
            </PressableScale>

            <Pressable onPress={() => switchMode(isSignUp ? 'signIn' : 'signUp')} style={styles.switchButton}>
              <Text style={styles.switchText}>
                {isSignUp ? t('Already have an account?') : t("Don't have an account?")}{' '}
                <Text style={styles.switchTextStrong}>{isSignUp ? t('Sign in') : t('Create one')}</Text>
              </Text>
            </Pressable>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('or')}</Text>
              <View style={styles.dividerLine} />
            </View>

            <PressableScale onPress={handleGuest} style={styles.guestButton} accessibilityRole="button">
              <Ionicons name="eye-outline" size={19} color="#4B3F35" />
              <Text style={styles.guestButtonText}>{t('Continue as guest')}</Text>
            </PressableScale>
            <Text style={styles.guestHint}>
              {t(
                'Guests can view the satellite heat map. Register to unlock alerts, family safety and the AI assistant.',
              )}
            </Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FBF1E4',
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 16,
  },
  title: {
    flexShrink: 1,
    fontSize: 23,
    fontFamily: F.display,
    color: '#2B2320',
  },
  border: {
    alignSelf: 'center',
    width: '90%',
    aspectRatio: 345 / 24,
    marginTop: 16,
  },
  heading: {
    fontSize: 26,
    fontFamily: F.display,
    color: '#2B2320',
    marginTop: 24,
    letterSpacing: -0.3,
  },
  subheading: {
    fontSize: 14,
    fontFamily: F.body,
    color: '#706053',
    marginTop: 6,
    lineHeight: 20,
  },
  segment: {
    flexDirection: 'row',
    backgroundColor: '#EFE2D2',
    borderRadius: 12,
    padding: 4,
    marginTop: 20,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: 'center',
  },
  segmentItemActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#2B2320',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 14,
    fontFamily: F.bodySemi,
    color: '#8A7A6C',
  },
  segmentTextActive: {
    color: '#2B2320',
  },
  notice: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 16,
  },
  noticeError: {
    backgroundColor: '#FEF3F2',
    borderColor: '#FECDCA',
  },
  noticeSuccess: {
    backgroundColor: '#ECFDF3',
    borderColor: '#ABEFC6',
  },
  noticeInfo: {
    backgroundColor: '#FFF6EA',
    borderColor: '#F6D3A8',
  },
  noticeText: {
    fontSize: 13.5,
    fontFamily: F.body,
    color: '#2B2320',
    lineHeight: 19,
  },
  fieldBlock: {
    marginTop: 16,
  },
  fieldLabel: {
    fontSize: 13.5,
    fontFamily: F.bodySemi,
    color: '#2B2320',
    marginBottom: 6,
  },
  fieldShell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    borderWidth: 1.5,
    borderColor: '#E2D4C3',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
  },
  fieldShellFocused: {
    borderColor: '#F07B2E',
  },
  fieldInput: {
    flex: 1,
    height: '100%',
    fontSize: 15,
    color: '#2B2320',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  primaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#F07B2E',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    shadowColor: '#F07B2E',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: F.bodySemi,
  },
  pressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  switchButton: {
    alignSelf: 'center',
    marginTop: 16,
    paddingVertical: 6,
  },
  switchText: {
    color: '#706053',
    fontSize: 14,
    fontFamily: F.body,
  },
  switchTextStrong: {
    color: '#C25E17',
    fontFamily: F.bodySemi,
  },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#E2D4C3' },
  dividerText: { color: '#958778', fontSize: 13, fontFamily: F.body },
  guestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#DCCAB4',
    backgroundColor: '#FFFFFF',
    marginTop: 18,
  },
  guestButtonText: { color: '#4B3F35', fontSize: 15, fontFamily: F.bodySemi },
  guestHint: {
    color: '#958778',
    fontSize: 12.5,
    fontFamily: F.body,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 18,
  },
});
