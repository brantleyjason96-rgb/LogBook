package app.logbook.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import app.logbook.LogbookApp
import app.logbook.MainActivity
import app.logbook.core.model.ZoneIds
import java.time.LocalDate

/**
 * M12 widget: 4 x 2, today's count and the four capture shortcuts. It reads the
 * local copy only — no network, no sync — and every tap lands on the matching
 * capture flow. The count is per calendar day in the device zone, the same day
 * boundary the rest of the app uses.
 */
class LogbookWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val app = context.applicationContext as? LogbookApp
        val today = LocalDate.now(ZoneIds.zone).toString()
        val count = app?.repo?.todayCount(today) ?: 0

        provideContent {
            Column(
                modifier = GlanceModifier
                    .fillMaxWidth()
                    .background(ColorProvider(Color(0xFF151828)))
                    .padding(14.dp),
            ) {
                Text(
                    text = "Logbook",
                    style = TextStyle(
                        color = ColorProvider(Color(0xFFECEEF8)),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                    ),
                )
                Text(
                    text = if (count == 0) "Nothing logged today" else "$count logged today",
                    style = TextStyle(color = ColorProvider(Color(0xFFB5BAD0)), fontSize = 12.sp),
                )
                Spacer(GlanceModifier.padding(top = 10.dp))
                Row(modifier = GlanceModifier.fillMaxWidth()) {
                    Shortcut(context, "Met", "capture/met")
                    Shortcut(context, "Rate", "capture/media")
                    Shortcut(context, "Did", "capture/did")
                    Shortcut(context, "Note", "capture/note")
                }
            }
        }
    }

    private companion object {
        const val LABEL = 0xFFECEEF8.toInt()
        const val PILL = 0xFF1D2340.toInt()
    }

    @Composable
    private fun Shortcut(context: Context, label: String, route: String) {
        val intent = Intent(context, MainActivity::class.java)
            .setData(Uri.parse("logbook://$route"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        Text(
            text = label,
            modifier = GlanceModifier
                .padding(horizontal = 10.dp, vertical = 6.dp)
                .background(ColorProvider(Color(PILL)))
                .clickable(actionStartActivity(intent)),
            style = TextStyle(color = ColorProvider(Color(LABEL)), fontSize = 12.sp, fontWeight = FontWeight.Medium),
        )
        Spacer(GlanceModifier.padding(end = 6.dp))
    }
}

/** Glance's receiver replaces the old AppWidgetProvider; the manifest entry is unchanged. */
class LogbookWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = LogbookWidget()
}
