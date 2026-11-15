package app.logbook.settings

import android.content.Context
import android.net.Uri
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** URL, key and TMDB key of one Sheet connection. Never logged, never backed up. */
data class Connection(
    val url: String = "",
    val key: String = "",
    val tmdb: String = "",
) {
    val isComplete: Boolean get() = url.isNotBlank() && key.isNotBlank()

    /** Settings shows the key masked; the full value never leaves this class. */
    val keyMasked: String
        get() = if (key.isEmpty()) "" else key.take(2) + "••••" + key.takeLast(2)

    val tmdbMasked: String
        get() = if (tmdb.isEmpty()) "" else tmdb.take(2) + "••••" + tmdb.takeLast(2)
}

/**
 * C3: Keystore-backed encrypted storage (androidx.security). The prefs file is
 * named to match the backup exclusions in res/xml (backup_rules.xml and
 * data_extraction_rules.xml), so the key never reaches a cloud backup.
 */
class ConnectionStore(private val context: Context) {

    /**
     * The Keystore can be missing or unusable (a JVM test, a device whose key
     * was invalidated, a restored backup). Rather than crash at startup, the
     * store falls back to memory only: the connection works for this run and
     * is never written in the clear. [isPersistent] tells the UI to say so.
     */
    private val prefs: android.content.SharedPreferences? by lazy {
        runCatching {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                FILE_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            ) as android.content.SharedPreferences
        }.getOrNull()
    }

    private var memory: Connection? = null

    /** False when the encrypted file could not be opened; secrets are not stored then. */
    val isPersistent: Boolean get() = prefs != null

    fun read(): Connection {
        val p = prefs ?: return memory ?: Connection()
        return Connection(
            url = p.getString(KEY_URL, "") ?: "",
            key = p.getString(KEY_SECRET, "") ?: "",
            tmdb = p.getString(KEY_TMDB, "") ?: "",
        )
    }

    fun save(connection: Connection) {
        val p = prefs
        if (p == null) {
            memory = connection
            return
        }
        p.edit()
            .putString(KEY_URL, connection.url.trim())
            .putString(KEY_SECRET, connection.key.trim())
            .putString(KEY_TMDB, connection.tmdb.trim())
            .apply()
    }

    fun clear() {
        memory = null
        prefs?.edit()?.clear()?.apply()
    }

    companion object {
        const val FILE_NAME = "logbook_secure"

        private const val KEY_URL = "url"
        private const val KEY_SECRET = "key"
        private const val KEY_TMDB = "tmdb"

        /**
         * The setup link the web app generates: `<anything>#u=<url>&k=<key>&t=<tmdb>`.
         * Also accepts the bare fragment. Returns null when there is no url/key.
         */
        fun parseSetupLink(raw: String): Connection? {
            val text = raw.trim()
            if (text.isEmpty()) return null
            val fragment = text.substringAfter('#', text)
            val query = if (fragment.startsWith("u=") || fragment.contains("&k=")) fragment else text.substringAfter('?', "")
            if (query.isBlank()) return null
            val parsed = runCatching { Uri.parse("https://logbook.invalid/?$query") }.getOrNull() ?: return null
            val url = parsed.getQueryParameter("u")?.trim().orEmpty()
            val key = parsed.getQueryParameter("k")?.trim().orEmpty()
            val tmdb = parsed.getQueryParameter("t")?.trim().orEmpty()
            if (url.isEmpty() || key.isEmpty()) return null
            if (!url.startsWith("https://")) return null
            return Connection(url = url, key = key, tmdb = tmdb)
        }
    }
}
