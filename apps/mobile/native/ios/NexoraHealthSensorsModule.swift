import Foundation
import CoreMotion
import HealthKit
import React

@objc(NexoraHealthSensors)
class NexoraHealthSensors: NSObject {
  private let motionManager = CMMotionManager()
  private let queue = OperationQueue()
  private let lock = NSLock()
  private var ringBuffer: [[String: Any]] = []
  private let maxBufferSize = 1500 // 60s @ 25 Hz
  private var isCollecting = false

  override init() {
    super.init()
    queue.name = "ai.nexora.health.sensors"
    queue.maxConcurrentOperationCount = 1
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc
  func startCollection(_ rateHz: Double, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard motionManager.isAccelerometerAvailable else {
      reject("NO_IMU", "CoreMotion accelerometer unavailable on this device", nil)
      return
    }
    let hz = max(5.0, min(rateHz, 50.0))
    motionManager.accelerometerUpdateInterval = 1.0 / hz
    motionManager.gyroUpdateInterval = 1.0 / hz

    if motionManager.isGyroAvailable {
      motionManager.startGyroUpdates()
    }
    motionManager.startAccelerometerUpdates(to: queue) { [weak self] data, error in
      guard let self = self, let acc = data, error == nil else { return }
      let gyro = self.motionManager.gyroData?.rotationRate
      let frame: [String: Any] = [
        "timestamp_ms": Int64(Date().timeIntervalSince1970 * 1000.0),
        "monotonic_ms": Int64(ProcessInfo.processInfo.systemUptime * 1000.0),
        "ax": acc.acceleration.x * 9.81,
        "ay": acc.acceleration.y * 9.81,
        "az": acc.acceleration.z * 9.81,
        "gx": gyro?.x ?? 0.0,
        "gy": gyro?.y ?? 0.0,
        "gz": gyro?.z ?? 0.0
      ]
      self.lock.lock()
      self.ringBuffer.append(frame)
      if self.ringBuffer.count > self.maxBufferSize {
        self.ringBuffer.removeFirst(self.ringBuffer.count - self.maxBufferSize)
      }
      self.lock.unlock()
    }
    isCollecting = true
    resolve(["status": "started", "rate_hz": hz])
  }

  @objc
  func stopCollection(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    motionManager.stopAccelerometerUpdates()
    motionManager.stopGyroUpdates()
    isCollecting = false
    resolve(["status": "stopped"])
  }

  @objc
  func drainFeatureBatch(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    lock.lock()
    let snapshot = ringBuffer
    lock.unlock()

    guard !snapshot.isEmpty else {
      resolve(["sample_count": 0, "device_orientation": "unknown", "actigraphy_rms": 0.0])
      return
    }

    var sumAx = 0.0, sumAy = 0.0, sumAz = 0.0
    var mags: [Double] = []
    mags.reserveCapacity(snapshot.count)
    for f in snapshot {
      let ax = f["ax"] as? Double ?? 0.0
      let ay = f["ay"] as? Double ?? 0.0
      let az = f["az"] as? Double ?? 9.81
      sumAx += ax; sumAy += ay; sumAz += az
      mags.append(sqrt(ax * ax + ay * ay + az * az))
    }
    let n = Double(snapshot.count)
    let mx = sumAx / n, my = sumAy / n, mz = sumAz / n
    let norm = max(1e-4, sqrt(mx * mx + my * my + mz * mz))
    let gx = mx / norm, gy = my / norm, gz = mz / norm

    var orientation = "face_up_supine_proxy"
    if abs(gy) > 0.72 { orientation = "upright_device" }
    else if gz > 0.65 { orientation = "face_up_supine_proxy" }
    else if gz < -0.65 { orientation = "face_down_prone_proxy" }
    else if gx > 0.55 { orientation = "lateral_right_proxy" }
    else if gx < -0.55 { orientation = "lateral_left_proxy" }

    let meanMag = mags.reduce(0.0, +) / n
    let rms = sqrt(mags.reduce(0.0) { $0 + ($1 - meanMag) * ($1 - meanMag) } / n)

    resolve([
      "sample_count": snapshot.count,
      "device_orientation": orientation,
      "actigraphy_rms": rms,
      "device_timestamp_ms": snapshot.last?["timestamp_ms"] ?? Int64(Date().timeIntervalSince1970 * 1000.0),
      "monotonic_ms": snapshot.last?["monotonic_ms"] ?? Int64(ProcessInfo.processInfo.systemUptime * 1000.0)
    ])
  }

  @objc
  func exportRawWaveformChunk(_ clearAfterExport: Bool, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    lock.lock()
    let snapshot = ringBuffer
    if clearAfterExport {
      ringBuffer.removeAll()
    }
    lock.unlock()
    resolve(snapshot)
  }

  @objc
  func getHealthBridgeStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve([
      "source": "healthkit",
      "available": HKHealthStore.isHealthDataAvailable(),
      "background_delivery_supported": HKHealthStore.isHealthDataAvailable()
    ])
  }

