package app.logbook.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.logbook.LogbookApp
import app.logbook.core.sync.SyncEngine
import app.logbook.core.sync.SyncOutcome
import app.logbook.core.sync.SyncState
import app.logbook.data.Repository
import app.logbook.data.RoomStore
import app.logbook.settings.Connection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * C2: one place that knows the connection state the UI shows. The engine stays
 * pure in :core; this class supplies the transport, the key and the clock.
 */
class SyncManager(
    private val repository: Repository,
    private val store: RoomStore,
    private val connection: () -> Connection,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val _state = MutableStateFlow<SyncState>(SyncState.NotConnected)
    val state: StateFlow<SyncState> = _state.asStateFlow()

    private val mutex = Mutex()

    /** Called after the connection changes: reflect connect/queue counts without a network call. */
    suspend fun refresh() {
        val c = connection()
        val waiting = repository.queueCount()
        _state.value = when {
            !c.isComplete -> SyncState.NotConnected
            waiting > 0 -> SyncState.Waiting(waiting)
            _state.value is SyncState.Synced -> _state.value
            else -> SyncState.Offline
        }
    }

    suspend fun syncNow(): SyncOutcome = mutex.withLock {
        val c = connection()
        if (!c.isComplete) {
            _state.value = SyncState.NotConnected
            return SyncOutcome.Error(SyncState.NotConnected, "not connected")
        }
        val base = _state.value
        _state.value = SyncState.Syncing(base)
        val api = OkHttpSheetApi(c.url)
        val outcome = withContext(Dispatchers.IO) {
            SyncEngine.syncNow(store, api, c.key) { now() }
        }
        _state.value = when (outcome) {
            is SyncOutcome.Ok -> SyncState.Synced(now())
            is SyncOutcome.Error -> outcome.state
        }
        outcome
    }
}

/** Periodic and one-off background sync. Backs off via WorkManager's retry. */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val app = applicationContext as? LogbookApp ?: return Result.failure()
        return when (val outcome = app.sync.syncNow()) {
            is SyncOutcome.Ok -> Result.success()
            is SyncOutcome.Error -> when (outcome.state) {
                // Only a network problem is worth retrying. No saved connection,
                // a wrong key or an old script all need the user, so retrying
                // would just wake the phone up to fail again.
                is SyncState.Offline, is SyncState.Waiting -> Result.retry()
                else -> Result.success()
            }
        }
    }

    companion object {
        private const val UNIQUE = "logbook-sync"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(UNIQUE, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }
}
