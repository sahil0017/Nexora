package com.nexora.voice.callerid

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.telecom.Call
import android.telecom.CallScreeningService
import androidx.annotation.RequiresApi
import androidx.core.app.NotificationCompat
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/**
 * ₹0-cost Native Android CallScreeningService (API 29+).
 *
 * Dynamically intercepts incoming/outgoing call handles before ring completion,
 * computes a privacy-preserving SHA-256 hash (`nexora.phone:<normalized>`),
 * checks the locally synced Nexora Caller Intelligence directory, displays
 * Caller Context / Business Intelligence / Spam Pattern alerts, and logs call metadata
 * so recordings never need a spoken greeting to identify who called.
 */
@RequiresApi(Build.VERSION_CODES.Q)
class NexoraCallScreeningService : CallScreeningService() {

    override fun onScreenCall(callDetails: Call.Details) {
        val rawNumber = callDetails.handle?.schemeSpecificPart.orEmpty()
        val phoneHash = sha256Phone(rawNumber)
        val cached = lookupLocalDirectory(applicationContext, phoneHash)

        val responseBuilder = CallResponse.Builder()
            .setDisallowCall(false)
            .setRejectCall(false)
            .setSilenceCall(false)
            .setSkipNotification(false)

        if (cached != null) {
            val name = cached.optString("display_name", "")
            val relation = cached.optString("relationship_label", "unknown")
            val business = cached.optString("organization", cached.optString("business_category", ""))
            val spamRisk = cached.optString("spam_risk", "low")
            val conflict = cached.optBoolean("identity_conflict", false)

            val headline = if (spamRisk == "high") {
                "Suspected Spam: ${name.ifBlank { cached.optString("phone_masked", "Unknown") }}"
            } else {
                name.ifBlank { "Identified Caller" }
            }
            val detail = buildString {
                if (relation != "unknown") append("Relation: $relation")
                if (business.isNotBlank()) append(if (isNotEmpty()) " · $business" else business)
                if (conflict) append(if (isNotEmpty()) " · Identity Conflict Flagged" else "Identity Conflict Flagged")
            }.ifBlank { "Nexora Caller Intelligence" }

            postCallerNotification(headline, detail)
        } else if (rawNumber.isNotBlank()) {
            // Queue post-call classification prompt for unknown numbers
            savePendingUnknown(applicationContext, rawNumber, phoneHash)
            postCallerNotification("Unknown Number Screened", "Tap after call to classify caller & link transcript.")
        }

        respondToCall(callDetails, responseBuilder.build())
    }

    private fun postCallerNotification(title: String, body: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val channelId = "nexora_caller_intel"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Nexora Caller Intelligence", NotificationManager.IMPORTANCE_HIGH)
            nm.createNotificationChannel(channel)
        }
        val notif = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .build()
        nm.notify(phoneNotificationId(title), notif)
    }

    companion object {
        const val PREFS_NAME = "nexora_caller_directory_prefs"
        const val KEY_ENTRIES = "entries_json"
        const val KEY_PENDING_UNKNOWN = "pending_unknown"

        fun sha256Phone(raw: String): String {
            val clean = buildString {
                raw.trim().forEachIndexed { idx, ch ->
                    if (ch in '0'..'9' || (ch == '+' && idx == 0)) append(ch)
                }
            }
            if (clean.isEmpty()) return ""
            val digest = MessageDigest.getInstance("SHA-256").digest("nexora.phone:$clean".toByteArray(Charsets.UTF_8))
            return digest.joinToString("") { "%02x".format(it) }
        }

        fun lookupLocalDirectory(ctx: Context, phoneHash: String): JSONObject? {
            if (phoneHash.isEmpty()) return null
            val raw = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString(KEY_ENTRIES, "[]") ?: "[]"
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                if (obj.optString("phone_hash") == phoneHash) return obj
            }
            return null
        }

        fun savePendingUnknown(ctx: Context, rawNumber: String, phoneHash: String) {
            val obj = JSONObject()
                .put("phone_hash", phoneHash)
                .put("last_digits", rawNumber.takeLast(4))
                .put("seen_at", System.currentTimeMillis())
            ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_PENDING_UNKNOWN, obj.toString())
                .apply()
        }

        private fun phoneNotificationId(title: String): Int = 4100 + (title.hashCode() and 0x0FFF)
    }
}
