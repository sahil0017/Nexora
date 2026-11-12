import React from 'react';
import { StyleSheet, View } from 'react-native';

export type NavIconName =
  | 'Home'
  | 'Explore'
  | 'AI'
  | 'Profile'
  | 'Navigate'
  | 'Radar'
  | 'Places'
  | 'MovePrefs'
  | 'FinTwin'
  | 'FinLedger'
  | 'FinWealth'
  | 'FinLab'
  | 'FinCFO'
  | 'VoiceCapture'
  | 'VoiceTranscript'
  | 'VoiceMemory'
  | 'VoiceActions'
  | 'VoiceEvidence';

/**
 * Pure React Native geometric navigation icons — zero external font or Unicode glyph dependencies,
 * guaranteeing consistent crisp rendering across iOS, Android, and Web.
 */
export function NavIcon({ name, color }: { name: NavIconName; color: string }) {
  switch (name) {
    case 'Home':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: 9,
              borderRightWidth: 9,
              borderBottomWidth: 8,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
            }}
          />
          <View
            style={{
              width: 13,
              height: 9,
              borderWidth: 2,
              borderTopWidth: 0,
              borderColor: color,
              borderBottomLeftRadius: 2,
              borderBottomRightRadius: 2,
            }}
          />
        </View>
      );

    case 'Explore':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 1,
                backgroundColor: color,
                transform: [{ rotate: '45deg' }],
              }}
            />
          </View>
        </View>
      );

    case 'AI':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              borderWidth: 2,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'Profile':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              borderWidth: 2,
              borderColor: color,
              marginBottom: 2,
            }}
          />
          <View
            style={{
              width: 14,
              height: 7,
              borderTopLeftRadius: 7,
              borderTopRightRadius: 7,
              borderWidth: 2,
              borderBottomWidth: 0,
              borderColor: color,
            }}
          />
        </View>
      );

    case 'Navigate':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 0,
              height: 0,
              borderLeftWidth: 7,
              borderRightWidth: 7,
              borderBottomWidth: 16,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
              transform: [{ rotate: '28deg' }],
            }}
          />
        </View>
      );

    case 'Radar':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              borderWidth: 1.8,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                borderWidth: 1.5,
                borderColor: color,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <View style={{ width: 3.5, height: 3.5, borderRadius: 2, backgroundColor: color }} />
            </View>
          </View>
        </View>
      );

    case 'Places':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 13,
              height: 13,
              borderRadius: 7,
              borderBottomRightRadius: 1,
              borderWidth: 2,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'MovePrefs':
      return (
        <View style={[styles.box, { justifyContent: 'space-evenly', paddingVertical: 1 }]}>
          {[2, 9, 4].map((offset, idx) => (
            <View key={idx} style={{ width: 16, height: 6, justifyContent: 'center' }}>
              <View style={{ width: 16, height: 2, backgroundColor: color, borderRadius: 1 }} />
              <View
                style={{
                  position: 'absolute',
                  left: offset,
                  width: 5,
                  height: 5,
                  borderRadius: 3,
                  backgroundColor: color,
                }}
              />
            </View>
          ))}
        </View>
      );

    case 'FinTwin':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 5,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'FinLedger':
      return (
        <View style={[styles.box, { justifyContent: 'space-evenly', paddingVertical: 2 }]}>
          <View style={{ width: 16, height: 2.5, borderRadius: 2, backgroundColor: color }} />
          <View style={{ width: 12, height: 2.5, borderRadius: 2, backgroundColor: color, alignSelf: 'flex-start', marginLeft: 3 }} />
          <View style={{ width: 16, height: 2.5, borderRadius: 2, backgroundColor: color }} />
        </View>
      );

    case 'FinWealth':
      return (
        <View style={[styles.box, { flexDirection: 'row', alignItems: 'flex-end', gap: 3, paddingBottom: 2 }]}>
          <View style={{ width: 4, height: 7, borderRadius: 2, backgroundColor: color }} />
          <View style={{ width: 4, height: 12, borderRadius: 2, backgroundColor: color }} />
          <View style={{ width: 4, height: 16, borderRadius: 2, backgroundColor: color }} />
        </View>
      );

    case 'FinLab':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 15,
              height: 15,
              borderRadius: 4,
              borderWidth: 2,
              borderColor: color,
              transform: [{ rotate: '45deg' }],
            }}
          />
        </View>
      );

    case 'FinCFO':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 17,
              height: 14,
              borderRadius: 6,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'VoiceCapture':
      return (
        <View style={[styles.box, { flexDirection: 'row', alignItems: 'center', gap: 2.5 }]}>
          <View style={{ width: 3, height: 8, borderRadius: 1.5, backgroundColor: color }} />
          <View style={{ width: 3, height: 15, borderRadius: 1.5, backgroundColor: color }} />
          <View style={{ width: 3, height: 10, borderRadius: 1.5, backgroundColor: color }} />
          <View style={{ width: 3, height: 13, borderRadius: 1.5, backgroundColor: color }} />
        </View>
      );

    case 'VoiceTranscript':
      return (
        <View style={[styles.box, { justifyContent: 'space-evenly', paddingVertical: 2 }]}>
          <View style={{ width: 16, height: 2.5, borderRadius: 2, backgroundColor: color }} />
          <View style={{ width: 13, height: 2.5, borderRadius: 2, backgroundColor: color, alignSelf: 'flex-start', marginLeft: 3 }} />
          <View style={{ width: 15, height: 2.5, borderRadius: 2, backgroundColor: color }} />
        </View>
      );

    case 'VoiceMemory':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 16,
              height: 16,
              borderRadius: 8,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'VoiceActions':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 15,
              height: 15,
              borderRadius: 4,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View style={{ width: 7, height: 2.5, borderRadius: 1.5, backgroundColor: color }} />
          </View>
        </View>
      );

    case 'VoiceEvidence':
      return (
        <View style={styles.box}>
          <View
            style={{
              width: 14,
              height: 16,
              borderRadius: 4,
              borderWidth: 2,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View style={{ width: 5, height: 5, borderRadius: 1, backgroundColor: color }} />
          </View>
        </View>
      );
  }
}

const styles = StyleSheet.create({
  box: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
