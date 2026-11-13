package com.nexora.health.sensors

import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord
import androidx.health.connect.client.records.OxygenSaturationRecord
import androidx.health.connect.client.records.RespiratoryRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.temporal.ChronoUnit
import kotlin.math.abs
import kotlin.math.sqrt

class NexoraHealthSensorsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), SensorEventListener {

  private val sensorManager = reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val lock = Any()
  private val ringBuffer = ArrayDeque<Map<String, Any>>(1500)
  private val maxBufferSize = 1500
  private var lastGyro = floatArrayOf(0f, 0f, 0f)

  override fun getName(): String = "NexoraHealthSensors"

  @ReactMethod
  fun startCollection(rateHz: Double, promise: Promise) {
    val accel = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    if (accel == null) {
      promise.reject("NO_IMU", "Accelerometer unavailable on this Android device")
      return
    }
    val hz = rateHz.coerceIn(5.0, 50.0)
    val periodUs = (1_000_000.0 / hz).toInt()
    sensorManager.registerListener(this, accel, periodUs)
    sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)?.let { gyro ->
      sensorManager.registerListener(this, gyro, periodUs)
    }
    val out = Arguments.createMap().apply {
      putString("status", "started")
      putDouble("rate_hz", hz)
    }
    promise.resolve(out)
  }

  @ReactMethod
  fun stopCollection(promise: Promise) {
    sensorManager.unregisterListener(this)
    val out = Arguments.createMap().apply { putString("status", "stopped") }
    promise.resolve(out)
  }

  @ReactMethod
  fun drainFeatureBatch(promise: Promise) {
    val snapshot: List<Map<String, Any>>
    synchronized(lock) {
      snapshot = ringBuffer.toList()
    }
    if (snapshot.isEmpty()) {
      val empty = Arguments.createMap().apply {
        putInt("sample_count", 0)
        putString("device_orientation", "unknown")
        putDouble("actigraphy_rms", 0.0)
      }
      promise.resolve(empty)
      return
    }

    var sumAx = 0.0
    var sumAy = 0.0
    var sumAz = 0.0
    val mags = DoubleArray(snapshot.size)
    snapshot.forEachIndexed { idx, f ->
      val ax = (f["ax"] as? Double) ?: 0.0
      val ay = (f["ay"] as? Double) ?: 0.0
      val az = (f["az"] as? Double) ?: 9.81
      sumAx += ax; sumAy += ay; sumAz += az
      mags[idx] = sqrt(ax * ax + ay * ay + az * az)
    }
    val n = snapshot.size.toDouble()
    val mx = sumAx / n; val my = sumAy / n; val mz = sumAz / n
    val norm = maxOf(1e-4, sqrt(mx * mx + my * my + mz * mz))
    val gx = mx / norm; val gy = my / norm; val gz = mz / norm

    val orientation = when {
      abs(gy) > 0.72 -> "upright_device"
      gz > 0.65 -> "face_up_supine_proxy"
      gz < -0.65 -> "face_down_prone_proxy"
      gx > 0.55 -> "lateral_right_proxy"
      gx < -0.55 -> "lateral_left_proxy"
      else -> "face_up_supine_proxy"
    }

    val meanMag = mags.average()
    var sqSum = 0.0
    for (m in mags) sqSum += (m - meanMag) * (m - meanMag)
    val rms = sqrt(sqSum / n)

    val out = Arguments.createMap().apply {
      putInt("sample_count", snapshot.size)
      putString("device_orientation", orientation)
      putDouble("actigraphy_rms", rms)
      putDouble("device_timestamp_ms", ((snapshot.last()["timestamp_ms"] as? Long) ?: System.currentTimeMillis()).toDouble())
      putDouble("monotonic_ms", ((snapshot.last()["monotonic_ms"] as? Long) ?: SystemClock.elapsedRealtime()).toDouble())
    }
    promise.resolve(out)
  }

  @ReactMethod
  fun exportRawWaveformChunk(clearAfterExport: Boolean, promise: Promise) {
    val snapshot: List<Map<String, Any>>
    synchronized(lock) {
      snapshot = ringBuffer.toList()
      if (clearAfterExport) ringBuffer.clear()
    }
    val arr = Arguments.createArray()
    for (f in snapshot) {
      val m = Arguments.createMap().apply {
        putDouble("timestamp_ms", ((f["timestamp_ms"] as? Long) ?: 0L).toDouble())
        putDouble("monotonic_ms", ((f["monotonic_ms"] as? Long) ?: 0L).toDouble())
        putDouble("ax", (f["ax"] as? Double) ?: 0.0)
        putDouble("ay", (f["ay"] as? Double) ?: 0.0)
        putDouble("az", (f["az"] as? Double) ?: 9.81)
        putDouble("gx", (f["gx"] as? Double) ?: 0.0)
        putDouble("gy", (f["gy"] as? Double) ?: 0.0)
        putDouble("gz", (f["gz"] as? Double) ?: 0.0)
      }
      arr.pushMap(m)
    }
    promise.resolve(arr)
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (event.sensor.type == Sensor.TYPE_GYROSCOPE) {
      lastGyro = event.values.clone()
      return
    }
    if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) {
      val frame = mapOf<String, Any>(
        "timestamp_ms" to System.currentTimeMillis(),
        "monotonic_ms" to (event.timestamp / 1_000_000L),
        "ax" to event.values[0].toDouble(),
        "ay" to event.values[1].toDouble(),
        "az" to event.values[2].toDouble(),
        "gx" to lastGyro[0].toDouble(),
        "gy" to lastGyro[1].toDouble(),
        "gz" to lastGyro[2].toDouble()
      )
      synchronized(lock) {
        if (ringBuffer.size >= maxBufferSize) ringBuffer.removeFirst()
        ringBuffer.addLast(frame)
      }
    }
  }

  @ReactMethod
  fun getHealthBridgeStatus(promise: Promise) {
    val sdkStatus = HealthConnectClient.getSdkStatus(reactContext)
    val available = sdkStatus == HealthConnectClient.SDK_AVAILABLE
    val out = Arguments.createMap().apply {
      putString("source", "health_connect")
      putBoolean("available", available)
      putBoolean("background_delivery_supported", available)
    }
    promise.resolve(out)
  }

  @ReactMethod
  fun fetchAuthorizedWearableMetrics(hoursBack: Double, promise: Promise) {
    val sdkStatus = HealthConnectClient.getSdkStatus(reactContext)
    if (sdkStatus != HealthConnectClient.SDK_AVAILABLE) {
      val out = Arguments.createMap().apply {
        putString("signal_source", "health_connect")
        putBoolean("authorized", false)
        putString("measurement_status", "unavailable")
        putString("missing_reason", "health_connect_not_installed_or_update_required")
      }
      promise.resolve(out)
      return
    }

    val client = HealthConnectClient.getOrCreate(reactContext)
    val requiredPerms = setOf(
      HealthPermission.getReadPermission(HeartRateRecord::class),
      HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class),
      HealthPermission.getReadPermission(RespiratoryRateRecord::class),
      HealthPermission.getReadPermission(SleepSessionRecord::class),
      HealthPermission.getReadPermission(StepsRecord::class),
      HealthPermission.getReadPermission(OxygenSaturationRecord::class)
    )

    CoroutineScope(Dispatchers.IO).launch {
      try {
        val granted = client.permissionController.getGrantedPermissions()
        val hasHr = granted.contains(HealthPermission.getReadPermission(HeartRateRecord::class))
        if (!hasHr && granted.intersect(requiredPerms).isEmpty()) {
          // Open Health Connect permissions screen so the user can grant access on-device
          val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
          runCatching { reactContext.startActivity(intent) }

          val out = Arguments.createMap().apply {
            putString("signal_source", "health_connect")
            putBoolean("authorized", false)
            putString("measurement_status", "unavailable")
            putString("missing_reason", "health_connect_permission_required")
          }
          promise.resolve(out)
          return@launch
        }

        val end = Instant.now()
        val start = end.minus(hoursBack.toLong().coerceAtLeast(1L), ChronoUnit.HOURS)
        val range = TimeRangeFilter.between(start, end)

        var hrBpm: Double? = null
        if (hasHr) {
          val hrResp = client.readRecords(ReadRecordsRequest(HeartRateRecord::class, timeRangeFilter = range))
          hrBpm = hrResp.records.lastOrNull()?.samples?.lastOrNull()?.beatsPerMinute?.toDouble()
        }

        var hrvMs: Double? = null
        if (granted.contains(HealthPermission.getReadPermission(HeartRateVariabilityRmssdRecord::class))) {
          val hrvResp = client.readRecords(ReadRecordsRequest(HeartRateVariabilityRmssdRecord::class, timeRangeFilter = range))
          hrvMs = hrvResp.records.lastOrNull()?.heartRateVariabilityMillis
        }

        var respBpm: Double? = null
        if (granted.contains(HealthPermission.getReadPermission(RespiratoryRateRecord::class))) {
          val respResp = client.readRecords(ReadRecordsRequest(RespiratoryRateRecord::class, timeRangeFilter = range))
          respBpm = respResp.records.lastOrNull()?.rate
        }

        var stepsCount: Long? = null
        if (granted.contains(HealthPermission.getReadPermission(StepsRecord::class))) {
          val stepsResp = client.readRecords(ReadRecordsRequest(StepsRecord::class, timeRangeFilter = range))
          if (stepsResp.records.isNotEmpty()) {
            stepsCount = stepsResp.records.sumOf { it.count }
          }
        }

        var spo2Pct: Double? = null
        if (granted.contains(HealthPermission.getReadPermission(OxygenSaturationRecord::class))) {
          val spo2Resp = client.readRecords(ReadRecordsRequest(OxygenSaturationRecord::class, timeRangeFilter = range))
          spo2Pct = spo2Resp.records.lastOrNull()?.percentage?.value
        }

        var sleepHours: Double? = null
        var sleepDeepMin = 0.0
        var sleepRemMin = 0.0
        var sleepLightMin = 0.0
        var sleepStartIso: String? = null
        var sleepEndIso: String? = null
        if (granted.contains(HealthPermission.getReadPermission(SleepSessionRecord::class))) {
          val sleepResp = client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, timeRangeFilter = range))
          val latestSleep = sleepResp.records.lastOrNull()
          if (latestSleep != null) {
            val totalMin = ChronoUnit.MINUTES.between(latestSleep.startTime, latestSleep.endTime).coerceAtLeast(0L)
            sleepHours = totalMin / 60.0
            sleepStartIso = latestSleep.startTime.toString()
            sleepEndIso = latestSleep.endTime.toString()
            for (stage in latestSleep.stages) {
              val mins = ChronoUnit.MINUTES.between(stage.startTime, stage.endTime).coerceAtLeast(0L).toDouble()
              when (stage.stage) {
                SleepSessionRecord.STAGE_TYPE_DEEP -> sleepDeepMin += mins
                SleepSessionRecord.STAGE_TYPE_REM -> sleepRemMin += mins
                SleepSessionRecord.STAGE_TYPE_LIGHT -> sleepLightMin += mins
              }
            }
          }
        }

        val hasAny = hrBpm != null || hrvMs != null || respBpm != null || stepsCount != null || spo2Pct != null || sleepHours != null
        val out = Arguments.createMap().apply {
          putString("signal_source", "health_connect")
          putBoolean("authorized", true)
          if (hrBpm != null) putDouble("heart_rate_bpm", hrBpm)
          if (hrvMs != null) putDouble("hrv_rmssd_ms", hrvMs)
          if (respBpm != null) putDouble("respiratory_rate_bpm", respBpm)
          if (stepsCount != null) putDouble("steps_count", stepsCount.toDouble())
          if (spo2Pct != null) putDouble("spo2_pct", spo2Pct)
          if (sleepHours != null) {
            putDouble("sleep_duration_hours", sleepHours)
            putDouble("sleep_deep_minutes", sleepDeepMin)
            putDouble("sleep_rem_minutes", sleepRemMin)
            putDouble("sleep_light_minutes", sleepLightMin)
            if (sleepStartIso != null) putString("sleep_start_iso", sleepStartIso)
            if (sleepEndIso != null) putString("sleep_end_iso", sleepEndIso)
          }
          putString("measurement_status", if (hasAny) "measured" else "unavailable")
          if (!hasAny) putString("missing_reason", "no_recent_health_connect_samples")
        }
        promise.resolve(out)
      } catch (e: Exception) {
        val out = Arguments.createMap().apply {
          putString("signal_source", "health_connect")
          putBoolean("authorized", false)
          putString("measurement_status", "unavailable")
          putString("missing_reason", e.message ?: "health_connect_query_failed")
        }
        promise.resolve(out)
      }
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
