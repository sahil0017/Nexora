import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen } from '../../../shared/components/Screen';
import { NavMapCanvas } from '../../../shared/components/NavMapCanvas';
import {
  Card,
  EmptyState,
  Input,
  PrimaryButton,
  SectionHeading,
} from '../../../core/design-system/components';
import { Chip, FadeIn, Skeleton, Tappable } from '../../../core/design-system/motion';
import { colors, fontFamily, spacing } from '../../../app/theme/tokens';
import { moveApi } from '../../../core/api/move';
import { useMe } from '../../../core/auth/useMe';
import { useLocation } from '../../../core/location/useLocation';

const PLACE_TYPES = ['home', 'work', 'custom'] as const;
const FILTER_TYPES = ['all', 'home', 'work', 'custom'] as const;

// MV-03 Mobility Saved Places — preview saved destinations on map, pin live GPS, and launch Drive HUD.
export default function MobilityPlacesScreen() {
  const nav = useNavigation<any>();
  const qc = useQueryClient();
  const me = useMe();
  const loc = useLocation();
  const userId = me.data?.id;

  const [placeFilter, setPlaceFilter] = useState<(typeof FILTER_TYPES)[number]>('all');
  const [placeQuery, setPlaceQuery] = useState('');
  const [previewPlaceId, setPreviewPlaceId] = useState<string | null>(null);
  const [showSaveDrawer, setShowSaveDrawer] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof PLACE_TYPES)[number]>('custom');

  const places = useQuery({
    queryKey: ['saved-places', userId],
    queryFn: () => moveApi.listSavedPlaces(userId!),
    enabled: !!userId,
    retry: 0,
  });

  const save = useMutation({
    mutationFn: () =>
      moveApi.savePlace({
        user_id: userId!,
        name: name.trim(),
        place_type: type,
        location: loc.point!,
      }),
    onSuccess: () => {
      setName('');
      setShowSaveDrawer(false);
      qc.invalidateQueries({ queryKey: ['saved-places', userId] });
    },
  });

  const allPlaces = places.data?.places ?? [];
  const filteredPlaces = allPlaces.filter(p => {
    const matchType = placeFilter === 'all' || p.place_type === placeFilter;
    const matchQ = !placeQuery.trim() || p.name.toLowerCase().includes(placeQuery.trim().toLowerCase());
    return matchType && matchQ;
  });
  const previewPlace = allPlaces.find(p => p.id === previewPlaceId) ?? filteredPlaces[0] ?? null;
  const canSave = !!userId && !!loc.point && name.trim().length > 0;

  return (
    <Screen
      title="Saved Places"
      subtitle="Mobility · One-tap destinations & GPS pins"
      backLabel="← Nexora"
      rightAction={
        <TouchableOpacity onPress={() => setShowSaveDrawer(v => !v)} style={styles.actionPill}>
          <Text style={styles.actionPillText}>{showSaveDrawer ? 'Close' : '+ Save Pin'}</Text>
        </TouchableOpacity>
      }>
      <FadeIn index={0}>
        <NavMapCanvas
          origin={loc.point}
          destination={previewPlace}
          roadLabel={previewPlace ? `Preview: ${previewPlace.name}` : undefined}
          height={195}
          onRecenter={loc.refresh}
        />
      </FadeIn>

      {showSaveDrawer && (
        <FadeIn index={1} style={{ marginTop: spacing.m }}>
          <Card variant="featured" style={{ gap: spacing.s }}>
            <Text style={styles.cardHeading}>Pin current GPS location</Text>
            <Input value={name} onChangeText={setName} placeholder="Place name (e.g. Office, Home, Metro)" />
            <View style={styles.chips}>
              {PLACE_TYPES.map(t => (
                <Chip key={t} label={t} active={type === t} onPress={() => setType(t)} />
              ))}
            </View>
            {!loc.point && !loc.loading && (
              <Tappable onPress={loc.refresh}>
                <Text style={{ color: colors.statusWarning, fontSize: 13 }}>
                  {loc.error ?? 'Location unavailable'} — tap to retry
                </Text>
              </Tappable>
            )}
            {save.isError && <Text style={{ color: colors.statusDanger, fontSize: 13 }}>Couldn't save this place.</Text>}
            <PrimaryButton
              title="Save place"
              variant="nav"
              onPress={() => save.mutate()}
              disabled={!canSave}
              loading={save.isPending}
            />
          </Card>
        </FadeIn>
      )}

      <SectionHeading
        title="Your Mobility destinations"
        action={showSaveDrawer ? undefined : '+ Pin GPS'}
        onActionPress={() => setShowSaveDrawer(true)}
      />

      <Card style={{ gap: spacing.s }}>
        <Input
          value={placeQuery}
          onChangeText={setPlaceQuery}
          placeholder="Search saved places…"
          autoCorrect={false}
        />
        <View style={styles.chips}>
          {FILTER_TYPES.map(f => (
            <Chip key={f} label={f === 'all' ? 'All' : f} active={placeFilter === f} onPress={() => setPlaceFilter(f)} />
          ))}
        </View>

        {places.isLoading ? (
          <Skeleton height={24} />
        ) : places.isError ? (
          <Text style={{ color: colors.textSecondary }}>Saved places are unavailable right now.</Text>
        ) : filteredPlaces.length === 0 ? (
          <EmptyState title="No saved places" hint="Tap + Save Pin to store your current location." />
        ) : (
          filteredPlaces.map(p => {
            const selected = previewPlace?.id === p.id;
            return (
              <View key={p.id} style={[styles.placeCard, selected && styles.placeCardActive]}>
                <Tappable onPress={() => setPreviewPlaceId(p.id)} style={{ flex: 1 }}>
                  <Text style={{ color: colors.textPrimary, fontWeight: '700', fontSize: 14.5 }}>{p.name}</Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12, textTransform: 'capitalize' }}>
                    {p.place_type} · {p.latitude.toFixed(3)}, {p.longitude.toFixed(3)}
                  </Text>
                </Tappable>
                <TouchableOpacity
                  onPress={() => nav.navigate('Navigate', { destination: p, nonce: Date.now() })}
                  style={styles.driveMiniBtn}>
                  <Text style={styles.driveMiniText}>Drive →</Text>
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionPill: {
    backgroundColor: colors.navBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  actionPillText: { color: '#FFFFFF', fontFamily: fontFamily.medium, fontSize: 11.5, fontWeight: '700' },
  cardHeading: { color: colors.textPrimary, fontFamily: fontFamily.medium, fontSize: 14, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s },
  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  placeCardActive: {
    borderColor: colors.navBlue,
    backgroundColor: 'rgba(29, 143, 225, 0.12)',
  },
  driveMiniBtn: {
    backgroundColor: colors.navBlue,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  driveMiniText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
});
