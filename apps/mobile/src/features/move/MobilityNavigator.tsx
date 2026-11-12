import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import { colors, fontFamily } from '../../app/theme/tokens';
import { NavIcon, NavIconName } from '../../shared/components/NavIcons';
import JourneyPlannerScreen from './screens/JourneyPlannerScreen';
import ActivityScreen from '../activity/screens/ActivityScreen';
import MobilityPlacesScreen from './screens/MobilityPlacesScreen';
import MobilityPrefsScreen from './screens/MobilityPrefsScreen';

const Tab = createBottomTabNavigator();

/**
 * Dedicated NEXORA Mobility (MoveSmart) module workspace.
 * Clicking Mobility anywhere in NEXORA opens these four dedicated Mobility screens.
 */
export default function MobilityNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navBlue,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 10.5, fontWeight: '600', marginTop: 2 },
        tabBarStyle: {
          backgroundColor: '#081018',
          borderTopColor: colors.glassBorder,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 7,
          paddingTop: 5,
        },
      }}>
      <Tab.Screen
        name="Navigate"
        component={JourneyPlannerScreen}
        options={{ tabBarIcon: tabIcon('Navigate'), title: 'Navigate' }}
      />
      <Tab.Screen
        name="Radar"
        component={ActivityScreen}
        options={{ tabBarIcon: tabIcon('Radar'), title: 'Live Radar' }}
      />
      <Tab.Screen
        name="Places"
        component={MobilityPlacesScreen}
        options={{ tabBarIcon: tabIcon('Places'), title: 'Places' }}
      />
      <Tab.Screen
        name="MovePrefs"
        component={MobilityPrefsScreen}
        options={{ tabBarIcon: tabIcon('MovePrefs'), title: 'Move Prefs' }}
      />
    </Tab.Navigator>
  );
}

function tabIcon(name: NavIconName) {
  return ({ color, focused }: { color: string; size: number; focused: boolean }) => (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 4,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(29, 143, 225, 0.18)' : 'transparent',
      }}>
      <NavIcon name={name} color={color} />
    </View>
  );
}
