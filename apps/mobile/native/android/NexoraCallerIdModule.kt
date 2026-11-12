package com.nexora.voice.callerid

import android.Manifest
import android.app.role.RoleManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.CallLog
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * React Native bridge for Nexora's ₹0 Android CallScreeningService & local directory sync.
 */
class NexoraCallerIdModule(private val reactCtx: ReactApplicationContext) : ReactContextBaseJavaModule(reactCtx) {

    override fun getName(): String = "NexoraCallerIdModule"

    @ReactMethod
    fun syncCallerDirectory(entriesJson: String, promise: Promise) {
        try {
            reactCtx.getSharedPreferences(NexoraCallScreeningService.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(NexoraCallScreeningService.KEY_ENTRIES, entriesJson)
                .apply()
            promise.resolve(true)
        } catch (t: Throwable) {
            promise.reject("SYNC_ERR", t.message, t)
        }
    }

    @ReactMethod
    fun getPendingUnknownCaller(promise: Promise) {
        val raw = reactCtx.getSharedPreferences(NexoraCallScreeningService.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(NexoraCallScreeningService.KEY_PENDING_UNKNOWN, null)
        promise.resolve(raw)
    }

    @ReactMethod
    fun requestCallScreeningRole(promise: Promise) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            val out = Arguments.createMap().apply {
                putBoolean("supported", false)
                putBoolean("granted", false)
                putString("reason", "CallScreeningService requires Android 10 (API 29+)")
            }
            promise.resolve(out)
            return
        }
        val rm = reactCtx.getSystemService(Context.ROLE_SERVICE) as? RoleManager
        val held = rm?.isRoleHeld(RoleManager.ROLE_CALL_SCREENING) == true
        val out = Arguments.createMap().apply {
            putBoolean("supported", rm?.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING) == true)
            putBoolean("granted", held)
        }
        val act = currentActivity
        if (!held && act != null && rm != null && rm.isRoleAvailable(RoleManager.ROLE_CALL_SCREENING)) {
            act.startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_CALL_SCREENING), 9042)
        }
        promise.resolve(out)
    }

    @ReactMethod
    fun readDeviceCallLogs(limit: Int, promise: Promise) {
        if (ContextCompat.checkSelfPermission(reactCtx, Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            promise.reject("PERMISSION_DENIED", "READ_CALL_LOG permission is required to sync historic device calls")
            return
        }
        try {
            val maxRows = if (limit <= 0) 200 else limit.coerceAtMost(500)
            val result = Arguments.createArray()
            val projection = arrayOf(
                CallLog.Calls._ID,
                CallLog.Calls.NUMBER,
                CallLog.Calls.CACHED_NAME,
                CallLog.Calls.TYPE,
                CallLog.Calls.DURATION,
                CallLog.Calls.DATE,
            )
            val sortOrder = "${CallLog.Calls.DATE} DESC"
            reactCtx.contentResolver.query(CallLog.Calls.CONTENT_URI, projection, null, null, sortOrder)?.use { cursor ->
                val idIdx = cursor.getColumnIndex(CallLog.Calls._ID)
                val numIdx = cursor.getColumnIndex(CallLog.Calls.NUMBER)
                val nameIdx = cursor.getColumnIndex(CallLog.Calls.CACHED_NAME)
                val typeIdx = cursor.getColumnIndex(CallLog.Calls.TYPE)
                val durIdx = cursor.getColumnIndex(CallLog.Calls.DURATION)
                val dateIdx = cursor.getColumnIndex(CallLog.Calls.DATE)
                var count = 0
                while (cursor.moveToNext() && count < maxRows) {
                    val number = if (numIdx >= 0) cursor.getString(numIdx).orEmpty() else ""
                    if (number.isBlank()) continue
                    val rawType = if (typeIdx >= 0) cursor.getInt(typeIdx) else 0
                    val dir = when (rawType) {
                        CallLog.Calls.INCOMING_TYPE -> "inbound"
                        CallLog.Calls.OUTGOING_TYPE -> "outbound"
                        CallLog.Calls.MISSED_TYPE -> "missed"
                        CallLog.Calls.REJECTED_TYPE -> "rejected"
                        CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
                        else -> "unknown"
                    }
                    val row = Arguments.createMap().apply {
                        putString("device_call_id", if (idIdx >= 0) cursor.getString(idIdx).orEmpty() else "")
                        putString("phone_number", number)
                        putString("contact_name", if (nameIdx >= 0) cursor.getString(nameIdx).orEmpty() else "")
                        putString("direction", dir)
                        putInt("duration_sec", if (durIdx >= 0) cursor.getInt(durIdx) else 0)
                        putString("started_at", if (dateIdx >= 0) cursor.getLong(dateIdx).toString() else "")
                        putString("source", "device_call_log")
                    }
                    result.pushMap(row)
                    count++
                }
            }
            promise.resolve(result)
        } catch (t: Throwable) {
            promise.reject("CALL_LOG_ERR", t.message, t)
        }
    }
}
