import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View } from 'react-native';
import { colors, fontFamily, moduleColors } from '../../app/theme/tokens';
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
          tabBarLabelStyle: { fontFamily: fontFamily.medium, fontSize: 10.5, fontWeight: '600', marginTop: 2 },
          tabBarStyle: {
            backgroundColor: '#081018',
            borderTopColor: 'rgba(163, 230, 53, 0.22)',
            borderTopWidth: 1,
            height: 60,
            paddingBottom: 7,
            paddingTop: 5,
          },
        }}>
        <Tab.Screen
          name="FinTwin"
          component={FinanceOverviewScreen}
          options={{ tabBarIcon: tabIcon('FinTwin'), title: 'Overview' }}
        />
        <Tab.Screen
          name="FinLedger"
          component={FinanceLedgerScreen}
          options={{ tabBarIcon: tabIcon('FinLedger'), title: 'Accounts' }}
        />
        <Tab.Screen
          name="FinWealth"
          component={FinanceWealthScreen}
          options={{ tabBarIcon: tabIcon('FinWealth'), title: 'Portfolio' }}
        />
        <Tab.Screen
          name="FinLab"
          component={FinanceLabScreen}
          options={{ tabBarIcon: tabIcon('FinLab'), title: 'Tax & Plan' }}
        />
        <Tab.Screen
          name="FinCFO"
          component={FinanceCFOScreen}
          options={{ tabBarIcon: tabIcon('FinCFO'), title: 'Advisor' }}
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
