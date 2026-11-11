// NEXORA dark design tokens — single source of truth for colors,
// typography and spacing. Never use inline color literals in features.
export const colors = {
  bgPrimary: '#0D1422',
  bgSurface: '#17243A',
  bgElevated: '#263650',
  textPrimary: '#F4F7FC',
  textSecondary: '#AEBBD0',
  accentPrimary: '#A9C9FF',
  statusSuccess: '#36B37E',
  statusWarning: '#E9AC54',
  statusDanger: '#E36D76',
  statusInfo: '#A9C9FF',
  borderSubtle: 'rgba(255,255,255,0.08)',
} as const;

export const moduleColors = {
  move: '#7EC8F2',
  health: '#7BE0B0',
  finance: '#F2C879',
  work: '#C3A9F2',
  assistant: '#A9C9FF',
} as const;

export const typography = {
  display: { fontSize: 30, fontWeight: '700' as const },
  screenTitle: { fontSize: 24, fontWeight: '700' as const },
  sectionHeading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 12.5, fontWeight: '500' as const },
};

export const spacing = {
  xs: 4,
  s: 8,
  m: 16,
  l: 24,
  xl: 32,
} as const;

export const radii = {
  card: 16,
  panel: 22,
  button: 12,
};

export const touchTarget = { minWidth: 44, minHeight: 44 };
