package app.logbook.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.logbook.sync.SyncWorker

/**
 * WorkManager keeps its own schedule across reboots, but re-registering here is
 * cheap and covers the case where the app data was restored on a new device.
 * The daily reminder worker (D10) will hang off the same receiver.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        SyncWorker.schedule(context)
        ReminderWorker.schedule(context)
    }
}
