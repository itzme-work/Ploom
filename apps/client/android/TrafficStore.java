package work.itzme.ploom;

import android.content.Context;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Locale;

/** Stores daily totals. Never stores endpoint identifiers or individual requests. */
final class TrafficStore {
    private static String lastPrunedDay;

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences("ploom.traffic", Context.MODE_PRIVATE);
    }

    static synchronized void add(Context context, long uploaded, long downloaded) {
        SharedPreferences prefs = preferences(context);
        Calendar calendar = Calendar.getInstance();
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        String day = format.format(calendar.getTime());
        SharedPreferences.Editor edit = prefs.edit();
        if (!day.equals(lastPrunedDay)) {
            calendar.add(Calendar.DATE, -29);
            String oldest = format.format(calendar.getTime());
            for (String key : prefs.getAll().keySet()) {
                if (key.compareTo(oldest) < 0) edit.remove(key);
            }
            lastPrunedDay = day;
        }
        edit.putLong(day + "/up", prefs.getLong(day + "/up", 0) + uploaded)
            .putLong(day + "/down", prefs.getLong(day + "/down", 0) + downloaded).apply();
    }

    static synchronized long[] summary(Context context) {
        SharedPreferences prefs = preferences(context);
        Calendar calendar = Calendar.getInstance();
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT);
        long[] totals = new long[6];
        for (int i = 0; i < 30; i++) {
            String day = format.format(calendar.getTime());
            long up = prefs.getLong(day + "/up", 0);
            long down = prefs.getLong(day + "/down", 0);
            if (i == 0) { totals[0] = up; totals[1] = down; }
            if (i < 7) { totals[2] += up; totals[3] += down; }
            totals[4] += up;
            totals[5] += down;
            calendar.add(Calendar.DATE, -1);
        }
        return totals;
    }

    static synchronized void clear(Context context) {
        preferences(context).edit().clear().apply();
    }
}
