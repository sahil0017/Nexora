const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withMainApplication, withDangerousMod } = require('expo/config-plugins');

/**
 * Expo Config Plugin that automatically wires Nexora's Android CallScreeningService,
 * READ_CALL_LOG bridge module, and ReactPackage during `expo prebuild` / `eas build`.
 */
module.exports = function withNexoraCallerId(config) {
  config = withAndroidManifest(config, cfg => {
    const mainApp = cfg.modResults.manifest.application?.[0];
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

  return config;
};
