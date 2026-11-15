package app.logbook.sync

import app.logbook.core.sync.NetworkException
import app.logbook.core.sync.PullRequest
import app.logbook.core.sync.PullResponse
import app.logbook.core.sync.PushBatch
import app.logbook.core.sync.SheetApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * C2 transport: OkHttp implementation of [SheetApi]. The Apps Script URL is
 * the only host this app talks to (E4). The key rides in the POST body, never
 * the URL, and the body is text/plain so Apps Script needs no preflight.
 * Nothing here logs the request or the key.
 */
class OkHttpSheetApi(
    private val endpoint: String,
    private val client: OkHttpClient = defaultClient(),
) : SheetApi {

    private val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; isLenient = true }

    override suspend fun pull(req: PullRequest): PullResponse =
        send(json.encodeToString(PullRequest.serializer(), req))

    override suspend fun push(batch: PushBatch): PullResponse =
        send(json.encodeToString(PushBatch.serializer(), batch))

    private suspend fun send(body: String): PullResponse = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url(endpoint)
            .post(body.toRequestBody(JSON))
            .header("Accept", "application/json")
            .build()
        try {
            client.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    // A 401/403 from Apps Script means the deployment is not
                    // "Anyone", not necessarily a wrong key; both are reported
                    // as a connection failure rather than a crash.
                    if (resp.code == 401 || resp.code == 403) throw NetworkException("refused")
                    throw NetworkException("HTTP ${resp.code}")
                }
                try {
                    json.decodeFromString(PullResponse.serializer(), text)
                } catch (e: Exception) {
                    throw NetworkException("unreadable reply")
                }
            }
        } catch (e: NetworkException) {
            throw e
        } catch (e: IOException) {
            throw NetworkException("offline")
        }
    }

    companion object {
        private val JSON = "text/plain; charset=utf-8".toMediaType()

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }
}
