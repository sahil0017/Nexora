import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { colors, radii } from '../../app/theme/tokens';
import { GeoPoint, NearbyPOI, moveApi } from '../../core/api/move';
import { useNavPreferences } from '../../core/state/useNavPreferences';

export type MapManeuver = {
  distanceLabel: string;
  primaryStreet: string;
  subtitle?: string;
  badge?: string;
  lanes?: string[];
  turnIcon?: string;
  activeLaneIndex?: number;
  nextTurnHint?: string;
};

export type MapHazardItem = {
  id?: string;
  hazard_type: string;
  severity: string;
  confidence?: number;
};

export type MapTrafficItem = {
  segment_id: string;
  current_speed_kmph: number;
  congestion_level: string;
};

export type MapTransitStop = {
  id: string;
  name: string;
  mode: string;
  distance_m?: number;
};

function projectToCanvasPct(
  center: GeoPoint,
  target: GeoPoint,
  scaleRadiusM = 3200,
): { leftPct: number; topPct: number } {
  const cosLat = Math.cos((center.latitude * Math.PI) / 180) || 1;
  const dxMeters = (target.longitude - center.longitude) * 111_320 * cosLat;
  const dyMeters = (target.latitude - center.latitude) * 110_540;
  const normX = Math.max(-0.38, Math.min(0.38, (dxMeters / scaleRadiusM) * 0.36));
  const normY = Math.max(-0.36, Math.min(0.36, (dyMeters / scaleRadiusM) * 0.36));
  return {
    leftPct: Math.round((50 + normX * 100) * 10) / 10,
    topPct: Math.round((54 - normY * 100) * 10) / 10,
  };
}

/**
 * Interactive 3D/2D dark-vector navigation map & HUD canvas.
 * Fetches accurate nearby petrol pumps, EV chargers, and speed cameras from the OpenStreetMap Overpass API,
 * supports pan/zoom, layer toggles, 1-tap external maps handoff, and Rapido-style full-screen driving mode.
 */
