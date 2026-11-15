# Keep generated Room + kotlinx.serialization classes intact.
-keep class app.logbook.core.** { *; }
-keep class app.logbook.data.db.** { *; }
-keepclassmembers class * implements java.io.Serializable { *; }
-if @kotlinx.serialization.Serializable class ** { ** Companion; }
-keepclassmembers class <1> { static <1>$Companion Companion; }
-if @kotlinx.serialization.Serializable class ** { public static ** INSTANCE; }
-keepclassmembers class <1> { public static <1> INSTANCE; }
-dontnote kotlinx.serialization.**
