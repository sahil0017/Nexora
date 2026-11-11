import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { colors } from '../theme/tokens';
import HomeScreen from '../../features/home/screens/HomeScreen';
import ExploreScreen from '../../features/explore/screens/ExploreScreen';
import AssistantScreen from '../../features/assistant/screens/AssistantScreen';
import ActivityScreen from '../../features/activity/screens/ActivityScreen';
import ProfileScreen from '../../features/profile/screens/ProfileScreen';

const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bgPrimary,
    card: colors.bgSurface,
    text: colors.textPrimary,
    primary: colors.accentPrimary,
    border: colors.borderSubtle,
  },
};

const icons: Record<string, string> = {
  Home: '◉',
  Explore: '▤',
  AI: '✦',
  Activity: '◷',
  Profile: '☺',
};

export default function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accentPrimary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: { backgroundColor: colors.bgSurface, borderTopColor: colors.borderSubtle },
        }}>
        <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: tabIcon('Home') }} />
        <Tab.Screen name="Explore" component={ExploreScreen} options={{ tabBarIcon: tabIcon('Explore') }} />
        <Tab.Screen name="AI" component={AssistantScreen} options={{ tabBarIcon: tabIcon('AI') }} />
        <Tab.Screen name="Activity" component={ActivityScreen} options={{ tabBarIcon: tabIcon('Activity') }} />
        <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: tabIcon('Profile') }} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function tabIcon(name: string) {
  return ({ color, size }: { color: string; size: number }) => (
    <Text style={{ fontSize: size, color }}>{icons[name]}</Text>
  );
}
