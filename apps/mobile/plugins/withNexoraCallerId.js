const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
  IOSConfig,
} = require('expo/config-plugins');

const IOS_APP_GROUP = 'group.ai.nexora.movesmart.callerid';

/**
 * Expo Config Plugin that automatically wires Nexora's Android CallScreeningService +
 * READ_CALL_LOG module AND iOS Contacts + CallKit CXCallObserver/AppGroup bridge during
 * `expo prebuild` / `eas build`.
 */
module.exports = function withNexoraCallerId(config) {
  // 1. Android: CallScreeningService manifest entry + READ_SMS permission
  config = withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const hasReadSms = manifest['uses-permission'].some(
      p => p.$?.['android:name'] === 'android.permission.READ_SMS',
    );
    if (!hasReadSms) {
      manifest['uses-permission'].push({
        $: { 'android:name': 'android.permission.READ_SMS' },
      });
    }
    const mainApp = manifest.application?.[0];
    if (mainApp) {
      mainApp.service = mainApp.service || [];
      const hasService = mainApp.service.some(
        s => s.$?.['android:name'] === 'com.nexora.voice.callerid.NexoraCallScreeningService',
      );
      if (!hasService) {
        mainApp.service.push({
          $: {
            'android:name': 'com.nexora.voice.callerid.NexoraCallScreeningService',
            'android:permission': 'android.permission.BIND_SCREENING_SERVICE',
            'android:exported': 'true',
          },
          'intent-filter': [
            {
              action: [{ $: { 'android:name': 'android.telecom.CallScreeningService' } }],
            },
          ],
        });
      }
    }
    return cfg;
  });

  // 2. Android: Register NexoraCallerIdPackage in MainApplication.kt
  config = withMainApplication(config, cfg => {
    let contents = cfg.modResults.contents;
    if (!contents.includes('com.nexora.voice.callerid.NexoraCallerIdPackage')) {
      contents = contents.replace(
        'import com.facebook.react.PackageList',
        'import com.facebook.react.PackageList\nimport com.nexora.voice.callerid.NexoraCallerIdPackage',
      );
      contents = contents.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n              add(NexoraCallerIdPackage())',
      );
      cfg.modResults.contents = contents;
    }
    return cfg;
  });

  // 3. Android: Copy Kotlin sources
  config = withDangerousMod(config, [
    'android',
    cfg => {
      const targetDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java/com/nexora/voice/callerid',
      );
      fs.mkdirSync(targetDir, { recursive: true });
      for (const fname of [
        'NexoraCallScreeningService.kt',
        'NexoraCallerIdModule.kt',
        'NexoraCallerIdPackage.kt',
      ]) {
        const src = path.join(cfg.modRequest.projectRoot, 'native/android', fname);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(targetDir, fname));
        }
      }
      return cfg;
    },
  ]);

  // 4. iOS: App Group entitlement for sharing Caller Directory entries with CallDirectory extension
  config = withEntitlementsPlist(config, cfg => {
    const groups = Array.isArray(cfg.modResults['com.apple.security.application-groups'])
      ? cfg.modResults['com.apple.security.application-groups']
      : [];
    if (!groups.includes(IOS_APP_GROUP)) {
      cfg.modResults['com.apple.security.application-groups'] = [...groups, IOS_APP_GROUP];
    }
    return cfg;
  });

  // 5. iOS: Copy native Swift/ObjC Contacts + CallKit bridge files into ios/<projectName>/NexoraCallerId
  config = withDangerousMod(config, [
    'ios',
    cfg => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
      const targetDir = path.join(cfg.modRequest.platformProjectRoot, projectName, 'NexoraCallerId');
      fs.mkdirSync(targetDir, { recursive: true });
      for (const fname of [
        'NexoraCallDirectoryHandler.swift',
        'NexoraCallerIdBridge.swift',
        'NexoraCallerIdBridge.m',
      ]) {
        const src = path.join(cfg.modRequest.projectRoot, 'native/ios', fname);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(targetDir, fname));
        }
      }
      return cfg;
    },
  ]);

  // 6. iOS: Link Swift/ObjC NativeModule bridge into main Xcode target
  config = withXcodeProject(config, cfg => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(cfg.modRequest.projectRoot);
    const project = cfg.modResults;
    for (const fname of ['NexoraCallDirectoryHandler.swift', 'NexoraCallerIdBridge.swift', 'NexoraCallerIdBridge.m']) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: path.join(projectName, 'NexoraCallerId', fname),
        groupName: projectName,
        project,
      });
    }
    return cfg;
  });

  return config;
};
