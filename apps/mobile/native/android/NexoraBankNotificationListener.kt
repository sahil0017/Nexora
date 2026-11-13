package com.nexora.voice.callerid

import android.app.Notification
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * Play-Protect-safe Android NotificationListenerService for bank & UPI alerts.
 * Only receives notifications after the user explicitly grants Notification Access
 * in Android System Settings.
 */
class NexoraBankNotificationListener : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn?.notification ?: return
        val extras = notification.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().trim()
        val text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()
            ?: extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty()
        val combined = listOf(title, text.trim()).filter { it.isNotEmpty() }.joinToString(": ")
        if (combined.isBlank()) return

        val lower = combined.lowercase()
        val isFinanceAlert = KEYWORDS.any { lower.contains(it) }
        if (!isFinanceAlert) return

        val prefs = applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_QUEUE, "[]") ?: "[]"
        val arr = try {
            JSONArray(raw)
        } catch (_: Throwable) {
            JSONArray()
        }

        val item = JSONObject().apply {
            put("sender", title.ifEmpty { sbn.packageName ?: "BANK" })
            put("body", combined)
            put("timestamp_ms", sbn.postTime)
        }
        arr.put(item)

        // Keep at most 50 recent buffered alerts
        val trimmed = JSONArray()
        val start = (arr.length() - 50).coerceAtLeast(0)
        for (i in start until arr.length()) {
            trimmed.put(arr.get(i))
        }
        prefs.edit().putString(KEY_QUEUE, trimmed.toString()).apply()
    }

    companion object {
        const val PREFS_NAME = "nexora_bank_notif_prefs"
        const val KEY_QUEUE = "queued_alerts"
        private val KEYWORDS = listOf(
            "debited", "credited", "upi", "rs.", "rs ", "inr", "a/c", "acct",
            "bank", "spent", "paid", "gpay", "phonepe", "paytm", "hdfc",
            "icici", "sbi", "axis", "kotak"
        )
    }
}
