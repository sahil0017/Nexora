import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import { colors, fontFamily, moduleColors } from '../../app/theme/tokens';
import { NavIcon, NavIconName } from '../../shared/components/NavIcons';
import { VoiceProvider } from './VoiceContext';
import VoiceOverviewScreen from './screens/VoiceOverviewScreen';
import VoiceTranscriptScreen from './screens/VoiceTranscriptScreen';
import VoiceMemoryScreen from './screens/VoiceMemoryScreen';
import VoiceActionsScreen from './screens/VoiceActionsScreen';
import VoiceEvidenceScreen from './screens/VoiceEvidenceScreen';

const Tab = createBottomTabNavigator();

export default function VoiceNavigator() {
  return (
    <VoiceProvider>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: moduleColors.voice,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 10.5, fontWeight: '600', marginTop: 2 },
          tabBarStyle: {
            backgroundColor: '#081018',
            borderTopColor: 'rgba(167, 139, 250, 0.25)',
            borderTopWidth: 1,
            height: 60,
            paddingBottom: 7,
            paddingTop: 5,
          },
        }}>
        <Tab.Screen
          name="VoiceCapture"
          component={VoiceOverviewScreen}
          options={{ tabBarIcon: tabIcon('VoiceCapture'), title: 'Library' }}
        />
        <Tab.Screen
          name="VoiceTranscript"
          component={VoiceTranscriptScreen}
          options={{ tabBarIcon: tabIcon('VoiceTranscript'), title: 'Transcript' }}
        />
        <Tab.Screen
          name="VoiceMemory"
          component={VoiceMemoryScreen}
          options={{ tabBarIcon: tabIcon('VoiceMemory'), title: 'Ask AI' }}
        />
        <Tab.Screen
          name="VoiceActions"
          component={VoiceActionsScreen}
          options={{ tabBarIcon: tabIcon('VoiceActions'), title: 'Follow-ups' }}
        />
        <Tab.Screen
          name="VoiceEvidence"
          component={VoiceEvidenceScreen}
          options={{ tabBarIcon: tabIcon('VoiceEvidence'), title: 'Records' }}
        />
      </Tab.Navigator>
    </VoiceProvider>
  );
}

function tabIcon(name: NavIconName) {
  return ({ color, focused }: { color: string; size: number; focused: boolean }) => (
    <View
      style={{
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(167, 139, 250, 0.16)' : 'transparent',
      }}>
      <NavIcon name={name} color={color} />
    </View>
  );
}
