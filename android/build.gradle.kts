// Logbook Android: root build file. Layout and decisions are in
// docs/ANDROID_BUILD_PLAN_MARGIN.md and docs/ANDROID_APP_TASKS.md.

plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.plugin.compose) apply false
    alias(libs.plugins.kotlin.plugin.serialization) apply false
    alias(libs.plugins.ksp) apply false
}
