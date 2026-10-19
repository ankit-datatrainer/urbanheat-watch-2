import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { F } from "./ui/theme";

interface InlineToken {
  type: 'text' | 'bold' | 'code' | 'italic';
  content: string;
}

function parseInlineTokens(raw: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Match **bold**, __bold__, `code`, or *italic*
  const regex = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: raw.slice(lastIndex, match.index) });
    }
    const tokenStr = match[0];
    if ((tokenStr.startsWith('**') && tokenStr.endsWith('**')) || (tokenStr.startsWith('__') && tokenStr.endsWith('__'))) {
      tokens.push({ type: 'bold', content: tokenStr.slice(2, -2) });
    } else if (tokenStr.startsWith('`')) {
      tokens.push({ type: 'code', content: tokenStr.slice(1, -1) });
    } else {
      tokens.push({ type: 'italic', content: tokenStr.slice(1, -1) });
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < raw.length) {
    tokens.push({ type: 'text', content: raw.slice(lastIndex) });
  }
  return tokens;
}

function renderInline(tokens: InlineToken[], keyPrefix: string) {
  return tokens.map((t, idx) => {
    const k = `${keyPrefix}-${idx}`;
    if (t.type === 'bold') return <Text key={k} style={styles.inlineBold}>{t.content}</Text>;
    if (t.type === 'code') return <Text key={k} style={styles.inlineCode}>{t.content}</Text>;
    if (t.type === 'italic') return <Text key={k} style={styles.inlineItalic}>{t.content}</Text>;
    return <Text key={k}>{t.content}</Text>;
  });
}

type Block =
  | { type: 'header'; level: number; tokens: InlineToken[] }
  | { type: 'section_title'; tokens: InlineToken[] }
  | { type: 'bullet'; depth: number; tokens: InlineToken[] }
  | { type: 'numbered'; number: string; tokens: InlineToken[] }
  | { type: 'quote'; tokens: InlineToken[] }
  | { type: 'rule' }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'codeblock'; code: string }
  | { type: 'paragraph'; tokens: InlineToken[] };

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

const isTableSeparator = (line: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());

function parseBlocks(content: string): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let inCode = false;
  let codeBuffer: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (inCode) {
        blocks.push({ type: 'codeblock', code: codeBuffer.join('\n') });
        codeBuffer = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (!trimmed) continue;

    // Table: a "|" row followed by a separator row.
    if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(trimmed);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      i--;
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: 'rule' });
      continue;
    }

    const headerMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      blocks.push({
        type: 'header',
        level: headerMatch[1].length,
        tokens: parseInlineTokens(headerMatch[2].replace(/\*\*/g, '')),
      });
      continue;
    }

    // A line that is entirely bold acts as a sub-heading, e.g. "**1. Overview**".
    const sectionMatch = trimmed.match(/^\*\*([^*]+)\*\*:?$/);
    if (sectionMatch) {
      blocks.push({ type: 'section_title', tokens: parseInlineTokens(sectionMatch[1]) });
      continue;
    }

    if (trimmed.startsWith('>')) {
      blocks.push({ type: 'quote', tokens: parseInlineTokens(trimmed.replace(/^>\s?/, '')) });
      continue;
    }

    const bulletMatch = line.match(/^(\s*)([•\-*+])\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({
        type: 'bullet',
        depth: Math.min(2, Math.floor(bulletMatch[1].replace(/\t/g, '  ').length / 2)),
        tokens: parseInlineTokens(bulletMatch[3]),
      });
      continue;
    }

    const numMatch = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
    if (numMatch) {
      blocks.push({ type: 'numbered', number: numMatch[1], tokens: parseInlineTokens(numMatch[2]) });
      continue;
    }

    blocks.push({ type: 'paragraph', tokens: parseInlineTokens(trimmed) });
  }

  // Render an unterminated code fence while a reply is still streaming.
  if (inCode && codeBuffer.length) blocks.push({ type: 'codeblock', code: codeBuffer.join('\n') });

  return blocks;
}

interface MarkdownMessageProps {
  content: string;
  isUser: boolean;
}

