import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  AIError,
  ASSISTANT_NAME,
  type AIStatus,
  ChatMessage,
  checkAIStatus,
  formatModelName,
  streamChatCompletion,
} from '../lib/aiChat';
import { clearChatHistory, loadChatHistory, saveChatMessage } from '../lib/chatHistory';
import MarkdownMessage from '../components/MarkdownMessage';
import { useAuth } from '../context/auth';
import { useCity } from '../components/CityContext';
import AiMascot, { AiAvatar } from '../components/ai/AiMascot';
import LanguageButton from '../components/LanguagePicker';
import PressableScale from '../components/ui/PressableScale';
import { useI18n, type TFunction } from '../lib/i18n';
import { C, F, R, shadow } from '../components/ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;
type Suggestion = { icon: IconName; title: string; prompt: string };

function buildSuggestions(cityName: string, country: string, t: TFunction): Suggestion[] {
  return [
    {
      icon: 'thermometer-outline',
      title: t('WBGT vs. air temperature'),
      prompt:
        'Explain the difference between WBGT and normal air temperature, and the risk thresholds for outdoor activity.',
    },
    {
      icon: 'business-outline',
      title: t('Heat risk in {city}', { city: t(cityName) }),
      prompt: `Analyse the heat stress risks and urban microclimate in ${cityName}, ${country}. What should residents watch out for?`,
    },
    {
      icon: 'water-outline',
      title: t('Hydration plan'),
      prompt: 'Give me a practical hydration plan for a student doing 2 hours of outdoor sport in hot, humid weather.',
    },
    {
      icon: 'leaf-outline',
      title: t('Cooling our city'),
      prompt: 'What are the most effective strategies to reduce urban heat in Southeast Asian cities?',
    },
  ];
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(ts: number, locale: string) {
  return new Date(ts).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function Dot({ p, i }: { p: SharedValue<number>; i: number }) {
  const style = useAnimatedStyle(() => {
    const phase = (p.value + 1 - i * 0.2) % 1;
    const up = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
    return { opacity: 0.35 + up * 0.65, transform: [{ translateY: -3 * up }] };
  });
  return <Animated.View style={[styles.dotItem, style]} />;
}

function ThinkingDots() {
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1, false));
  }, [p]);
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} p={p} i={i} />
      ))}
    </View>
  );
}