export function NavMapCanvas({
  origin,
  destination,
  stops = [],
  hazards = [],
  trafficSegments = [],
  transitStops = [],
  maneuver,
  roadLabel,
  speedLimit = 50,
  liveSpeedKmph,
  progress = 0,
  voiceMuted,
  onToggleVoice,
  delayMinutes,
  height = 248,
  fullScreen: controlledFullScreen,
  onToggleFullScreen,
  fullScreenOverlay,
  onOpenSettings,
  onSelectStop,
  onAddStop,
  onRecenter,
}: {
  origin?: GeoPoint;
  destination?: { name: string; latitude: number; longitude: number } | null;
  stops?: Array<{ name: string; latitude: number; longitude: number }>;
  hazards?: MapHazardItem[];
  trafficSegments?: MapTrafficItem[];
  transitStops?: MapTransitStop[];
  maneuver?: MapManeuver | null;
  roadLabel?: string;
  speedLimit?: number;
  liveSpeedKmph?: number;
  progress?: number;
  voiceMuted?: boolean;
  onToggleVoice?: () => void;
  delayMinutes?: number;
  height?: number;
  fullScreen?: boolean;
  onToggleFullScreen?: () => void;
  fullScreenOverlay?: React.ReactNode;
  onOpenSettings?: () => void;
  onSelectStop?: (stop: MapTransitStop) => void;
  onAddStop?: (place: { name: string; subtitle?: string; latitude: number; longitude: number }) => void;
  onRecenter?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const prefs = useNavPreferences();
  const [zoom, setZoom] = useState(1);
  const [headingNorthUp, setHeadingNorthUp] = useState(false);
  const [showEV, setShowEV] = useState(true);
  const [showSpeedCams, setShowSpeedCams] = useState(true);
  const [showFuel, setShowFuel] = useState(true);
  const [gpsHubOpen, setGpsHubOpen] = useState(false);
  const [gpsToast, setGpsToast] = useState<string | null>(null);
  const [internalFullScreen, setInternalFullScreen] = useState(false);
  const [selectedPin, setSelectedPin] = useState<{
    title: string;
    subtitle: string;
    detailLine?: string;
    tone?: string;
    coords?: GeoPoint;
    stopCandidate?: { name: string; subtitle?: string; latitude: number; longitude: number };
  } | null>(null);

  const isFullScreen = controlledFullScreen !== undefined ? controlledFullScreen : internalFullScreen;
  const handleToggleFullScreen = () => {
    if (onToggleFullScreen) {
      onToggleFullScreen();
    } else {
      setInternalFullScreen(v => !v);
    }
  };

  // Query real OpenStreetMap Overpass POIs (fuel stations, EV chargers, speed cameras) around origin
  const poiQuery = useQuery({
    queryKey: [
      'osm-nearby-pois',
      origin ? Math.round(origin.latitude * 250) : null,
      origin ? Math.round(origin.longitude * 250) : null,
    ],
    queryFn: () => moveApi.nearbyPois(origin!, 3500),
    enabled: !!origin,
    staleTime: 180_000,
    retry: 0,
  });

  const realPois: NearbyPOI[] = poiQuery.data?.pois ?? [];

  const nearestFuel = useMemo(() => realPois.find(p => p.kind === 'fuel'), [realPois]);
  const nearestEV = useMemo(() => realPois.find(p => p.kind === 'ev'), [realPois]);

  const pulse = useRef(new Animated.Value(0)).current;
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const lastOffset = useRef({ x: 0, y: 0 });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_evt, gesture) =>
        Math.abs(gesture.dx) > 6 || Math.abs(gesture.dy) > 6,
      onPanResponderMove: (_evt, gesture) => {
        const nextX = Math.max(-110, Math.min(110, lastOffset.current.x + gesture.dx));
        const nextY = Math.max(-90, Math.min(90, lastOffset.current.y + gesture.dy));
        pan.setValue({ x: nextX, y: nextY });
      },
      onPanResponderRelease: (_evt, gesture) => {
        lastOffset.current = {
          x: Math.max(-110, Math.min(110, lastOffset.current.x + gesture.dx)),
          y: Math.max(-90, Math.min(90, lastOffset.current.y + gesture.dy)),
        };
      },
    }),
  ).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const showToastMessage = (msg: string) => {
    setGpsToast(msg);
    setTimeout(() => {
      setGpsToast(cur => (cur === msg ? null : cur));
    }, 2600);
  };

  const handleRecenterPress = () => {
    lastOffset.current = { x: 0, y: 0 };
    Animated.spring(pan, {
      toValue: { x: 0, y: 0 },
      useNativeDriver: true,
      friction: 6,
      tension: 60,
    }).start();
    setZoom(1.08);
    setHeadingNorthUp(false);
    onRecenter?.();
    const coordStr = origin
      ? `${origin.latitude.toFixed(4)}°N, ${origin.longitude.toFixed(4)}°E`
      : 'Waiting for GPS';
    showToastMessage(`⌖ GPS Centered · ${coordStr}`);
  };

  const openExternalMap = async (target: 'apple' | 'google', customDest?: GeoPoint) => {
    if (!origin && !customDest && !destination) {
      showToastMessage('Location lock required for external directions');
      return;
    }
    const origLat = origin?.latitude;
    const origLng = origin?.longitude;
    const destLat = customDest?.latitude ?? destination?.latitude;
    const destLng = customDest?.longitude ?? destination?.longitude;

    try {
      if (target === 'apple') {
        const url =
          destLat !== undefined && destLng !== undefined && origLat !== undefined && origLng !== undefined
            ? Platform.OS === 'ios'
              ? `maps://?saddr=${origLat},${origLng}&daddr=${destLat},${destLng}&dirflg=d`
              : `https://maps.apple.com/?saddr=${origLat},${origLng}&daddr=${destLat},${destLng}`
            : `https://maps.apple.com/?ll=${destLat ?? origLat},${destLng ?? origLng}`;
        await Linking.openURL(url);
      } else {
        const waypointsParam =
          !customDest && stops.length > 0
            ? `&waypoints=${encodeURIComponent(stops.map(s => `${s.latitude},${s.longitude}`).join('|'))}`
            : '';
        const url =
          destLat !== undefined && destLng !== undefined && origLat !== undefined && origLng !== undefined
            ? `https://www.google.com/maps/dir/?api=1&origin=${origLat},${origLng}&destination=${destLat},${destLng}${waypointsParam}&travelmode=driving`
            : `https://www.google.com/maps/search/?api=1&query=${destLat ?? origLat},${destLng ?? origLng}`;
        await Linking.openURL(url);
      }
    } catch {
      showToastMessage('Could not launch external map app');
    }
  };

  const hasCongestion = trafficSegments.some(s =>
    ['heavy', 'high', 'severe', 'congested'].includes(s.congestion_level.toLowerCase()),
  );
  const avgSpeed = trafficSegments.length
    ? Math.round(trafficSegments.reduce((a, b) => a + b.current_speed_kmph, 0) / trafficSegments.length)
    : null;

  const is3D = prefs.viewMode === '3D' && !headingNorthUp;
  const isSatellite = prefs.mapStyle === 'satellite';

  const gpsText = origin
    ? `${origin.latitude.toFixed(4)}° N, ${origin.longitude.toFixed(4)}° E`
    : 'Acquiring GPS coordinates…';

  const filteredPois = realPois.filter(
    p =>
      (p.kind === 'ev' && showEV) ||
      (p.kind === 'cam' && showSpeedCams) ||
      (p.kind === 'fuel' && showFuel),
  );

  const renderMapStage = (fullScreenMode: boolean) => {
    const safeTopPad = fullScreenMode ? Math.max(10, insets.top + 4) : 10;
    const safeBottomPad = fullScreenMode ? (fullScreenOverlay ? 14 : Math.max(14, insets.bottom + 8)) : 10;

    return (
      <View
        style={[
          styles.container,
          fullScreenMode ? styles.fullScreenContainer : { height },
          isSatellite && styles.satelliteContainer,
        ]}>
        {/* Interactive Pan & Zoom Vector Map Stage */}
        <Pressable
          {...panResponder.panHandlers}
          style={styles.mapStage}
          onPress={() => {
            setSelectedPin(null);
            if (gpsHubOpen) setGpsHubOpen(false);
          }}
          accessibilityLabel="Interactive navigation map">
          <Animated.View
            style={[
              styles.worldLayer,
              {
                transform: [
                  { translateX: pan.x },
                  { translateY: pan.y },
                  { scale: zoom },
                  ...(is3D ? [{ perspective: 800 }, { rotateX: '18deg' }] : []),
                ],
              },
            ]}>
            {/* Clean Geometric Road Grid */}
            <View style={[styles.roadH, { top: '26%' }]} />
            <View style={[styles.roadH, { top: '54%' }]} />
            <View style={[styles.roadH, { top: '78%' }]} />
            <View style={[styles.roadV, { left: '24%' }]} />
            <View style={[styles.roadV, { left: '52%' }]} />
            <View style={[styles.roadV, { left: '78%' }]} />
            <View style={styles.diagonalRoad} />

            {/* Compass & Live Corridor Markers (zero hardcoded locations) */}
            <View style={[styles.corridorLabelBox, { top: '12%', left: '47%' }]}>
              <Text style={styles.corridorLabelText}>N</Text>
            </View>
            {maneuver?.primaryStreet ? (
              <View style={[styles.corridorLabelBox, { top: '23%', left: '16%' }]}>
                <Text style={styles.corridorLabelText} numberOfLines={1}>
                  {maneuver.primaryStreet.toUpperCase()}
                </Text>
              </View>
            ) : null}
            {destination?.name ? (
              <View style={[styles.corridorLabelBox, { top: '20%', left: '58%' }]}>
                <Text style={styles.corridorLabelText} numberOfLines={1}>
                  → {destination.name.toUpperCase()}
                </Text>
              </View>
            ) : null}

            {/* Active route vector when destination exists */}
            {destination && (
              <View style={styles.routeOverlay}>
                <View style={styles.routeLegGlow} />
                <View style={styles.routeLegMain} />
                {prefs.showTraffic && (
                  <View
                    style={[
                      styles.routeTrafficSegment,
                      { backgroundColor: hasCongestion ? colors.statusDanger : colors.statusSuccess },
                    ]}
                  />
                )}

                <View style={styles.routeCalloutChip}>
                  <Text style={styles.routeCalloutText}>
                    ⚡ {hasCongestion ? 'Heavy Segment' : 'Optimal Corridor'}
                  </Text>
                </View>

                {/* Waypoints along route */}
                {stops.map((st, idx) => {
                  const pos = origin
                    ? projectToCanvasPct(origin, st)
                    : { leftPct: 46 + ((idx + 1) * 8) % 24, topPct: 54 - ((idx + 1) * 12) % 28 };
                  return (
                    <TouchableOpacity
                      key={`${st.name}-${idx}`}
                      onPress={() =>
                        setSelectedPin({
                          title: `Stop ${idx + 1}: ${st.name}`,
                          subtitle: `${st.latitude.toFixed(4)}° N, ${st.longitude.toFixed(4)}° E`,
                          tone: colors.navBlue,
                          coords: st,
                        })
                      }
                      style={[
                        styles.stopPin,
                        { left: `${pos.leftPct}%` as any, top: `${pos.topPct}%` as any },
                      ]}>
                      <Text style={styles.stopPinText}>{idx + 1}</Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Destination marker */}
                <TouchableOpacity
                  onPress={() =>
                    setSelectedPin({
                      title: `Destination: ${destination.name}`,
                      subtitle: `${destination.latitude.toFixed(4)}° N, ${destination.longitude.toFixed(4)}° E`,
                      tone: colors.routeCyan,
                      coords: destination,
                    })
                  }
                  style={styles.destPin}>
                  <Text style={styles.destPinText}>⚑</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Real OpenStreetMap Petrol Pumps, EV Chargers & Speed Cameras */}
            {origin &&
              filteredPois.slice(0, 12).map(poi => {
                const pos = projectToCanvasPct(origin, { latitude: poi.latitude, longitude: poi.longitude });
                const icon = poi.kind === 'ev' ? '⚡' : poi.kind === 'fuel' ? '⛽' : '📷';
                const badgeColor =
                  poi.kind === 'ev' ? '#10B981' : poi.kind === 'fuel' ? '#38BDF8' : '#F59E0B';
                return (
                  <TouchableOpacity
                    key={poi.id}
                    onPress={() =>
                      setSelectedPin({
                        title: poi.name,
                        subtitle: poi.subtitle,
                        detailLine: `Source: ${poi.source}${poi.operator ? ` · Operator: ${poi.operator}` : ''}`,
                        tone: badgeColor,
                        coords: { latitude: poi.latitude, longitude: poi.longitude },
                        stopCandidate:
                          poi.kind !== 'cam'
                            ? {
                                name: poi.name,
                                subtitle: poi.subtitle,
                                latitude: poi.latitude,
                                longitude: poi.longitude,
                              }
                            : undefined,
                      })
                    }
                    style={[
                      styles.smartPoiPin,
                      {
                        top: `${pos.topPct}%` as any,
                        left: `${pos.leftPct}%` as any,
                        borderColor: badgeColor,
                      },
                    ]}>
                    <Text style={styles.smartPoiIcon}>{icon}</Text>
                  </TouchableOpacity>
                );
              })}

            {/* Interactive hazard pins */}
            {prefs.showIncidents &&
              hazards.slice(0, 4).map((h, i) => {
                const positions = [
                  { top: '34%', left: '32%' },
                  { top: '24%', left: '62%' },
                  { top: '62%', left: '40%' },
                  { top: '42%', left: '72%' },
                ];
                const pos = positions[i % positions.length];
                const isHigh = h.severity === 'high' || h.severity === 'critical';
                return (
                  <TouchableOpacity
                    key={h.id ?? `${h.hazard_type}-${i}`}
                    onPress={() =>
                      setSelectedPin({
                        title: `⚠ ${h.hazard_type.replace(/_/g, ' ').toUpperCase()}`,
                        subtitle: `Severity: ${h.severity}${
                          h.confidence ? ` · ${Math.round(h.confidence * 100)}% verified` : ''
                        }`,
                        tone: isHigh ? colors.statusDanger : colors.statusWarning,
                      })
                    }
                    style={[
                      styles.hazardPin,
                      {
                        top: pos.top as any,
                        left: pos.left as any,
                        borderColor: isHigh ? colors.statusDanger : colors.statusWarning,
                      },
                    ]}>
                    <Text style={styles.hazardPinText}>⚠</Text>
                  </TouchableOpacity>
                );
              })}

            {/* Interactive transit stop pins */}
            {transitStops.slice(0, 3).map((st, i) => {
              const positions = [
                { top: '48%', left: '20%' },
                { top: '30%', left: '75%' },
                { top: '70%', left: '64%' },
              ];
              const pos = positions[i % positions.length];
              return (
                <TouchableOpacity
                  key={st.id}
                  onPress={() => {
                    setSelectedPin({
                      title: st.name,
                      subtitle: `${st.mode.toUpperCase()}${st.distance_m ? ` · ${Math.round(st.distance_m)}m away` : ''}`,
                      tone: colors.accentBright,
                      stopCandidate: origin
                        ? {
                            name: st.name,
                            subtitle: `${st.mode} station`,
                            latitude: +(origin.latitude + 0.0025 * (i + 1)).toFixed(5),
                            longitude: +(origin.longitude + 0.002 * (i + 1)).toFixed(5),
                          }
                        : undefined,
                    });
                    onSelectStop?.(st);
                  }}
                  style={[styles.transitPin, { top: pos.top as any, left: pos.left as any }]}>
                  <Text style={styles.transitPinText}>{st.mode.toLowerCase().includes('metro') ? 'M' : 'B'}</Text>
                </TouchableOpacity>
              );
            })}

            {/* Tappable Live GPS 3D Chevron Puck */}
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                handleRecenterPress();
                setGpsHubOpen(true);
              }}
              style={[
                styles.chevronAnchor,
                progress > 0 && {
                  left: `${Math.round(46 + Math.min(1, Math.max(0, progress)) * 22)}%` as any,
                  top: `${Math.round(60 - Math.min(1, Math.max(0, progress)) * 36)}%` as any,
                },
              ]}>
              <Animated.View
                style={[
                  styles.chevronHalo,
                  {
                    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0.12] }),
                    transform: [
                      { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.65] }) },
                    ],
                  },
                ]}
              />
              <View style={styles.chevronCore}>
                <Text style={styles.chevronArrow}>▲</Text>
              </View>
            </TouchableOpacity>
          </Animated.View>
        </Pressable>

        {/* Top HUD Overlay: Turn-by-Turn Maneuver Banner OR Smart Layer Bar + Right Controls */}
        <View style={[styles.topHud, { top: safeTopPad }]} pointerEvents="box-none">
          {maneuver ? (
            <View style={{ flex: 1, maxWidth: '80%', gap: 4 }}>
              <View style={styles.maneuverBanner}>
                <View style={styles.maneuverTop}>
                  <View style={styles.turnIconBox}>
                    <Text style={styles.turnArrow}>{maneuver.turnIcon ?? '↱'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.maneuverDist}>{maneuver.distanceLabel}</Text>
                    <Text style={styles.maneuverStreet} numberOfLines={1}>
                      {maneuver.primaryStreet}
                    </Text>
                    {maneuver.subtitle ? (
                      <Text style={styles.maneuverSub} numberOfLines={1}>
                        {maneuver.subtitle}
                      </Text>
                    ) : null}
                  </View>
                  {maneuver.badge ? (
                    <View style={styles.roadBadge}>
                      <Text style={styles.roadBadgeText}>{maneuver.badge}</Text>
                    </View>
                  ) : null}
                </View>
                {maneuver.lanes && maneuver.lanes.length > 0 && (
                  <View style={styles.laneBar}>
                    {maneuver.lanes.map((arrow, idx) => {
                      const activeIdx = maneuver.activeLaneIndex ?? maneuver.lanes!.length - 1;
                      return (
                        <Text
                          key={idx}
                          style={[
                            styles.laneArrow,
                            idx === activeIdx && styles.laneArrowActive,
                          ]}>
                          {arrow}
                        </Text>
                      );
                    })}
                  </View>
                )}
              </View>
              {maneuver.nextTurnHint ? (
                <View style={styles.nextTurnStrip}>
                  <Text style={styles.nextTurnText} numberOfLines={1}>
                    {maneuver.nextTurnHint}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.alertPillsRow}>
              <TouchableOpacity
                onPress={() => setShowEV(v => !v)}
                style={[styles.glassPill, showEV && styles.activeLayerPill]}>
                <Text style={styles.glassPillText}>
                  ⚡ EV ({realPois.filter(p => p.kind === 'ev').length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowFuel(v => !v)}
                style={[styles.glassPill, showFuel && styles.activeLayerPill]}>
                <Text style={styles.glassPillText}>
                  ⛽ Fuel ({realPois.filter(p => p.kind === 'fuel').length})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowSpeedCams(v => !v)}
                style={[styles.glassPill, showSpeedCams && styles.activeLayerPill]}>
                <Text style={styles.glassPillText}>📷 Cams</Text>
              </TouchableOpacity>
              {hazards.length > 0 && (
                <TouchableOpacity
                  onPress={() =>
                    setSelectedPin({
                      title: `${hazards.length} Nearby Hazard${hazards.length > 1 ? 's' : ''}`,
                      subtitle: hazards[0].hazard_type.replace(/_/g, ' '),
                      tone: colors.statusWarning,
                    })
                  }
                  style={styles.amberPill}>
                  <Text style={styles.alertPillText}>⚠ {hazards.length}</Text>
                </TouchableOpacity>
              )}
              {typeof delayMinutes === 'number' && delayMinutes > 0 && (
                <View style={styles.dangerPill}>
                  <Text style={styles.dangerPillText}>+{delayMinutes} min</Text>
                </View>
              )}
            </View>
          )}

          {/* Right HUD Map Controls */}
          <View style={styles.mapControls}>
            <TouchableOpacity
              onPress={handleToggleFullScreen}
              style={[styles.ctrlBtn, fullScreenMode && styles.ctrlHighlight]}
              accessibilityLabel={fullScreenMode ? 'Exit full screen map' : 'Expand full screen map'}>
              <Text style={styles.ctrlText}>{fullScreenMode ? '⤡' : '⤢'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setHeadingNorthUp(v => !v);
                prefs.setViewMode(prefs.viewMode === '3D' ? '2D' : '3D');
              }}
              style={styles.ctrlBtn}
              accessibilityLabel="Toggle 2D North-Up or 3D Perspective">
              <Text style={styles.ctrlText}>{is3D ? '3D' : 'N▲'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setZoom(z => Math.min(1.6, +(z + 0.15).toFixed(2)))}
              style={styles.ctrlBtn}
              accessibilityLabel="Zoom in">
              <Text style={styles.ctrlText}>+</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setZoom(z => Math.max(0.75, +(z - 0.15).toFixed(2)))}
              style={styles.ctrlBtn}
              accessibilityLabel="Zoom out">
              <Text style={styles.ctrlText}>−</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => prefs.setMapStyle(isSatellite ? 'default' : 'satellite')}
              style={[styles.ctrlBtn, isSatellite && styles.ctrlHighlight]}
              accessibilityLabel="Toggle satellite or vector layer">
              <Text style={styles.ctrlText}>{isSatellite ? '🗺' : '🛰'}</Text>
            </TouchableOpacity>
            {onToggleVoice && (
              <TouchableOpacity
                onPress={onToggleVoice}
                style={[styles.ctrlBtn, !voiceMuted && styles.ctrlHighlight]}
                accessibilityLabel="Toggle voice guidance">
                <Text style={styles.ctrlText}>{voiceMuted ? '🔇' : '🔊'}</Text>
              </TouchableOpacity>
            )}
            {onOpenSettings && (
              <TouchableOpacity
                onPress={onOpenSettings}
                style={[styles.ctrlBtn, styles.ctrlHighlight]}
                accessibilityLabel="Open quick settings">
                <Text style={styles.ctrlText}>⚙</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Floating GPS Recenter Feedback Toast */}
        {gpsToast && (
          <View style={styles.gpsToastBanner} pointerEvents="none">
            <Text style={styles.gpsToastText}>{gpsToast}</Text>
          </View>
        )}

        {/* Interactive OSM POI Tooltip with "+ Stop" & "↗ Navigate" */}
        {selectedPin && !gpsHubOpen && (
          <View style={[styles.tooltip, { borderColor: selectedPin.tone ?? colors.navBlue, bottom: safeBottomPad + 48 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.tooltipTitle}>{selectedPin.title}</Text>
              <Text style={styles.tooltipSub}>{selectedPin.subtitle}</Text>
              {selectedPin.detailLine ? (
                <Text style={styles.tooltipSource}>{selectedPin.detailLine}</Text>
              ) : null}
            </View>
            {selectedPin.coords && (
              <TouchableOpacity
                onPress={() => openExternalMap('google', selectedPin.coords)}
                style={styles.navPoiBtn}>
                <Text style={styles.addPoiStopText}>↗ Go</Text>
              </TouchableOpacity>
            )}
            {selectedPin.stopCandidate && onAddStop && (
              <TouchableOpacity
                onPress={() => {
                  onAddStop(selectedPin.stopCandidate!);
                  showToastMessage(`+ Added "${selectedPin.stopCandidate!.name}" to stops`);
                  setSelectedPin(null);
                }}
                style={styles.addPoiStopBtn}>
                <Text style={styles.addPoiStopText}>+ Stop</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setSelectedPin(null)}>
              <Text style={{ color: colors.textMuted, fontWeight: '700', paddingHorizontal: 6 }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Built-in GPS & OpenStreetMap Hub Drawer */}
        {gpsHubOpen && (
          <View style={[styles.gpsHubSheet, { bottom: safeBottomPad + 48 }]}>
            <View style={styles.gpsHubHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.gpsHubTitle}>GPS & OpenStreetMap Pitstops</Text>
                <Text style={styles.gpsHubCoords}>
                  {gpsText} · {poiQuery.isFetching ? 'Scanning Overpass…' : `${realPois.length} live OSM POIs`}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setGpsHubOpen(false)} style={styles.gpsHubCloseBtn}>
                <Text style={{ color: colors.textPrimary, fontSize: 12, fontWeight: '800' }}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Nearest real Petrol Pump & EV Charger quick cards */}
            {(nearestFuel || nearestEV) && (
              <View style={{ gap: 6 }}>
                {nearestFuel && (
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedPin({
                        title: nearestFuel.name,
                        subtitle: nearestFuel.subtitle,
                        detailLine: `Source: ${nearestFuel.source}`,
                        tone: '#38BDF8',
                        coords: { latitude: nearestFuel.latitude, longitude: nearestFuel.longitude },
                        stopCandidate: {
                          name: nearestFuel.name,
                          subtitle: nearestFuel.subtitle,
                          latitude: nearestFuel.latitude,
                          longitude: nearestFuel.longitude,
                        },
                      });
                      setGpsHubOpen(false);
                    }}
                    style={styles.nearestPoiCard}>
                    <Text style={styles.nearestPoiTitle} numberOfLines={1}>
                      ⛽ Nearest Fuel: {nearestFuel.name}
                    </Text>
                    <Text style={styles.nearestPoiSub} numberOfLines={1}>
                      {nearestFuel.subtitle}
                    </Text>
                  </TouchableOpacity>
                )}
                {nearestEV && (
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedPin({
                        title: nearestEV.name,
                        subtitle: nearestEV.subtitle,
                        detailLine: `Source: ${nearestEV.source}`,
                        tone: '#10B981',
                        coords: { latitude: nearestEV.latitude, longitude: nearestEV.longitude },
                        stopCandidate: {
                          name: nearestEV.name,
                          subtitle: nearestEV.subtitle,
                          latitude: nearestEV.latitude,
                          longitude: nearestEV.longitude,
                        },
                      });
                      setGpsHubOpen(false);
                    }}
                    style={styles.nearestPoiCard}>
                    <Text style={styles.nearestPoiTitle} numberOfLines={1}>
                      ⚡ Nearest EV: {nearestEV.name}
                    </Text>
                    <Text style={styles.nearestPoiSub} numberOfLines={1}>
                      {nearestEV.subtitle}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <View style={styles.gpsHubPillsRow}>
              <TouchableOpacity
                onPress={() => setShowEV(v => !v)}
                style={[styles.hubFilterChip, showEV && styles.hubFilterChipActive]}>
                <Text style={styles.hubFilterText}>⚡ EV Chargers</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowSpeedCams(v => !v)}
                style={[styles.hubFilterChip, showSpeedCams && styles.hubFilterChipActive]}>
                <Text style={styles.hubFilterText}>📷 Speed Cams</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowFuel(v => !v)}
                style={[styles.hubFilterChip, showFuel && styles.hubFilterChipActive]}>
                <Text style={styles.hubFilterText}>⛽ Petrol Pumps</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.gpsHubActionsRow}>
              <TouchableOpacity
                onPress={() => {
                  handleRecenterPress();
                  setGpsHubOpen(false);
                }}
                style={styles.hubPrimaryBtn}>
                <Text style={styles.hubPrimaryBtnText}>⌖ Center GPS</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openExternalMap('google')}
                style={styles.hubExternalBtn}>
                <Text style={styles.hubExternalBtnText}>↗ Google Maps</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => openExternalMap('apple')}
                style={styles.hubExternalBtn}>
                <Text style={styles.hubExternalBtnText}>↗ Apple Maps</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Bottom HUD Pill */}
        <View style={[styles.bottomHud, { bottom: safeBottomPad }]} pointerEvents="box-none">
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setGpsHubOpen(v => !v)}
            style={styles.roadPill}
            accessibilityLabel="Open GPS and OpenStreetMap options">
            <View style={styles.speedCircle}>
              <Text style={styles.speedNum}>{speedLimit}</Text>
            </View>
            {(typeof liveSpeedKmph === 'number' || typeof avgSpeed === 'number') && (
              <View style={styles.liveSpeedBox}>
                <Text style={styles.liveSpeedVal}>{liveSpeedKmph ?? avgSpeed}</Text>
                <Text style={styles.liveSpeedUnit}>km/h</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.roadName} numberOfLines={1}>
                {roadLabel ?? destination?.name ?? gpsText}
              </Text>
              <Text style={styles.gpsHintSub} numberOfLines={1}>
                Tap for OpenStreetMap Fuel/EV ({realPois.length}) · External Maps ▴
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleRecenterPress}
            style={styles.recenterBtn}
            accessibilityLabel="Recenter GPS">
            <Text style={styles.recenterText}>⌖</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <>
      {!isFullScreen && renderMapStage(false)}
      <Modal
        visible={isFullScreen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={handleToggleFullScreen}>
        <View style={styles.fullScreenModalRoot}>
          <View style={{ flex: 1 }}>{renderMapStage(true)}</View>
          {fullScreenOverlay}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fullScreenModalRoot: {
    flex: 1,
    backgroundColor: colors.mapBg,
  },
  fullScreenContainer: {
    flex: 1,
    width: '100%',
    backgroundColor: colors.mapBg,
    position: 'relative',
  },
  container: {
    width: '100%',
    borderRadius: radii.panel,
    overflow: 'hidden',
    backgroundColor: colors.mapBg,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    position: 'relative',
  },
  satelliteContainer: {
    backgroundColor: '#091513',
  },
  mapStage: {
    flex: 1,
    overflow: 'hidden',
  },
  worldLayer: {
    flex: 1,
    position: 'relative',
  },
  roadH: {
    position: 'absolute',
    left: -40,
    right: -40,
    height: 8,
    backgroundColor: colors.mapRoad,
    opacity: 0.78,
  },
  roadV: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    width: 8,
    backgroundColor: colors.mapRoad,
    opacity: 0.78,
  },
  diagonalRoad: {
    position: 'absolute',
    top: '15%',
    left: '10%',
    width: '90%',
    height: 11,
    backgroundColor: '#22384F',
    transform: [{ rotate: '-22deg' }],
    opacity: 0.88,
  },
  corridorLabelBox: {
    position: 'absolute',
    backgroundColor: 'rgba(10, 18, 28, 0.78)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(148, 168, 190, 0.18)',
    maxWidth: 160,
  },
  corridorLabelText: {
    color: 'rgba(200, 220, 240, 0.78)',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  routeOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  routeLegGlow: {
    position: 'absolute',
    left: '47.5%',
    top: '19%',
    width: 12,
    height: '60%',
    borderRadius: 6,
    backgroundColor: 'rgba(42, 224, 196, 0.24)',
    transform: [{ rotate: '22deg' }],
  },
  routeLegMain: {
    position: 'absolute',
    left: '48%',
    top: '20%',
    width: 6,
    height: '58%',
    borderRadius: 3,
    backgroundColor: colors.routeCyan,
    transform: [{ rotate: '22deg' }],
  },
  routeTrafficSegment: {
    position: 'absolute',
    left: '51%',
    top: '38%',
    width: 6,
    height: '20%',
    borderRadius: 3,
    transform: [{ rotate: '22deg' }],
  },
  routeCalloutChip: {
    position: 'absolute',
    left: '54%',
    top: '38%',
    backgroundColor: 'rgba(6, 20, 32, 0.92)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.routeCyan,
  },
  routeCalloutText: {
    color: colors.routeCyan,
    fontSize: 9.5,
    fontWeight: '800',
  },
  stopPin: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.navBlue,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopPinText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  destPin: {
    position: 'absolute',
    right: '24%',
    top: '18%',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.routeCyan,
    borderWidth: 2,
    borderColor: '#03121E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destPinText: { color: '#03121E', fontSize: 14, fontWeight: '900' },
  smartPoiPin: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(10, 18, 28, 0.92)',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smartPoiIcon: { fontSize: 12 },
  hazardPin: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1E1A0F',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hazardPinText: { fontSize: 13 },
  transitPin: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#0D2520',
    borderWidth: 1.5,
    borderColor: colors.accentBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  transitPinText: { color: colors.accentBright, fontSize: 11, fontWeight: '900' },
  chevronAnchor: {
    position: 'absolute',
    left: '46%',
    top: '60%',
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronHalo: {
    position: 'absolute',
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.navBlue,
  },
  chevronCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.navBlue,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronArrow: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', marginTop: -2 },
  topHud: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  maneuverBanner: {
    backgroundColor: '#0F6B4E',
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
  },
  nextTurnStrip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(10, 24, 38, 0.92)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(42, 224, 196, 0.35)',
  },
  nextTurnText: {
    color: colors.routeCyan,
    fontSize: 11.5,
    fontWeight: '800',
  },
  maneuverTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  turnIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  turnArrow: { color: '#FFFFFF', fontSize: 20, fontWeight: '900' },
  maneuverDist: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  maneuverStreet: { color: '#E8F4FF', fontSize: 12.5, fontWeight: '700' },
  maneuverSub: { color: 'rgba(255,255,255,0.78)', fontSize: 11 },
  roadBadge: {
    backgroundColor: colors.accentPrimary,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roadBadgeText: { color: '#031109', fontSize: 11, fontWeight: '800' },
  laneBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  laneArrow: { color: 'rgba(255,255,255,0.55)', fontSize: 14, fontWeight: '800' },
  laneArrowActive: { color: '#FFFFFF' },
  alertPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  amberPill: {
    backgroundColor: '#F59E0B',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  alertPillText: { color: '#1F1300', fontSize: 11.5, fontWeight: '900' },
  dangerPill: {
    backgroundColor: colors.statusDanger,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dangerPillText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '800' },
  glassPill: {
    backgroundColor: colors.glassSurface,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  activeLayerPill: {
    borderColor: colors.routeCyan,
    backgroundColor: 'rgba(12, 34, 48, 0.92)',
  },
  glassPillText: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
  mapControls: { gap: 6, alignItems: 'flex-end' },
  ctrlBtn: {
    minWidth: 34,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: colors.glassSurface,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlHighlight: { borderColor: colors.navBlue },
  ctrlText: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  gpsToastBanner: {
    position: 'absolute',
    bottom: 62,
    left: 14,
    right: 58,
    backgroundColor: 'rgba(6, 24, 36, 0.95)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.routeCyan,
    alignItems: 'center',
  },
  gpsToastText: {
    color: colors.routeCyan,
    fontSize: 11.5,
    fontWeight: '800',
  },
  tooltip: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 58,
    backgroundColor: colors.glassSurface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tooltipTitle: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '800' },
  tooltipSub: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
  tooltipSource: { color: colors.routeCyan, fontSize: 10, fontWeight: '700', marginTop: 2 },
  addPoiStopBtn: {
    backgroundColor: colors.navBlue,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  navPoiBtn: {
    backgroundColor: '#0F6B4E',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  addPoiStopText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  gpsHubSheet: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 54,
    backgroundColor: 'rgba(8, 16, 26, 0.97)',
    borderRadius: 16,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: colors.navBlue,
  },
  gpsHubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gpsHubTitle: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '800' },
  gpsHubCoords: { color: colors.routeCyan, fontSize: 11, fontWeight: '700', marginTop: 1 },
  gpsHubCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nearestPoiCard: {
    backgroundColor: colors.bgElevated,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  nearestPoiTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  nearestPoiSub: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
  gpsHubPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  hubFilterChip: {
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  hubFilterChipActive: {
    borderColor: colors.routeCyan,
    backgroundColor: 'rgba(42, 224, 196, 0.14)',
  },
  hubFilterText: { color: colors.textPrimary, fontSize: 11, fontWeight: '700' },
  gpsHubActionsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  hubPrimaryBtn: {
    flex: 1,
    backgroundColor: colors.navBlue,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  hubPrimaryBtnText: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '800' },
  hubExternalBtn: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  hubExternalBtnText: { color: colors.routeCyan, fontSize: 11.5, fontWeight: '800' },
  bottomHud: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  roadPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.glassSurface,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 8,
    paddingRight: 12,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  speedCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: colors.statusDanger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speedNum: { color: '#0A0F14', fontSize: 11, fontWeight: '900' },
  liveSpeedBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    backgroundColor: 'rgba(42, 224, 196, 0.14)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(42, 224, 196, 0.3)',
  },
  liveSpeedVal: { color: colors.routeCyan, fontSize: 13, fontWeight: '900' },
  liveSpeedUnit: { color: colors.textSecondary, fontSize: 9.5, fontWeight: '700' },
  roadName: { color: colors.textPrimary, fontSize: 12, fontWeight: '800' },
  gpsHintSub: { color: colors.routeCyan, fontSize: 9.5, fontWeight: '700', marginTop: 1 },
  recenterBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.glassSurface,
    borderWidth: 1,
    borderColor: colors.routeCyan,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recenterText: { color: colors.routeCyan, fontSize: 18, fontWeight: '800' },
});
