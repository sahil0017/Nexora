const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withAppBuildGradle,
  withGradleProperties,
  withMainApplication,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
  IOSConfig,
} = require('expo/config-plugins');

/**
 * Expo Config Plugin wiring NEXORA's native Swift (CoreMotion + HealthKit) &
 * Kotlin (SensorManager + Android Health Connect) modules during `expo prebuild` / `eas build`.
 */
module.exports = function withNexoraHealthSensors(config) {
  // 1. iOS Info.plist motion & HealthKit usage descriptions
  config = withInfoPlist(config, cfg => {
    cfg.modResults.NSMotionUsageDescription =
      cfg.modResults.NSMotionUsageDescription ||
      'NEXORA uses device motion sensors locally to detect sleep orientation and micro-motion with your consent.';
    cfg.modResults.NSHealthShareUsageDescription =
      cfg.modResults.NSHealthShareUsageDescription ||
      'NEXORA reads authorized sleep, heart-rate, and respiratory records from Apple Health.';
    cfg.modResults.NSHealthUpdateUsageDescription =
      cfg.modResults.NSHealthUpdateUsageDescription ||
      'NEXORA requests Apple Health read access for overnight physiological research.';
    return cfg;
  });

  // 2. iOS HealthKit entitlements
  config = withEntitlementsPlist(config, cfg => {
    cfg.modResults['com.apple.developer.healthkit'] = true;
    cfg.modResults['com.apple.developer.healthkit.access'] =
      cfg.modResults['com.apple.developer.healthkit.access'] || [];
    return cfg;
  });

  // 3. Android Manifest: motion + Health Connect permissions, queries, and rationale intent-filter
  config = withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const needed = [
      'android.permission.HIGH_SAMPLING_RATE_SENSORS',
      'android.permission.ACTIVITY_RECOGNITION',
      'android.permission.health.READ_HEART_RATE',
      'android.permission.health.READ_HEART_RATE_VARIABILITY',
      'android.permission.health.READ_RESPIRATORY_RATE',
      'android.permission.health.READ_SLEEP',
      'android.permission.health.READ_STEPS',
      'android.permission.health.READ_OXYGEN_SATURATION',
    ];
    for (const perm of needed) {
      const exists = manifest['uses-permission'].some(p => p.$?.['android:name'] === perm);
      if (!exists) {
        manifest['uses-permission'].push({ $: { 'android:name': perm } });
      }
    }

    manifest.queries = manifest.queries || [];
    const hasHcQuery = manifest.queries.some(q =>
      (q.package || []).some(pkg => pkg.$?.['android:name'] === 'com.google.android.apps.healthdata'),
    );
    if (!hasHcQuery) {
      manifest.queries.push({
        package: [{ $: { 'android:name': 'com.google.android.apps.healthdata' } }],
      });
    }

    const mainApp = manifest.application?.[0];
    const mainActivity = mainApp?.activity?.find(a => a.$?.['android:name'] === '.MainActivity');
    if (mainActivity) {
      mainActivity['intent-filter'] = mainActivity['intent-filter'] || [];
      const hasRationale = mainActivity['intent-filter'].some(f =>
        (f.action || []).some(act => act.$?.['android:name'] === 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE'),
      );
      if (!hasRationale) {
        mainActivity['intent-filter'].push({
          action: [{ $: { 'android:name': 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE' } }],
        });
      }
    }

    return cfg;
  });

  // 4. Android: Bump minSdkVersion to 26 (required by androidx.health.connect:connect-client)
  config = withGradleProperties(config, cfg => {
    const existing = cfg.modResults.find(
      item => item.type === 'property' && item.key === 'android.minSdkVersion',
    );
    if (existing) {
      existing.value = '26';
    } else {
      cfg.modResults.push({
        type: 'property',
        key: 'android.minSdkVersion',
        value: '26',
      });
    }
    return cfg;
  });

  // 4b. Android: Add androidx.health.connect:connect-client + coroutines to app/build.gradle
  config = withAppBuildGradle(config, cfg => {
    let contents = cfg.modResults.contents;
    if (!contents.includes('androidx.health.connect:connect-client')) {
      contents = contents.replace(
        'dependencies {',
        'dependencies {\n    implementation("androidx.health.connect:connect-client:1.1.0-alpha11")\n    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")',
      );
      cfg.modResults.contents = contents;
    }
    return cfg;
  });

  // 5. Android: Register NexoraHealthSensorsPackage in MainApplication.kt
  config = withMainApplication(config, cfg => {
    let contents = cfg.modResults.contents;
    if (!contents.includes('com.nexora.health.sensors.NexoraHealthSensorsPackage')) {
      contents = contents.replace(
        'import com.facebook.react.PackageList',
        'import com.facebook.react.PackageList\nimport com.nexora.health.sensors.NexoraHealthSensorsPackage',
      );
      contents = contents.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n              add(NexoraHealthSensorsPackage())',
      );
      cfg.modResults.contents = contents;
    }
    return cfg;
  });

  // 6. Android: Copy Kotlin sources
  config = withDangerousMod(config, [
    'android',
    cfg => {
      const targetDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/com/nexora/health/sensors',
      );
      fs.mkdirSync(targetDir, { recursive: true });
      for (const fname of [
        'NexoraHealthSensorsModule.kt',
        'NexoraHealthSensorsPackage.kt',
      ]) {
        const src = path.join(cfg.modRequest.projectRoot, 'native/android', fname);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(targetDir, fname));
        }
      }
      return cfg;
    },
  ]);

  // 7. iOS: Copy Swift/ObjC bridge sources into ios/<projectName>/NexoraHealthSensors
  config = withDangerousMod(config, [
    'ios',
    cfg => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
      const targetDir = path.join(cfg.modRequest.platformProjectRoot, projectName, 'NexoraHealthSensors');
      fs.mkdirSync(targetDir, { recursive: true });
      for (const fname of [
        'NexoraHealthSensorsModule.swift',
        'NexoraHealthSensorsBridge.m',
      ]) {
        const src = path.join(cfg.modRequest.projectRoot, 'native/ios', fname);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(targetDir, fname));
        }
      }
      return cfg;
    },
  ]);

  // 8. iOS: Link Swift/ObjC NativeModule bridge into main Xcode target
  config = withXcodeProject(config, cfg => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    const project = cfg.modResults;
    for (const fname of ['NexoraHealthSensorsModule.swift', 'NexoraHealthSensorsBridge.m']) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: path.join(projectName, 'NexoraHealthSensors', fname),
        groupName: projectName,
        project,
      });
    }
    return cfg;
  });

  return config;
};
