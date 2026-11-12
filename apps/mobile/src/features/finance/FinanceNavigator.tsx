import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import { colors, moduleColors } from '../../app/theme/tokens';
import { NavIcon, NavIconName } from '../../shared/components/NavIcons';
import { FinanceProvider } from './FinanceContext';
import FinanceOverviewScreen from './screens/FinanceOverviewScreen';
import FinanceLedgerScreen from './screens/FinanceLedgerScreen';
import FinanceWealthScreen from './screens/FinanceWealthScreen';
import FinanceLabScreen from './screens/FinanceLabScreen';
import FinanceCFOScreen from './screens/FinanceCFOScreen';

const Tab = createBottomTabNavigator();

/**
 * Dedicated NEXORA Finance Intelligence module workspace.
 * Mirrors MobilityNavigator by separating Overview, Ledger, Wealth, Quant Lab,
 * and AI CFO into crisp, uncluttered screens.
 */
export default function FinanceNavigator() {
  return (
    <FinanceProvider>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: moduleColors.finance,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700', marginTop: 2 },
          tabBarStyle: {
            backgroundColor: '#081018',
            borderTopColor: 'rgba(163, 230, 53, 0.22)',
            borderTopWidth: 1,
            height: 64,
            paddingBottom: 8,
            paddingTop: 6,
          },
        }}>
        <Tab.Screen
          name="FinTwin"
          component={FinanceOverviewScreen}
          options={{ tabBarIcon: tabIcon('FinTwin'), title: 'Twin' }}
        />
        <Tab.Screen
          name="FinLedger"
          component={FinanceLedgerScreen}
          options={{ tabBarIcon: tabIcon('FinLedger'), title: 'Ledger' }}
        />
        <Tab.Screen
          name="FinWealth"
          component={FinanceWealthScreen}
          options={{ tabBarIcon: tabIcon('FinWealth'), title: 'Wealth' }}
        />
        <Tab.Screen
          name="FinLab"
          component={FinanceLabScreen}
          options={{ tabBarIcon: tabIcon('FinLab'), title: 'Tax & Lab' }}
        />
        <Tab.Screen
          name="FinCFO"
          component={FinanceCFOScreen}
          options={{ tabBarIcon: tabIcon('FinCFO'), title: 'AI CFO' }}
        />
      </Tab.Navigator>
    </FinanceProvider>
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
        backgroundColor: focused ? 'rgba(163, 230, 53, 0.16)' : 'transparent',
      }}>
      <NavIcon name={name} color={color} />
    </View>
  );
}
