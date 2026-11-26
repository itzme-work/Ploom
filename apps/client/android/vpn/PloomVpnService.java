package work.itzme.ploom;

import android.app.*;
import android.content.*;
import android.net.VpnService;
import android.os.Build;
import io.nekohasekai.libbox.*;
import java.io.File;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

public final class PloomVpnService extends VpnService implements CommandServerHandler {
    public static volatile String state = "idle";
    private final java.util.concurrent.ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
    private static volatile long[] snapshot;
    public static volatile String networkType = "offline";
    private long started, up, down, last;
    public static long[] metrics() { long[] v=snapshot;return v==null?null:v.clone(); }
    @Override public void onCreate(){
        super.onCreate();
        executor.scheduleWithFixedDelay(this::sample,1,2,java.util.concurrent.TimeUnit.SECONDS);
    }
    private void sample(){
        if(server==null || !"tunnel-open".equals(state))return;
        PloomTraffic traffic=server.ploomTraffic();
        if(traffic==null)return;
        long now=android.os.SystemClock.elapsedRealtime(), interval=Math.max(1,now-last);
        long sent=traffic.getUpload(),received=traffic.getDownload();
        long du=Math.max(0,sent-up),dd=Math.max(0,received-down);
        snapshot=new long[]{sent,received,du*1000/interval,dd*1000/interval,(now-started)/1000};
        if (du > 0 || dd > 0) TrafficStore.add(this, du, dd);
        up=sent;down=received;last=now;
    }
    private CommandServer server;
    private AndroidPlatform platform;
    private static final int NOTICE = 31;
    private android.app.Notification notice() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        android.app.Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel("ploom-vpn","Ploom VPN",NotificationManager.IMPORTANCE_LOW));
            b = new android.app.Notification.Builder(this,"ploom-vpn");
        } else b = new android.app.Notification.Builder(this);
        Intent stop = new Intent(this,PloomVpnService.class).setAction("stop");
        PendingIntent action = PendingIntent.getService(this,0,stop,PendingIntent.FLAG_IMMUTABLE);
        String label = java.util.Locale.getDefault().getLanguage().equals("ru") ? "Отключить" : "Disconnect";
        return b.setContentTitle("Ploom VPN").setSmallIcon(android.R.drawable.ic_lock_lock)
                .setOngoing(true).addAction(0,label,action).build();
    }
    @Override public int onStartCommand(Intent intent,int flags,int id) {
        if (intent == null || !"start".equals(intent.getAction())) {
            android.util.Log.i("PloomVpn", "Stop requested");
            executor.execute(() -> {
                shutdown();
                state="idle";
                stopSelfResult(id);
                android.util.Log.i("PloomVpn", "Tunnel closed");
            });
            return START_NOT_STICKY;
        }
        startForeground(NOTICE,notice());
        String config = intent.getStringExtra("config");
        executor.execute(() -> {
            try {
                shutdown();
                state="starting";
                if (config == null || VpnService.prepare(this) != null) throw new IllegalStateException();
                File dir = new File(getNoBackupFilesDir(),"engine");
                if (!dir.isDirectory() && !dir.mkdir()) throw new IllegalStateException();
                SetupOptions options = new SetupOptions();
                options.setBasePath(dir.getAbsolutePath()); options.setWorkingPath(dir.getAbsolutePath());
                options.setTempPath(getCacheDir().getAbsolutePath()); options.setFixAndroidStack(true);
                Libbox.setup(options);
                platform = new AndroidPlatform(this);
                server = Libbox.newCommandServer(this,platform);
                server.startOrReloadService(config,new OverrideOptions());
                started=last=android.os.SystemClock.elapsedRealtime();up=down=0;state="tunnel-open";sample();
            } catch (Exception | LinkageError error) {
                shutdown(); state="error"; stopSelfResult(id);
            }
        });
        return START_NOT_STICKY;
    }
    private void shutdown() {
        sample(); snapshot=null;
        if (server != null) {
            android.util.Log.i("PloomVpn", "Closing libbox service");
            try { server.closeService(); } catch (Exception ignored) {}
            try { server.close(); } catch (Exception ignored) {}
            server=null;
        }
        if (platform != null) { try { platform.close(); } catch (Exception ignored) {} platform=null; }
        networkType = "offline";
    }
    @Override public void onRevoke(){ state="revoked"; stopSelf(); }
    @Override public void onDestroy(){
        executor.execute(() -> { shutdown(); if (!state.equals("error") && !state.equals("revoked")) state="idle"; });
        executor.shutdown(); stopForeground(true); super.onDestroy();
        android.util.Log.i("PloomVpn", "Service destroyed");
    }
    public int connectSSHAgent(){return -1;}
    public void serviceStop(){stopSelf();}
    public void serviceReload(){throw new UnsupportedOperationException();}
    public SystemProxyStatus getSystemProxyStatus(){return new SystemProxyStatus();}
    public void setSystemProxyEnabled(boolean enabled){throw new UnsupportedOperationException();}
    public void triggerNativeCrash(){throw new UnsupportedOperationException();}
    public void writeDebugMessage(String message){}
}
