# Logbook on-device AI: plan

This is the plan for running a language model **on the phone**, with the user's
own weights. It adds an optional layer to the app and changes none of the
locked decisions in `docs/ANDROID_APP_TASKS.md`.

Read first: `docs/ANDROID_APP_TASKS.md` (decisions), `docs/ANDROID_BUILD_PLAN_MARGIN.md`
(milestones) and `android/design/margin/HANDOFF.md` (screens).

## 1. What this is, and what it is not

**Is:** local rewriting, summarising, extraction and semantic lookup over the
user's own notes, computed on the device, cached locally, offered as
suggestions.

**Is not:** a chatbot, a new backend, a sync change, or a replacement for the
deterministic logic in `:core`. `parseWho`, `slugOf`, `findPerson`,
`followUps` and every ref stay exactly as they are: B3/B4 golden parity and the
Sheet contract depend on them, and an LLM that returns `n:maria` instead of
`n:maria-alvarez` creates duplicate people.

**Status:** plan only. Nothing in the app calls a model today, no engine
dependency is added, and no weights are bundled.

## 2. Decisions this plan takes as given

From `ANDROID_APP_TASKS.md` §Decisions, which still hold:

1. No new server. The Sheet stays the system of record.
2. Offline-first. AI never requires a network to run.
3. Privacy: no analytics, no crash SDKs. Notes are personal data; student data
   must not be entered.
4. Distribution: sideloaded APK. No Play Store.

Two consequences follow, and they are the only new constraints:

- **Model weights are not APK content.** A 270M–1B int4 model is 200 MB–1 GB;
  the current debug APK is 27 MB. Weights are downloaded on explicit user
  action (or sideloaded into app storage for personal builds).
- **The download is the one new network call.** E4 currently promises "no
  network calls except the Apps Script URL and the catalog APIs". Adding a model
  download changes that sentence, and the Settings copy must say so plainly,
  with the host named and the size shown before the download starts.

## 3. Runtime choice

| Option | Model | Works on | Cost to us | Verdict |
|---|---|---|---|---|
| **LiteRT-LM** (`com.google.ai.edge.litertlm:litertlm-android`) | `.litertlm` from the LiteRT community (Gemma 3 270M/1B, Gemma 3n E2B, FunctionGemma 270M, Qwen) | any arm64 phone with enough RAM | we ship/download weights, own the lifecycle | **primary** |
| ML Kit GenAI (Gemini Nano, AICore) | system model, no download | a short list of flagships (Pixel 8+, recent Galaxy S) | availability checks, fallback | optional accelerator, feature-flagged |
| llama.cpp / GGUF | any GGUF | any arm64 | JNI dependency to maintain | only if we need a specific model |
| MediaPipe LLM Inference | `.task` | as LiteRT-LM | maintenance-only upstream | do not start here |
| MLC-LLM, ONNX Runtime GenAI | multi-file | arm64 | slow, awkward to ship | no |

Model sizes to plan against: Gemma 3 270M int4 ≈ 0.2–0.3 GB; Gemma 3 1B IT int4
≈ 0.5–0.7 GB; Gemma 3n E2B ≈ 2.6 GB. Comfortable floor: 1B on a 6 GB phone with
the GPU backend; 270M for capture-time extraction on 4 GB phones.

## 4. Where it plugs in

```
android/
  core/                      stays pure and Android-free
    src/main/kotlin/app/logbook/core/ai/
      NoteAi.kt              the port (suspend functions, no Android types)
      AiResult.kt            suggestion + provenance + cache key
  app/
    src/main/kotlin/app/logbook/
      ai/
        LitertEngine.kt      Engine/Conversation wrapper, one per process
        NanoEngine.kt        optional ML Kit GenAI implementation
        NoAi.kt              the fallback: returns the deterministic text
        AiRepository.kt      hashing, caching, scheduling, cancellation
        Prompts.kt           prompt templates, versioned
      ui/…                   buttons that call the port, never the engine
```

`NoteAi` (proposed, final shape decided with the first implementation):

```kotlin
interface NoteAi {
    suspend fun rewriteDraft(draft: String, context: DraftContext): String?
    suspend fun summariseWeek(input: WeekInput): String?
    suspend fun describePerson(input: PersonInput): String?
    suspend fun extractEvents(text: String): List<EventDraft>?   // phase 2
    suspend fun embed(text: String): FloatArray?                 // phase 2
    val capability: Capability                                    // Unavailable | Ready
}
```

Rules for every implementation:

- Runs on `Dispatchers.Default`/`IO`; `Engine.initialize()` can take ~10 s and
  must never touch the main thread.
- One engine per process, created lazily in `LogbookApp`, closed on
  `onTrimMemory(TRIM_MEMORY_COMPLETE)` or after an idle timeout.
- Results are suggestions. **Nothing writes to Room or the outbox directly**;
  the user accepts, and the accepted payload goes through the normal capture
  path.
- No output is ever logged. Notes are personal data.

## 5. Where AI output lives

Local-only, in a new Room table, so nothing new reaches the Sheet:

```
ai_suggestions(id, kind, input_hash, model_id, prompt_version, text, created_ms)
```

`input_hash` = SHA-256 of the exact prompt input. Re-opening Review or Nudges
re-reads a cached row instead of re-running inference. Cache is cleared by
"Clear local copy".

If a future feature must sync (e.g. tags), it goes through the A1 `changes`
contract with a new change type and a version bump — never a silent column
addition.

## 6. Features, in the order I would build them

