import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './navigation/RootNavigator';
import { fontFamily } from './theme/tokens';
import { BiometricLockGate } from '../core/security/BiometricLockGate';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 2 } },
});

export default function App() {
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const styleId = 'nexora-font-normalize';
      if (!document.getElementById(styleId)) {
        const el = document.createElement('style');
        el.id = styleId;
        el.textContent = `
          html, body, input, textarea, button, select {
            font-family: ${fontFamily.sans};
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
          }
        `;
        document.head.appendChild(el);
      }
    }
  }, []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <BiometricLockGate>
          <RootNavigator />
        </BiometricLockGate>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
