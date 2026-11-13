// Environment configuration for the mobile app (defaults to the live AWS Free-Tier HTTPS API in ap-south-1).
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ?? 'https://15.206.75.0.sslip.io/api/v1';
