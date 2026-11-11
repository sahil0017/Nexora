import React from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors, radii, spacing } from '../../app/theme/tokens';
import { SegmentedControl } from '../../core/design-system/components';
import {
  MapStyleMode,
  MapViewMode,
  SoundAlertMode,
  useNavPreferences,
} from '../../core/state/useNavPreferences';

/** Interactive Quick Settings drawer modeled after the HUD settings panel. */
export function QuickSettingsSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const nav = useNavigation<any>();
  const prefs = useNavPreferences();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title}>Quick settings</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close quick settings">
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Driving mode</Text>
          <SegmentedControl<MapViewMode>
            options={[
              { key: '3D', label: '3D Tilt' },
              { key: '2D', label: '2D Top' },
              { key: 'North', label: 'North up' },
            ]}
            value={prefs.viewMode}
            onChange={prefs.setViewMode}
          />

          <Text style={styles.label}>Sounds & Alerts</Text>
          <SegmentedControl<SoundAlertMode>
            compact
            options={[
              { key: 'all', label: '🔊 All on' },
              { key: 'alerts', label: '🔔 Alerts' },
              { key: 'muted', label: '🔇 Muted' },
            ]}
            value={prefs.soundMode}
            onChange={prefs.setSoundMode}
          />

          <Text style={styles.label}>Map</Text>
          <View style={styles.cardGrid}>
            {([
              { key: 'default', label: 'Default', sub: 'Dark vector' },
              { key: 'satellite', label: 'Satellite', sub: 'Terrain grid' },
            ] as Array<{ key: MapStyleMode; label: string; sub: string }>).map(item => {
              const active = prefs.mapStyle === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  onPress={() => prefs.setMapStyle(item.key)}
                  activeOpacity={0.85}
                  style={[styles.visualCard, active && styles.visualCardActive]}>
                  <View
                    style={[
                      styles.miniPreview,
                      item.key === 'satellite' ? styles.previewSatellite : styles.previewDefault,
                    ]}>
                    <View style={styles.miniRoute} />
                  </View>
                  <Text style={styles.tileTitle}>{item.label}</Text>
                  <Text style={styles.tileSub}>{item.sub}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Overlays</Text>
          <View style={styles.cardGrid}>
            <TouchableOpacity
              onPress={prefs.toggleIncidents}
              activeOpacity={0.85}
              style={[styles.overlayTile, prefs.showIncidents && styles.visualCardActive]}>
              <Text style={styles.overlayIcon}>⚠️</Text>
              <Text style={styles.tileTitle}>Incidents</Text>
              <Text style={styles.tileSub}>{prefs.showIncidents ? 'Visible' : 'Hidden'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={prefs.toggleTraffic}
              activeOpacity={0.85}
              style={[styles.overlayTile, prefs.showTraffic && styles.visualCardActive]}>
              <Text style={styles.overlayIcon}>🚦</Text>
              <Text style={styles.tileTitle}>Traffic flow</Text>
              <Text style={styles.tileSub}>{prefs.showTraffic ? 'Live' : 'Hidden'}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.switchList}>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>3D buildings</Text>
                <Text style={styles.tileSub}>Display extruded blocks on map HUD</Text>
              </View>
              <Switch
                value={prefs.show3DBuildings}
                onValueChange={prefs.toggle3DBuildings}
                trackColor={{ false: colors.bgElevated, true: colors.navBlue }}
              />
            </View>
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>Weather & Demand</Text>
                <Text style={styles.tileSub}>Show zone demand & weather telemetry</Text>
              </View>
              <Switch
                value={prefs.showWeather}
                onValueChange={prefs.toggleWeather}
                trackColor={{ false: colors.bgElevated, true: colors.navBlue }}
              />
            </View>
          </View>

          <TouchableOpacity
            onPress={() => {
              onClose();
              nav.navigate('Profile');
            }}
            style={styles.fullSettingsBtn}>
            <Text style={styles.fullSettingsText}>⚙ Full navigation & Move preferences →</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 12, 0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0E1722',
    borderTopLeftRadius: radii.panel,
    borderTopRightRadius: radii.panel,
    padding: spacing.m,
    paddingBottom: spacing.xl,
    borderTopWidth: 1,
    borderColor: colors.glassBorder,
    gap: spacing.s + 2,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
    alignSelf: 'center',
    marginBottom: 4,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: 0.4,
  },
  cardGrid: { flexDirection: 'row', gap: spacing.s },
  visualCard: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
  },
  visualCardActive: {
    borderColor: colors.navBlue,
    backgroundColor: 'rgba(29, 143, 225, 0.14)',
  },
  miniPreview: {
    height: 42,
    borderRadius: 10,
    marginBottom: 8,
    overflow: 'hidden',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  previewDefault: { backgroundColor: '#08111B', borderWidth: 1, borderColor: '#1B3148' },
  previewSatellite: { backgroundColor: '#10211D', borderWidth: 1, borderColor: '#1F4238' },
  miniRoute: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.routeCyan,
    transform: [{ rotate: '-14deg' }],
  },
  overlayTile: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1.5,
    borderColor: colors.borderSubtle,
    alignItems: 'flex-start',
  },
  overlayIcon: { fontSize: 18, marginBottom: 4 },
  tileTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  tileSub: { color: colors.textSecondary, fontSize: 11.5, marginTop: 2 },
  switchList: {
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  switchTitle: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '600' },
  fullSettingsBtn: {
    backgroundColor: colors.bgElevated,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginTop: 4,
  },
  fullSettingsText: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
});