export default function MarkdownMessage({ content, isUser }: MarkdownMessageProps) {
  if (isUser) {
    return <Text style={styles.userText}>{content}</Text>;
  }

  const blocks = parseBlocks(content);

  return (
    <View style={styles.container}>
      {blocks.map((block, idx) => {
        const key = `block-${idx}`;
        const isFirst = idx === 0;

        switch (block.type) {
          case 'header':
            return (
              <Text
                key={key}
                style={[
                  styles.header,
                  block.level <= 2 ? styles.headerLarge : block.level === 3 ? styles.headerMedium : styles.headerSmall,
                  isFirst && styles.noTopMargin,
                ]}
                selectable
              >
                {renderInline(block.tokens, key)}
              </Text>
            );

          case 'section_title':
            return (
              <Text key={key} style={[styles.sectionTitle, isFirst && styles.noTopMargin]} selectable>
                {renderInline(block.tokens, key)}
              </Text>
            );

          case 'bullet':
            return (
              <View key={key} style={[styles.listRow, { paddingLeft: block.depth * 16 }]}>
                <View style={[styles.bulletDot, block.depth > 0 && styles.bulletDotNested]} />
                <Text style={styles.listText} selectable>
                  {renderInline(block.tokens, key)}
                </Text>
              </View>
            );

          case 'numbered':
            return (
              <View key={key} style={styles.listRow}>
                <Text style={styles.listNumber}>{block.number}.</Text>
                <Text style={styles.listText} selectable>
                  {renderInline(block.tokens, key)}
                </Text>
              </View>
            );

          case 'quote':
            return (
              <View key={key} style={styles.quote}>
                <Text style={styles.quoteText} selectable>
                  {renderInline(block.tokens, key)}
                </Text>
              </View>
            );

          case 'rule':
            return <View key={key} style={styles.rule} />;

          case 'table':
            return (
              <ScrollView key={key} horizontal showsHorizontalScrollIndicator={false} style={styles.tableScroll}>
                <View style={styles.table}>
                  <View style={[styles.tableRow, styles.tableHeaderRow]}>
                    {block.header.map((cell, c) => (
                      <Text key={c} style={[styles.tableCell, styles.tableHeaderCell]}>
                        {renderInline(parseInlineTokens(cell), `${key}-h${c}`)}
                      </Text>
                    ))}
                  </View>
                  {block.rows.map((row, r) => (
                    <View key={r} style={[styles.tableRow, r === block.rows.length - 1 && styles.tableRowLast]}>
                      {block.header.map((_, c) => (
                        <Text key={c} style={styles.tableCell} selectable>
                          {renderInline(parseInlineTokens(row[c] ?? ''), `${key}-${r}-${c}`)}
                        </Text>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );

          case 'codeblock':
            return (
              <View key={key} style={styles.codeBlock}>
                <Text style={styles.codeBlockText} selectable>
                  {block.code}
                </Text>
              </View>
            );

          default:
            return (
              <Text key={key} style={styles.paragraph} selectable>
                {renderInline(block.tokens, key)}
              </Text>
            );
        }
      })}
    </View>
  );
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' });

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 7,
  },
  userText: {
    color: '#FFFFFF',
    fontSize: 15, fontFamily: F.body,
    lineHeight: 22,
  },
  paragraph: {
    color: '#2E2520',
    fontSize: 15, fontFamily: F.body,
    lineHeight: 23,
  },
  noTopMargin: {
    marginTop: 0,
  },
  header: {
    color: '#1C1612',
    fontFamily: F.bodySemi,
    letterSpacing: -0.2,
  },
  headerLarge: {
    fontSize: 18, fontFamily: F.body,
    lineHeight: 25,
    marginTop: 10,
  },
  headerMedium: {
    fontSize: 16.5, fontFamily: F.body,
    lineHeight: 23,
    marginTop: 8,
  },
  headerSmall: {
    fontSize: 15, fontFamily: F.body,
    lineHeight: 22,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: F.bodySemi,
    color: '#1C1612',
    marginTop: 6,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingRight: 4,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F07B2E',
    marginTop: 9,
    marginLeft: 4,
  },
  bulletDotNested: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#F07B2E',
  },
  listNumber: {
    minWidth: 18,
    fontSize: 15,
    lineHeight: 23,
    fontFamily: F.bodySemi,
    color: '#D9621A',
  },
  listText: {
    flex: 1,
    color: '#2E2520',
    fontSize: 15, fontFamily: F.body,
    lineHeight: 23,
  },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: '#F3B98C',
    backgroundColor: '#FFF7EF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  quoteText: {
    color: '#5E5148',
    fontSize: 14.5, fontFamily: F.body,
    lineHeight: 22,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E2D6C8',
    marginVertical: 6,
  },
  tableScroll: {
    marginVertical: 4,
  },
  table: {
    borderWidth: 1,
    borderColor: '#EADFD1',
    borderRadius: 10,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F1E8DD',
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  tableHeaderRow: {
    backgroundColor: '#FBF4EB',
    borderBottomColor: '#EADFD1',
  },
  tableCell: {
    width: 140,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13.5, fontFamily: F.body,
    lineHeight: 19,
    color: '#2E2520',
  },
  tableHeaderCell: {
    fontFamily: F.bodySemi,
    color: '#1C1612',
  },
  inlineBold: {
    fontFamily: F.bodySemi,
    color: '#1C1612',
  },
  inlineItalic: {
    fontStyle: 'italic',
  },
  inlineCode: {
    fontFamily: MONO,
    backgroundColor: '#F5EEE6',
    fontSize: 13.5,
    color: '#9A3F0B',
  },
  codeBlock: {
    backgroundColor: '#211A16',
    padding: 12,
    borderRadius: 10,
    marginVertical: 2,
  },
  codeBlockText: {
    fontFamily: MONO,
    color: '#F6EFE8',
    fontSize: 13,
    lineHeight: 19,
  },
});