function ShimmerText({ children }: { children: string }) {
  const o = useSharedValue(0.5);
  useEffect(() => {
    o.set(
      withRepeat(
        withSequence(withTiming(1, { duration: 700 }), withDelay(100, withTiming(0.5, { duration: 700 }))),
        -1,
        false,
      ),
    );
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.Text style={[styles.thinkingText, style]}>{children}</Animated.Text>;
}

export default function AIScreen() {
  const params = useLocalSearchParams<{ query?: string }>();
  const { user, isGuest } = useAuth();
  const { city } = useCity();
  const { t, lang, locale } = useI18n();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [inputHeight, setInputHeight] = useState(22);
  const [focused, setFocused] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(!!user);
  const [pending, setPending] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; retryText: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const handledParam = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const userId = user?.id;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const busy = pending || streamingId !== null;
  const [aiStatus, setAiStatus] = useState<AIStatus | 'checking'>('checking');
  // Only a confirmed "not configured" disables input; when offline the user can still retry.
  const configured = aiStatus !== 'not_configured';
  const suggestions = buildSuggestions(city.name, city.country, t);

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated }));
  }, []);

  useEffect(() => {
    let active = true;
    if (!userId) return;
    loadChatHistory()
      .then((history) => {
        if (active && history.length) setMessages(history);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    let active = true;
    checkAIStatus().then((status) => {
      if (active) setAiStatus(status);
    });
    return () => {
      active = false;
    };
  }, []);

  const send = useCallback(
    async (text: string, opts: { reuseLastUser?: boolean } = {}) => {
      const query = text.trim();
      if (!query || pending || streamingId) return;

      setError(null);
      setInput('');
      setInputHeight(22);

      let history = messagesRef.current;
      if (!opts.reuseLastUser) {
        const userMessage: ChatMessage = { id: makeId(), role: 'user', content: query, timestamp: Date.now() };
        history = [...history, userMessage];
        messagesRef.current = history;
        setMessages(history);
        if (user) saveChatMessage(user.id, userMessage);
      }

      setPending(true);
      scrollToEnd();

      const controller = new AbortController();
      abortRef.current = controller;
      const assistantId = makeId();
      let started = false;

      try {
        const result = await streamChatCompletion({
          messages: history.slice(-20).map((m) => ({ role: m.role, content: m.content })),
          language: lang,
          signal: controller.signal,
          onDelta: (accumulated, model) => {
            if (!started) {
              started = true;
              setPending(false);
              setStreamingId(assistantId);
              setMessages((prev) => [
                ...prev,
                { id: assistantId, role: 'assistant', content: accumulated, timestamp: Date.now(), model },
              ]);
            } else {
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated, model: model ?? m.model } : m)),
              );
            }
          },
        });

        const finalMessage: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content: result.content,
          timestamp: Date.now(),
          model: result.model,
        };
        setMessages((prev) =>
          started ? prev.map((m) => (m.id === assistantId ? finalMessage : m)) : [...prev, finalMessage],
        );
        if (user) saveChatMessage(user.id, finalMessage);
        setAiStatus('ready');
      } catch (err) {
        const aiErr = err instanceof AIError ? err : new AIError('unknown', 'Something went wrong. Please try again.');
        if (aiErr.kind === 'network') setAiStatus('offline');
        if (aiErr.kind === 'not_configured') setAiStatus('not_configured');
        if (aiErr.kind === 'aborted') {
          // Keep whatever was streamed before the user pressed stop.
          const partial = messagesRef.current.find((m) => m.id === assistantId);
          if (partial && user) saveChatMessage(user.id, partial);
        } else {
          if (started) setMessages((prev) => prev.filter((m) => m.id !== assistantId));
          setError({ message: aiErr.message, retryText: query });
        }
      } finally {
        abortRef.current = null;
        setPending(false);
        setStreamingId(null);
        scrollToEnd();
      }
    },
    [pending, streamingId, user, scrollToEnd, lang],
  );

  useEffect(() => {
    if (params.query && !handledParam.current && !historyLoading) {
      handledParam.current = true;
      send(String(params.query));
    }
  }, [params.query, historyLoading, send]);

  function handleRegenerate() {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const lastIndex = messages.length - 1;
    if (messages[lastIndex]?.role === 'assistant') {
      setMessages(messages.slice(0, lastIndex));
      messagesRef.current = messages.slice(0, lastIndex);
    }
    send(lastUser.content, { reuseLastUser: true });
  }

  async function handleCopy(message: ChatMessage) {
    await Clipboard.setStringAsync(message.content).catch(() => {});
    setCopiedId(message.id);
    setTimeout(() => setCopiedId((id) => (id === message.id ? null : id)), 1600);
  }

  function handleNewChat() {
    abortRef.current?.abort();
    setMessages([]);
    setError(null);
    setInput('');
    if (user) clearChatHistory(user.id);
  }

  function handleBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/home');
  }

  function handleKeyPress(e: any) {
    if (Platform.OS !== 'web') return;
    if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
      e.preventDefault?.();
      send(input);
    }
  }

  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const showEmpty = !historyLoading && messages.length === 0 && !pending && !error;
  const canSend = input.trim().length > 0 && !busy && configured;
  const statusText = busy
    ? t('Thinking…')
    : aiStatus === 'checking'
      ? t('Connecting…')
      : aiStatus === 'offline'
        ? t('Server offline')
        : aiStatus === 'not_configured'
          ? t('Not configured')
          : t('Online · powered by OpenRouter');

  // The AI assistant is for registered users only.
  if (isGuest && !user) return <Redirect href="/home" />;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.header}>
          <PressableScale onPress={handleBack} style={styles.iconButton} accessibilityLabel={t('Go back')}>
            <Ionicons name="chevron-back" size={20} color={C.ink} />
          </PressableScale>

          <View style={styles.headerCenter}>
            <AiAvatar size={40} mood={busy ? 'thinking' : 'idle'} />
            <View style={styles.flexShrink}>
              <Text style={styles.headerTitle} numberOfLines={1}>
                {ASSISTANT_NAME}
              </Text>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: aiStatus === 'ready' ? C.low : aiStatus === 'checking' ? C.moderate : C.high },
                  ]}
                />
                <Text style={styles.statusText} numberOfLines={1}>
                  {statusText}
                </Text>
              </View>
            </View>
          </View>

          <LanguageButton />
          <PressableScale
            onPress={handleNewChat}
            disabled={messages.length === 0 && !error}
            style={[styles.iconButton, messages.length === 0 && !error && styles.iconButtonDisabled]}
            accessibilityLabel={t('Start a new chat')}
          >
            <Ionicons name="create-outline" size={19} color={C.ink} />
          </PressableScale>
        </Animated.View>

        {/* Conversation */}
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.chatContent, showEmpty && styles.chatContentEmpty]}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => {
            if (busy) scrollToEnd(false);
          }}
        >
          {historyLoading && (
            <View style={styles.centerFill}>
              <ActivityIndicator color={C.brand} />
              <Text style={styles.mutedText}>{t('Loading your conversation')}</Text>
            </View>
          )}

          {showEmpty && (
            <View style={styles.empty}>
              <Animated.View entering={FadeInUp.springify().damping(12)}>
                <AiMascot size={130} halo mood={aiStatus === 'ready' ? 'happy' : 'idle'} />
              </Animated.View>
              <Animated.Text entering={FadeInDown.delay(120)} style={styles.emptyTitle}>
                {t('How can I help you today?')}
              </Animated.Text>
              <Animated.Text entering={FadeInDown.delay(180)} style={styles.emptySubtitle}>
                {t('Ask about heat stress, weather and climate. Answers are tailored for {city}.', {
                  city: t(city.name),
                })}
              </Animated.Text>

              {(aiStatus === 'not_configured' || aiStatus === 'offline') && (
                <View style={[styles.errorCard, styles.emptyNotice]}>
                  <Ionicons
                    name={aiStatus === 'offline' ? 'cloud-offline-outline' : 'key-outline'}
                    size={18}
                    color={C.high}
                  />
                  <Text style={styles.errorText}>
                    {aiStatus === 'offline'
                      ? t('Cannot reach the UrbanHeat Watch server. Make sure it is running, then try again.')
                      : t('The AI assistant is not set up on the UrbanHeat Watch server yet.')}
                  </Text>
                </View>
              )}

              <View style={styles.suggestionGrid}>
                {suggestions.map((s, i) => (
                  <Animated.View
                    key={s.prompt}
                    entering={FadeInDown.delay(240 + i * 70)
                      .springify()
                      .damping(16)}
                    style={styles.suggestionCell}
                  >
                    <PressableScale
                      onPress={() => send(s.prompt)}
                      disabled={!configured}
                      scaleTo={0.97}
                      style={styles.suggestion}
                    >
                      <View style={styles.suggestionIcon}>
                        <Ionicons name={s.icon} size={18} color={C.brandDeep} />
                      </View>
                      <Text style={styles.suggestionTitle}>{s.title}</Text>
                    </PressableScale>
                  </Animated.View>
                ))}
              </View>
            </View>
          )}

          {messages.map((m) => {
            if (m.role === 'user') {
              return (
                <Animated.View key={m.id} entering={FadeInDown.springify().damping(18)} style={styles.userRow}>
                  <LinearGradient
                    colors={[C.brand, C.brandDeep]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.userBubble}
                  >
                    <Text style={styles.userText} selectable>
                      {m.content}
                    </Text>
                  </LinearGradient>
                  <Text style={styles.time}>{formatTime(m.timestamp, locale)}</Text>
                </Animated.View>
              );
            }

            const isStreaming = m.id === streamingId;
            return (
              <Animated.View key={m.id} entering={FadeIn.duration(250)} style={styles.assistantRow}>
                <AiAvatar size={30} mood={isStreaming ? 'thinking' : 'idle'} />
                <View style={styles.assistantBody}>
                  <View style={styles.assistantBubble}>
                    <MarkdownMessage content={m.content} isUser={false} />
                  </View>
                  {!isStreaming && (
                    <View style={styles.actionRow}>
                      <Pressable
                        onPress={() => handleCopy(m)}
                        hitSlop={6}
                        style={styles.action}
                        accessibilityLabel={t('Copy')}
                      >
                        <Ionicons
                          name={copiedId === m.id ? 'checkmark' : 'copy-outline'}
                          size={14}
                          color={C.inkMuted}
                        />
                        <Text style={styles.actionLabel}>{copiedId === m.id ? t('Copied') : t('Copy')}</Text>
                      </Pressable>
                      {m.id === lastAssistantId && !busy && (
                        <Pressable
                          onPress={handleRegenerate}
                          hitSlop={6}
                          style={styles.action}
                          accessibilityLabel={t('Regenerate')}
                        >
                          <Ionicons name="refresh" size={14} color={C.inkMuted} />
                          <Text style={styles.actionLabel}>{t('Regenerate')}</Text>
                        </Pressable>
                      )}
                      <Text style={styles.time}>
                        {formatTime(m.timestamp, locale)}
                        {m.model ? ` · ${formatModelName(m.model)}` : ''}
                      </Text>
                    </View>
                  )}
                </View>
              </Animated.View>
            );
          })}

          {pending && (
            <Animated.View entering={FadeIn} style={styles.assistantRow}>
              <AiAvatar size={30} mood="thinking" />
              <View style={[styles.assistantBubble, styles.thinkingBubble]}>
                <ThinkingDots />
                <ShimmerText>{t('Researching your question…')}</ShimmerText>
              </View>
            </Animated.View>
          )}

          {error && (
            <Animated.View entering={FadeInDown} style={styles.errorCard}>
              <Ionicons name="alert-circle" size={18} color={C.high} />
              <View style={styles.flex}>
                <Text style={styles.errorTitle}>{t('Response failed')}</Text>
                <Text style={styles.errorText}>{t(error.message)}</Text>
                <PressableScale
                  onPress={() => send(error.retryText, { reuseLastUser: true })}
                  style={styles.retryButton}
                >
                  <Ionicons name="refresh" size={14} color="#FFFFFF" />
                  <Text style={styles.retryText}>{t('Try again')}</Text>
                </PressableScale>
              </View>
            </Animated.View>
          )}
        </ScrollView>

        {/* Composer */}
        <View style={styles.composerWrap}>
          <View style={[styles.composer, focused && styles.composerFocused, !configured && styles.composerDisabled]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={configured ? t('Ask about heat, hydration, safety…') : t('AI is not configured')}
              placeholderTextColor={C.inkMuted}
              editable={configured}
              multiline
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyPress={handleKeyPress}
              onContentSizeChange={(e) => setInputHeight(Math.min(120, Math.max(22, e.nativeEvent.contentSize.height)))}
              style={[
                styles.input,
                // A long placeholder (e.g. in Hindi) must not show a scrollbar; typed text can scroll.
                Platform.OS === 'web' && ({ height: inputHeight, overflow: input ? 'auto' : 'hidden' } as object),
              ]}
            />
            {busy ? (
              <PressableScale
                onPress={() => abortRef.current?.abort()}
                style={[styles.sendButton, styles.stopButton]}
                accessibilityLabel={t('Stop generating')}
              >
                <Ionicons name="stop" size={14} color="#FFFFFF" />
              </PressableScale>
            ) : (
              <PressableScale
                onPress={() => send(input)}
                disabled={!canSend}
                style={styles.sendShell}
                accessibilityLabel={t('Send message')}
              >
                <LinearGradient
                  colors={canSend ? [C.brand, C.brandDeep] : ['#E8DED3', '#E8DED3']}
                  style={styles.sendButton}
                >
                  <Ionicons name="arrow-up" size={19} color="#FFFFFF" />
                </LinearGradient>
              </PressableScale>
            )}
          </View>
          <Text style={styles.disclaimer}>
            {t('AI can make mistakes. In a heat emergency, call your local emergency number.')}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const webInput = Platform.OS === 'web' ? ({ outlineStyle: 'none', resize: 'none' } as object) : null;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.borderStrong,
    backgroundColor: C.bg,
  },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 16, fontFamily: F.display, color: C.ink, letterSpacing: -0.2 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 11.5, fontFamily: F.body, color: C.inkMuted, flexShrink: 1 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  iconButtonDisabled: { opacity: 0.4 },

  chatContent: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 16,
    gap: 16,
  },
  chatContentEmpty: { flexGrow: 1, justifyContent: 'center' },
  centerFill: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  mutedText: { fontSize: 13, fontFamily: F.body, color: C.inkMuted },

  empty: { alignItems: 'center', paddingVertical: 8 },
  emptyTitle: {
    fontSize: 25,
    fontFamily: F.display,
    color: C.ink,
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: 6,
  },
  emptySubtitle: {
    fontSize: 14.5,
    fontFamily: F.body,
    color: C.inkSoft,
    textAlign: 'center',
    lineHeight: 21,
    marginTop: 8,
    maxWidth: 330,
  },
  emptyNotice: { marginTop: 18, alignSelf: 'stretch' },
  suggestionGrid: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 24 },
  suggestionCell: { width: '47%', flexGrow: 1 },
  suggestion: {
    minHeight: 92,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.lg,
    padding: 14,
    gap: 10,
    ...shadow(1),
  },
  suggestionIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: C.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionTitle: { fontSize: 13.5, fontFamily: F.bodyMedium, color: C.ink, lineHeight: 18 },

  userRow: { alignItems: 'flex-end', gap: 4, paddingLeft: 48 },
  userBubble: {
    borderRadius: 22,
    borderBottomRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 11,
    ...shadow(1),
  },
  userText: { color: '#FFFFFF', fontSize: 15, fontFamily: F.body, lineHeight: 22 },
  time: { fontSize: 11, fontFamily: F.body, color: C.inkMuted, marginHorizontal: 4 },

  assistantRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingRight: 8 },
  assistantBody: { flex: 1, gap: 6 },
  assistantBubble: {
    backgroundColor: C.surface,
    borderRadius: 22,
    borderTopLeftRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 15,
    paddingVertical: 12,
    ...shadow(1),
  },
  thinkingBubble: { flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'flex-start' },
  thinkingText: { fontSize: 13.5, fontFamily: F.bodyMedium, color: C.inkSoft },
  dots: { flexDirection: 'row', gap: 4, alignItems: 'center', height: 14 },
  dotItem: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.brand },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingLeft: 4, flexWrap: 'wrap' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionLabel: { fontSize: 12, fontFamily: F.bodyMedium, color: C.inkMuted },

  errorCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FEF3F2',
    borderWidth: 1,
    borderColor: '#FECDCA',
    borderRadius: R.md,
    padding: 14,
  },
  errorTitle: { fontSize: 14, fontFamily: F.bodySemi, color: C.high, marginBottom: 2 },
  errorText: { flex: 1, fontSize: 13.5, fontFamily: F.body, color: '#7A271A', lineHeight: 19 },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: C.high,
    borderRadius: R.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginTop: 10,
  },
  retryText: { color: '#FFFFFF', fontSize: 13, fontFamily: F.bodySemi },

  composerWrap: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 26,
    paddingLeft: 18,
    paddingRight: 6,
    paddingVertical: 6,
    ...shadow(2),
  },
  composerFocused: { borderColor: C.brand },
  composerDisabled: { opacity: 0.6 },
  input: {
    flex: 1,
    minHeight: 22,
    maxHeight: 120,
    fontSize: 15,
    fontFamily: F.body,
    lineHeight: 22,
    color: C.ink,
    paddingTop: 9,
    paddingBottom: 9,
    ...webInput,
  },
  sendShell: { borderRadius: 21 },
  sendButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  stopButton: { backgroundColor: C.ink },
  disclaimer: { fontSize: 11, fontFamily: F.body, color: C.inkMuted, textAlign: 'center', marginTop: 7 },
});
