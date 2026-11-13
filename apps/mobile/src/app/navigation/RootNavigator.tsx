import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View } from 'react-native';
import { colors, fontFamily } from '../theme/tokens';
import { NavIcon, NavIconName } from '../../shared/components/NavIcons';
import HomeScreen from '../../features/home/screens/HomeScreen';
import ExploreScreen from '../../features/explore/screens/ExploreScreen';
import AssistantScreen from '../../features/assistant/screens/AssistantScreen';
import ProfileScreen from '../../features/profile/screens/ProfileScreen';
import MobilityNavigator from '../../features/move/MobilityNavigator';
import ModuleOverviewScreen from '../../features/explore/screens/ModuleOverviewScreen';
import DeepIntelligenceScreen from '../../features/explore/screens/DeepIntelligenceScreen';
import FinanceNavigator from '../../features/finance/FinanceNavigator';
import VoiceNavigator from '../../features/voice/VoiceNavigator';
import HealthNavigator from '../../features/health/HealthNavigator';
import PrivacyPermissionsScreen from '../../features/privacy/screens/PrivacyPermissionsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bgPrimary,
    card: colors.bgSurface,
    text: colors.textPrimary,
    primary: colors.navBlue,
    border: colors.borderSubtle,
  },
};

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.navBlue,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 10.5, fontWeight: '600', marginTop: 2 },
        tabBarStyle: {
          backgroundColor: '#081018',
          borderTopColor: colors.borderSubtle,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 7,
          paddingTop: 5,
        },
      }}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ tabBarIcon: tabIcon('Home') }} />
      <Tab.Screen name="Explore" component={ExploreScreen} options={{ tabBarIcon: tabIcon('Explore') }} />
      <Tab.Screen name="AI" component={AssistantScreen} options={{ tabBarIcon: tabIcon('AI'), title: 'Copilot' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarIcon: tabIcon('Profile') }} />
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="Mobility" component={MobilityNavigator} />
        <Stack.Screen name="Finance" component={FinanceNavigator} />
        <Stack.Screen name="Voice" component={VoiceNavigator} />
        <Stack.Screen name="Health" component={HealthNavigator} />
        <Stack.Screen name="PrivacyPermissions" component={PrivacyPermissionsScreen} />
        <Stack.Screen name="ModuleHub" component={ModuleOverviewScreen} />
        <Stack.Screen name="DeepIntelligence" component={DeepIntelligenceScreen} />
      </Stack.Navigator>
    </NavigationContainer>
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
