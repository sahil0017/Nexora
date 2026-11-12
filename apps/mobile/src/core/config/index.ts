// Environment configuration for the mobile app (defaults to the live AWS Free-Tier HTTPS API in ap-south-1).
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://13.207.60.47.sslip.io/api/v1';
