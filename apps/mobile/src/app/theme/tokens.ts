import { Platform } from 'react-native';

// NEXORA Obsidian + Electric Navigation Blue + Emerald Telemetry design tokens —
// single source of truth for colors, typography, radii, and spacing across mobile & web.
export const fontFamily = {
  sans: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    web: 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
    default: 'System',
  }),
  medium: Platform.select({
    ios: 'System',
    android: 'sans-serif-medium',
    web: 'Inter, -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif',
    default: 'System',
  }),
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    web: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    default: 'monospace',
  }),
} as const;

export const colors = {
  bgPrimary: '#060B10',
  bgSurface: '#0D151E',
  bgElevated: '#13202D',
  bgAccentSubtle: 'rgba(16, 185, 129, 0.14)',
  textPrimary: '#F0F7FF',
  textSecondary: '#94A8BE',
  textMuted: '#607489',
  accentPrimary: '#10B981',
  accentBright: '#34D399',
  navBlue: '#1D8FE1',
  navBlueDark: '#0C4A82',
  routeCyan: '#22D3EE',
  mapBg: '#081018',
  mapGrid: '#12202E',
  mapRoad: '#1B2D3F',
  mapBuilding: '#0E1924',
  glassSurface: 'rgba(13, 21, 30, 0.92)',
  glassBorder: 'rgba(56, 189, 248, 0.24)',
  statusSuccess: '#22C55E',
  statusWarning: '#F59E0B',
  statusDanger: '#EF4444',
  statusInfo: '#38BDF8',
  borderSubtle: 'rgba(148, 168, 190, 0.16)',
  borderStrong: 'rgba(29, 143, 225, 0.55)',
} as const;

export const moduleColors = {
  move: '#1D8FE1',
  health: '#2DD4BF',
  finance: '#A3E635',
  work: '#38BDF8',
  assistant: '#10B981',
} as const;

export const typography = {
  display: {
    fontFamily: fontFamily.sans,
    fontSize: 24,
    fontWeight: '700' as const,
    letterSpacing: -0.4,
    lineHeight: 30,
  },
  screenTitle: {
    fontFamily: fontFamily.sans,
    fontSize: 20,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
    lineHeight: 26,
  },
  sectionHeading: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    fontWeight: '600' as const,
    letterSpacing: 0.15,
    lineHeight: 18,
  },
  body: {
    fontFamily: fontFamily.sans,
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 19,
  },
  label: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
    lineHeight: 15,
  },
  caption: {
    fontFamily: fontFamily.sans,
    fontSize: 10.5,
    fontWeight: '500' as const,
    lineHeight: 14,
  },
};

export const spacing = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
} as const;

export const radii = {
  card: 18,
  panel: 24,
  button: 14,
};

export const touchTarget = { minWidth: 44, minHeight: 44 };
