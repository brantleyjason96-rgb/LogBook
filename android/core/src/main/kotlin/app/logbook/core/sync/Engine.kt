package app.logbook.core.sync

import app.logbook.core.model.Entity

/**
 * The sync engine (C2), pure Kotlin so it runs under JVM tests against a
 * fake server. The Room store in :app implements [MutableStore]; OkHttp
 * implements [SheetApi]. Order, idempotency and state mapping live here.
 */

/** Connection health states the UI shows (HANDOFF C4: the six states plus the transient sync). */
sealed class SyncState {
    object NotConnected : SyncState()
    object Offline : SyncState()
    object WrongKey : SyncState()
    object OldScript : SyncState()
    data class Synced(val atMs: Long) : SyncState()
    data class Waiting(val count: Int) : SyncState()
    data class Syncing(val base: SyncState) : SyncState()
}

class NetworkException(msg: String) : Exception(msg)
class WrongKeyException : Exception("key")
class OldScriptException : Exception("script")

/** **Suspend** transport. Throws the typed exceptions above; returns JSON-decoded bodies. */
interface SheetApi {
    suspend fun pull(req: PullRequest): PullResponse
    suspend fun push(batch: PushBatch): PullResponse
}

sealed class SyncOutcome {
    /** Pull applied and outbox drained. */
    data class Ok(val pulled: Int, val pushed: Int, val state: SyncState) : SyncOutcome()
    data class Error(val state: SyncState, val cause: String) : SyncOutcome()
}

object SyncEngine {

    const val API_V = 4
    const val MAX_PAGES = 60

    /**
     * One full pass: pull until `more` is false (cursors persist between
     * pages), then drain the outbox in order. Nothing is lost: a push that
     * fails is retried next time; captured events stay in the outbox until
     * the sheet confirms them.
     */
    suspend fun syncNow(store: MutableStore, api: SheetApi, key: String, nowMs: () -> Long): SyncOutcome {
        var pulled = 0
        try {
            var pages = 0
            while (true) {
                val resp = api.pull(PullRequest(key = key, evCursor = store.evCursor(), chCursor = store.chCursor()))
                checkAuth(resp)
                if (resp.v < API_V) throw OldScriptException()
                applyPull(store, resp, nowMs())
                pulled += resp.events.size
                if (!resp.more) break
                if (++pages >= MAX_PAGES) break
            }
        } catch (e: WrongKeyException) {
            return SyncOutcome.Error(SyncState.WrongKey, "key")
        } catch (e: OldScriptException) {
            return SyncOutcome.Error(SyncState.OldScript, "script")
        } catch (e: NetworkException) {
            val waiting = store.outbox().size
            return SyncOutcome.Error(if (waiting > 0) SyncState.Waiting(waiting) else SyncState.Offline, e.message ?: "offline")
        }

        var pushed = 0
        for (item in store.outbox()) {
            try {
                val resp = api.push(
                    PushBatch(events = item.events, rows = item.rows, changes = listOfNotNull(item.change), key = key),
                )
                checkAuth(resp)
                if (resp.v in 1 until API_V && resp.ok) {
                    // an old script accepted v3 captures (events/rows) — the change
                    // payload is only safe on v4; surface that honestly.
                }
                store.removeQueued(item.id)
                pushed++
            } catch (e: WrongKeyException) {
                return SyncOutcome.Error(SyncState.WrongKey, "key")
            } catch (e: NetworkException) {
                val waiting = store.outbox().size
                return SyncOutcome.Error(if (waiting > 0) SyncState.Waiting(waiting) else SyncState.Offline, e.message ?: "offline")
            }
        }
        return SyncOutcome.Ok(pulled, pushed, SyncState.Synced(nowMs()))
    }

    private fun checkAuth(resp: PullResponse) {
        if (!resp.ok && resp.error == "key") throw WrongKeyException()
        if (!resp.ok && resp.error == "script") throw OldScriptException()
        if (!resp.ok) throw NetworkException("server said not ok")
    }

    /** One pulled page into the store. Events in order, then changes in seq order. */
    fun applyPull(store: MutableStore, resp: PullResponse, nowMs: Long) {
        store.replaceEntities(resp.entities.map { it.toDomain() })
        for (e in resp.events) store.upsertEvent(e.toDomain())
        val applied = mutableSetOf<String>()
        for (c in resp.changes) {
            if (!applied.add(c.id)) continue
            applyChange(store, c)
        }
        store.setCursors(resp.evCursor, resp.chCursor, nowMs)
    }

    fun applyChange(store: MutableStore, c: ChangeWire) {
        when (c.type) {
            ChangeTypes.VOID -> c.decodeVoid()?.let { store.markVoided(it.eventId) }
            ChangeTypes.RENAME -> c.decodeRename()?.let { store.renameEntity(it.ref, it.name) }
            ChangeTypes.MERGE -> c.decodeMerge()?.let { store.mergeEntities(it.from, it.to, it.title, it.cat) }
            ChangeTypes.ENTITY_FIELDS -> c.decodeEntityFields()?.let {
                store.setEntityFields(it.ref, it.remindDays, it.snoozedUntil, it.retired)
            }
            ChangeTypes.ALIAS -> c.decodeAlias()?.let { store.addAlias(it.heard, it.ref) }
            ChangeTypes.FU_DONE -> c.decodeFuDone()?.let { store.setFollowUpDone(it.key, it.done, it.ts) }
            else -> Unit // unknown change types must not break older clients
        }
    }
}
