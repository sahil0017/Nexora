import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HealthHubScreen from './screens/HealthHubScreen';
import SleepClearanceScreen from './screens/SleepClearanceScreen';
import SensorStreamScreen from './screens/SensorStreamScreen';
import MriValidationScreen from './screens/MriValidationScreen';

export type HealthStackParamList = {
  HealthHub: undefined;
  SleepClearance: undefined;
  SensorStream: undefined;
  MriValidation: undefined;
};

const Stack = createNativeStackNavigator<HealthStackParamList>();

export default function HealthNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
      <Stack.Screen name="HealthHub" component={HealthHubScreen} />
      <Stack.Screen name="SleepClearance" component={SleepClearanceScreen} />
      <Stack.Screen name="SensorStream" component={SensorStreamScreen} />
      <Stack.Screen name="MriValidation" component={MriValidationScreen} />
    </Stack.Navigator>
  );
}