Sizes: S < half a day, M ≈ a day, L several days. Every one is optional at
runtime: with `NoAi` the app behaves exactly as it does today.

### Phase 1 — prose, no schema change (works with a 1B model)

**AI1: Rewrite the check-in draft (S).** Nudges card and Person page already
have `checkInDraft()`. Add "Rewrite" → one shorter, warmer variant using the
last two notes. Deterministic draft stays one tap away. *Done when:* Nudges
shows the AI variant with an "on this phone" label, the cache is hit on the
second open, and the fake engine drives a Robolectric test.

**AI2: Person dossier (M).** On `PersonScreen`, a card above the timeline:
what they care about, current situation, three things to ask about. Input is
`topicsOf`, `placeHistory` and the last ~10 notes. *Done when:* cached per
`input_hash`, ≤120 words, and the card is absent when the model is unavailable.

**AI3: Weekly review narrative (S).** `narrative()` stays; a second variant is
generated from `weekStats` + `themes` + up to 20 entries, naming real moments.
*Done when:* the deterministic version is still the fallback and the numbers in
the AI text are supplied by us, not generated.

**AI4: Capture cleanup (M).** The Met/Thought save path sends the text through
"fix punctuation, keep the words" before writing. Strictly opt-in per save:
the user sees the corrected text and can keep the original.

### Phase 2 — extraction and retrieval

**AI5: Follow-up extraction (M).** Model reads a note and proposes follow-ups
("Ask Ms. Gamilah about WIDA sentence frames, by Friday"). Keys stay
`eventId:clauseIndex`; proposals live in `ai_suggestions` until accepted. This
is the honest fix for HANDOFF finding F1 without breaking the web app.

**AI6: Semantic search (M).** One embedding per note, stored as a BLOB in Room,
brute-force cosine in `SearchScreen` (hundreds of rows, not millions). Hits are
highlighted with the existing `matchSpans`. *Done when:* a query that shares no
keywords with the note still finds it, and the cost per search is < 20 ms.

**AI7: Questions answered with tools (M/L).** FunctionGemma 270M calls local
functions (`needsAttention`, `sinceLastMet`, `weekStats`) and phrases the
answer. All arithmetic stays in `:core`, so the answer is correct by
construction.

### Phase 3 — multimodal (needs a 2.6 GB model)

**AI8: Photo capture (L).** Snap a cover, a recipe or a whiteboard → title,
author, note. Requires Gemma 3n E2B and a much larger download.

### Explicitly out of scope

- Replacing `parseWho`/`slugOf`/`followUps` with a model.
- Auto-sending anything (messages, Sheet writes, reminders) without a tap.
- Cloud fallback. If the model is unavailable, the app uses its deterministic
  features.

## 7. Model delivery

1. Settings → Reminders/AI card shows: model name, size, host, licence, and a
   "Download on Wi-Fi" action. Nothing downloads without that tap.
2. Download to `filesDir/models/<model_id>.litertlm`, `.part` file first,
   SHA-256 verified, then atomic rename.
3. Free-space guard (need size × 1.2 + 200 MB), `isLowRamDevice` and
   `ActivityManager.memoryClass` checks before the button is enabled.
4. Progress in a `ForegroundService` (data-sync type) so a long download
   survives the screen turning off; resumable via HTTP Range if the host allows.
5. Delete model action; "Clear local copy" leaves the model alone.
6. Personal builds may skip all of this and push the file with `adb push` into
   `filesDir`; document the path.

## 8. Performance, battery, thermals

- First token on CPU for a 1B Q4 model is ~1–3 s; streaming keeps the UI
  honest. GPU backend is noticeably faster; it needs the two
  `uses-native-library` entries in the manifest.
- Background generation (dossiers, week summaries) runs in WorkManager with
  `requiresCharging` + `requiresDeviceIdle` for the nightly job, and is skipped
  below 20 % battery.
- Cancel on navigation away; never queue more than one request per feature.
- Re-check `isLowRamDevice` before loading; unload the engine after 5 minutes
  idle.

## 9. Testing

| Layer | How |
|---|---|
| Prompt assembly | pure JVM tests in `:core` (input → exact prompt string, version-pinned) |
| Cache + hashing | JVM tests on `AiRepository` with an in-memory Room DB |
| UI wiring | `FakeNoteAi` injected in Robolectric, same pattern as `ShellSmokeTest` |
| Real inference | one device-only test per model, gated on `Capability.Ready`; never in CI |
| Quality | an eval set of 30 real (scrubbed) notes, scored by hand once per prompt change |

No model runs in CI. The fake engine is the contract; the evaluation is manual.

## 10. Privacy and release

- Update E4: the promise becomes "the Sheet, the catalog APIs, and an optional
  model download you start yourself".
- No telemetry, no prompt logging, no crash reporting. `AiResult` may carry
  timings locally; nothing leaves the device.
- The model download must not be required: a phone with no model keeps every
  current feature.
- Update `android/README.md` with the model path and the licence of whatever
  weights are offered.

## 11. Open questions for the user

1. Which model first: 270M (fast, weaker prose) or 1B (slower, good drafts)?
   Default: 1B for prose, 270M FunctionGemma later for questions.
2. Is a ~700 MB Wi-Fi download acceptable, or should the first build ship with
   no download and only support a sideloaded file?
3. Should AI suggestions ever be written into the Sheet (a `source=ai` note), or
   stay local forever? Default: local forever.
4. Which of AI1–AI4 is the first real feature?
5. Does the district/account policy allow any third-party model licence on
   school-managed devices? (Same gate as A3.)