  @objc
  func fetchAuthorizedWearableMetrics(_ hoursBack: Double, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard HKHealthStore.isHealthDataAvailable() else {
      resolve([
        "signal_source": "healthkit",
        "authorized": false,
        "measurement_status": "unavailable",
        "missing_reason": "healthkit_unavailable_on_device"
      ])
      return
    }
    let store = HKHealthStore()
    guard let hrType = HKObjectType.quantityType(forIdentifier: .heartRate),
          let hrvType = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN),
          let respType = HKObjectType.quantityType(forIdentifier: .respiratoryRate) else {
      resolve([
        "signal_source": "healthkit",
        "authorized": false,
        "measurement_status": "unavailable",
        "missing_reason": "healthkit_types_unsupported"
      ])
      return
    }
    let readTypes: Set<HKObjectType> = [hrType, hrvType, respType]
    store.requestAuthorization(toShare: nil, read: readTypes) { success, _ in
      if !success {
        resolve([
          "signal_source": "healthkit",
          "authorized": false,
          "measurement_status": "unavailable",
          "missing_reason": "healthkit_permission_denied"
        ])
        return
      }
      let start = Date().addingTimeInterval(-max(1.0, hoursBack) * 3600.0)
      let pred = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
      let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
      let group = DispatchGroup()

      var bpm: Double? = nil
      var hrvMs: Double? = nil
      var respBpm: Double? = nil

      group.enter()
      store.execute(HKSampleQuery(sampleType: hrType, predicate: pred, limit: 1, sortDescriptors: [sort]) { _, samples, _ in
        if let s = samples?.first as? HKQuantitySample {
          bpm = s.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        }
        group.leave()
      })

      group.enter()
      store.execute(HKSampleQuery(sampleType: hrvType, predicate: pred, limit: 1, sortDescriptors: [sort]) { _, samples, _ in
        if let s = samples?.first as? HKQuantitySample {
          hrvMs = s.quantity.doubleValue(for: HKUnit.secondUnit(with: .milli))
        }
        group.leave()
      })

      group.enter()
      store.execute(HKSampleQuery(sampleType: respType, predicate: pred, limit: 1, sortDescriptors: [sort]) { _, samples, _ in
        if let s = samples?.first as? HKQuantitySample {
          respBpm = s.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
        }
        group.leave()
      })

      group.notify(queue: .main) {
        let hasAny = bpm != nil || hrvMs != nil || respBpm != nil
        resolve([
          "signal_source": "healthkit",
          "authorized": true,
          "heart_rate_bpm": bpm as Any,
          "hrv_rmssd_ms": hrvMs as Any,
          "respiratory_rate_bpm": respBpm as Any,
          "measurement_status": hasAny ? "measured" : "unavailable",
          "missing_reason": hasAny ? NSNull() : "no_recent_healthkit_samples"
        ])
      }
    }
  }
}
