package app.logbook.reminders

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.logbook.LogbookApp
import app.logbook.MainActivity
import app.logbook.R
import app.logbook.core.model.ZoneIds
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * D10: local reminders. A daily worker looks for people whose due date has
 * passed (one notification per person, once per day), and the notification
 * carries Open, Snooze a week and Mark contacted. Mark contacted logs a real
 * `met` event through the outbox, so it reaches the Sheet like any capture.
 *
 * Nothing here is a server: no email, no push, no analytics.
 */
object Reminders {

    const val CHANNEL_ID = "contact_reminders"
    const val EXTRA_REF = "ref"
    const val EXTRA_NAME = "name"
    const val ACTION_SNOOZE = "app.logbook.action.SNOOZE"
    const val ACTION_MET = "app.logbook.action.MET"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ID,
                context.getString(R.string.reminders_channel_name),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = context.getString(R.string.reminders_channel_desc)
                setShowBadge(true)
            },
        )
    }

    fun canNotify(context: Context): Boolean =
        NotificationManagerCompat.from(context).areNotificationsEnabled() &&
            (android.os.Build.VERSION.SDK_INT < 33 ||
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED)

    /** One notification for one person. [daysPast] is how long the reminder is overdue. */
    fun post(context: Context, ref: String, name: String, daysPast: Long, intervalDays: Int) {
        if (!canNotify(context)) return
        ensureChannel(context)

        val open = PendingIntent.getActivity(
            context,
            ref.hashCode(),
            Intent(context, MainActivity::class.java).setData(
                Uri.parse("logbook://person/${Uri.encode(ref)}"),
            ),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val snooze = PendingIntent.getBroadcast(
            context,
            ref.hashCode() + 1,
            Intent(context, ReminderActionReceiver::class.java)
                .setAction(ACTION_SNOOZE)
                .putExtra(EXTRA_REF, ref)
                .putExtra(EXTRA_NAME, name),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val met = PendingIntent.getBroadcast(
            context,
            ref.hashCode() + 2,
            Intent(context, ReminderActionReceiver::class.java)
                .setAction(ACTION_MET)
                .putExtra(EXTRA_REF, ref)
                .putExtra(EXTRA_NAME, name),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val text = when {
            daysPast >= 1 -> "$daysPast days past your ${intervalDays}-day reminder."
            else -> "Your ${intervalDays}-day reminder is due."
        }

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_fg)
            .setContentTitle(name.ifBlank { "Someone to reach out to" })
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$text Tap to open, or log that you have been in touch."))
            .setContentIntent(open)
            .setAutoCancel(true)
            .addAction(0, "Open", open)
            .addAction(0, "Snooze a week", snooze)
            .addAction(0, "Mark contacted", met)
            .build()

        runCatching { NotificationManagerCompat.from(context).notify(ref.hashCode(), notification) }
    }
}

/** The daily check. One notification per due person, at most once a day each. */
class ReminderWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? LogbookApp ?: return Result.failure()
        if (!Reminders.canNotify(app)) return Result.success()

        val now = System.currentTimeMillis()
        val zone: ZoneId = ZoneIds.zone
        val day = LocalDate.now(zone).toString()
        val due = app.repo.duePeople(now, zone)
        if (due.isEmpty()) return Result.success()

        val already = app.repo.alreadyNotified(day)
        due.filter { it.ref !in already }
            .take(MAX_PER_DAY)
            .forEach { item ->
                val view = app.repo.reminderView(item, now)
                Reminders.post(
                    context = app,
                    ref = item.ref,
                    name = item.title,
                    daysPast = view.pastDays ?: 0,
                    intervalDays = view.intervalDays ?: 0,
                )
                app.repo.markNotified(day, item.ref)
            }
        return Result.success()
    }

    companion object {
        private const val MAX_PER_DAY = 5
        private const val PERIODIC = "logbook-reminders"
        private const val ONCE = "logbook-reminders-now"

        fun schedule(context: Context) = scheduleAt(context, hour(context))

        /** Reschedules the daily check for the next occurrence of [hour] (0-23), then every 24h. */
        fun scheduleAt(context: Context, hour: Int) {
            prefs(context).edit().putInt(KEY_HOUR, hour).apply()
            val now = java.time.ZonedDateTime.now(ZoneIds.zone)
            var next = now.withHour(hour).withMinute(0).withSecond(0).withNano(0)
            if (!next.isAfter(now)) next = next.plusDays(1)
            val delay = java.time.Duration.between(now, next).toMillis()
            val request = PeriodicWorkRequestBuilder<ReminderWorker>(1, TimeUnit.DAYS)
                .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                .setConstraints(
                    Constraints.Builder().setRequiresBatteryNotLow(true).build(),
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        private const val KEY_HOUR = "reminder_hour"
        private fun prefs(context: Context) = context.getSharedPreferences("logbook_reminders", Context.MODE_PRIVATE)
        fun hour(context: Context): Int = prefs(context).getInt(KEY_HOUR, 8)

        /** "Check now" in Settings. */
        fun runNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<ReminderWorker>()
                .setConstraints(Constraints.Builder().setRequiresBatteryNotLow(true).build())
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, request)
        }
    }
}

/**
 * Notification actions. Snooze writes the same entityFields change the app
 * uses; Mark contacted logs a `met` event for the existing ref, so the person
 * is never duplicated.
 */
class ReminderActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as? LogbookApp ?: return
        val ref = intent.getStringExtra(Reminders.EXTRA_REF) ?: return
        val name = intent.getStringExtra(Reminders.EXTRA_NAME).orEmpty()
        val pending = goAsync()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    Reminders.ACTION_SNOOZE ->
                        app.repo.setReminder(
                            ref = ref,
                            snoozedUntil = LocalDate.now(ZoneIds.zone).plusWeeks(1).toString(),
                        )
                    Reminders.ACTION_MET -> app.repo.logMetForRef(ref = ref, title = name)
                }
                NotificationManagerCompat.from(context).cancel(ref.hashCode())
            } finally {
                pending.finish()
            }
        }
    }
}
