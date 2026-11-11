import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Card } from '../../../core/design-system/components';
import { Skeleton, StatusPill } from '../../../core/design-system/motion';
import { colors, spacing } from '../../../app/theme/tokens';
import type { RouteExplainability } from '../../../core/api/move';

export function ExplainableRoutePanel({
  modeLabelText,
  loading,
  answer,
  explainability,
  error,
  onClose,
  onOpenCopilot,
}: {
  modeLabelText: string;
  loading: boolean;
  answer?: string;
  explainability?: RouteExplainability;
  error?: string;
  onClose: () => void;
  onOpenCopilot: () => void;
}) {
  const impactColor = (impact: string) => {
    if (impact === 'positive') return colors.accentBright;
    if (impact === 'warning') return colors.statusWarning;
    return colors.routeCyan;
  };

  return (
    <Card variant="featured" style={{ gap: spacing.s }}>
      <View style={styles.between}>
        <StatusPill label={`EXPLAINABLE AI · ${modeLabelText.toUpperCase()}`} tone="info" />
        <TouchableOpacity onPress={onClose}>
          <Text style={{ color: colors.textMuted, fontSize: 13, fontWeight: '800' }}>✕</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ gap: 8 }}>
          <Skeleton height={14} width={220} />
          <Skeleton height={12} width={180} />
          <Skeleton height={12} width={200} />
        </View>
      ) : error ? (
        <Text style={{ color: colors.statusDanger, fontSize: 12.5 }}>{error}</Text>
      ) : (
        <>
          {answer ? <Text style={styles.answer}>{answer}</Text> : null}

          {explainability?.factors && explainability.factors.length > 0 && (
            <View style={{ gap: 6 }}>
              {explainability.factors.map((f, idx) => (
                <View key={`${f.label}-${idx}`} style={styles.factorRow}>
                  <View style={[styles.dot, { backgroundColor: impactColor(f.impact) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.factorTitle}>{f.label}</Text>
                    <Text style={styles.factorDetail}>{f.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {explainability?.confidence_note ? (
            <Text style={styles.note}>{explainability.confidence_note}</Text>
          ) : null}

          <TouchableOpacity onPress={onOpenCopilot} style={styles.copilotBtn}>
            <Text style={styles.copilotText}>Ask follow-up in AI Copilot →</Text>
          </TouchableOpacity>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  answer: { color: colors.textPrimary, fontSize: 13.5, lineHeight: 19, fontWeight: '600' },
  factorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  factorTitle: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '800' },
  factorDetail: { color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 17 },
  note: { color: colors.textMuted, fontSize: 11.5 },
  copilotBtn: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(29, 143, 225, 0.16)',
    borderWidth: 1,
    borderColor: colors.navBlue,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginTop: 2,
  },
  copilotText: { color: colors.routeCyan, fontSize: 12, fontWeight: '800' },
});
