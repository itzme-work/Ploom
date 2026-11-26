package work.itzme.ploom;

import android.content.Context;
import android.net.*;
import android.os.ParcelFileDescriptor;
import io.nekohasekai.libbox.*;
import java.net.InetAddress;
import java.util.*;

final class AndroidPlatform implements PlatformInterface {
    final PloomVpnService service;
    final ConnectivityManager manager;
    private volatile ConnectivityManager.NetworkCallback callback;
    private android.os.HandlerThread monitorThread;
    private ParcelFileDescriptor tun;

    AndroidPlatform(PloomVpnService service) {
        this.service = service;
        manager = (ConnectivityManager) service.getSystemService(Context.CONNECTIVITY_SERVICE);
    }

    public boolean usePlatformAutoDetectInterfaceControl() { return true; }
    public void autoDetectInterfaceControl(int fd) throws Exception {
        if (!service.protect(fd)) throw new Exception("socket protection failed");
    }
    public synchronized int openTun(TunOptions opts) throws Exception {
        if (VpnService.prepare(service) != null || tun != null) throw new Exception("VPN permission or conflict");
        VpnService.Builder builder = service.new Builder().setSession("Ploom").setMtu(opts.getMTU());
        for (RoutePrefixIterator it : new RoutePrefixIterator[]{opts.getInet4Address(), opts.getInet6Address()}) {
            while (it.hasNext()) {
                RoutePrefix addr = it.next();
                builder.addAddress(addr.address(), addr.prefix());
            }
        }
        builder.addRoute("0.0.0.0", 0).addRoute("::", 0);
        StringIterator dns = opts.getDNSServerAddress();
        while (dns.hasNext()) builder.addDnsServer(dns.next());
        tun = builder.establish();
        if (tun == null) throw new Exception("TUN unavailable");
        return tun.getFd();
    }
    synchronized void close() throws Exception {
        if (tun != null) { tun.close(); tun = null; }
        closeDefaultInterfaceMonitor(null);
    }
    private boolean usable(Network n) {
        NetworkCapabilities c = manager.getNetworkCapabilities(n);
        return c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
                && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }
    private Network initialNetwork() {
        Network best = manager.getActiveNetwork();
        if (best == null || !usable(best)) {
            best = null;
            for (Network n : manager.getAllNetworks()) if (usable(n)) { best = n; break; }
        }
        return best;
    }
    private void update(InterfaceUpdateListener listener, Network best, LinkProperties lp) {
        String name = lp == null ? null : lp.getInterfaceName();
        try {
            java.net.NetworkInterface iface = name == null ? null : java.net.NetworkInterface.getByName(name);
            if (iface != null) {
                service.setUnderlyingNetworks(new Network[]{best});
                NetworkCapabilities capabilities = manager.getNetworkCapabilities(best);
                boolean metered = capabilities != null
                        && !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED);
                listener.updateDefaultInterface(name, iface.getIndex(), metered, false);
                PloomVpnService.networkType = capabilities == null ? "unknown"
                        : capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "wifi"
                        : capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? "cellular" : "other";
                return;
            }
        } catch (java.net.SocketException ignored) {}
        PloomVpnService.networkType = "offline";
        service.setUnderlyingNetworks(new Network[0]);
        listener.updateDefaultInterface("", -1, false, false);
    }
    public synchronized void startDefaultInterfaceMonitor(InterfaceUpdateListener listener) {
        closeDefaultInterfaceMonitor(null);
        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build();
        boolean bestMatching = android.os.Build.VERSION.SDK_INT >= 31;
        callback = new ConnectivityManager.NetworkCallback() {
            private Network selected;
            public void onAvailable(Network network) {
                if (callback != this) return;
                selected = bestMatching ? network : initialNetwork();
            }
            public void onLost(Network network) {
                if (callback != this || !network.equals(selected)) return;
                selected = bestMatching ? null : initialNetwork();
                update(listener, selected, selected == null ? null : manager.getLinkProperties(selected));
            }
            public void onLinkPropertiesChanged(Network network, LinkProperties props) {
                if (callback != this) return;
                if (!bestMatching) selected = initialNetwork();
                if (network.equals(selected)) update(listener, network, props);
            }
        };
        Network initial = initialNetwork();
        update(listener, initial, initial == null ? null : manager.getLinkProperties(initial));
        if (bestMatching) {
            monitorThread = new android.os.HandlerThread("ploom-network");
            monitorThread.start();
            manager.registerBestMatchingNetworkCallback(request, callback,
                    new android.os.Handler(monitorThread.getLooper()));
        } else {
            manager.registerNetworkCallback(request, callback);
        }
    }
    public synchronized void closeDefaultInterfaceMonitor(InterfaceUpdateListener listener) {
        ConnectivityManager.NetworkCallback registered = callback;
        callback = null;
        try {
            if (registered != null) manager.unregisterNetworkCallback(registered);
        } finally {
            if (monitorThread != null) { monitorThread.quitSafely(); monitorThread = null; }
        }
    }
    private static StringIterator strings(List<String> values) {
        Iterator<String> i = values.iterator();
        return new StringIterator() {
            public int len(){ return values.size(); }
            public boolean hasNext(){ return i.hasNext(); }
            public String next(){ return i.next(); }
        };
    }
    public NetworkInterfaceIterator getInterfaces() throws Exception {
        List<io.nekohasekai.libbox.NetworkInterface> all = new ArrayList<>();
        for (Network n : manager.getAllNetworks()) {
            if (!usable(n)) continue;
            LinkProperties props = manager.getLinkProperties(n);
            if (props == null || props.getInterfaceName() == null) continue;
            java.net.NetworkInterface iface = java.net.NetworkInterface.getByName(props.getInterfaceName());
            if (iface == null) continue;
            io.nekohasekai.libbox.NetworkInterface row = new io.nekohasekai.libbox.NetworkInterface();
            row.setName(iface.getName()); row.setIndex(iface.getIndex()); row.setMTU(iface.getMTU());
            row.setFlags(android.system.OsConstants.IFF_UP | android.system.OsConstants.IFF_RUNNING);
            List<String> addresses = new ArrayList<>(), dns = new ArrayList<>();
            for (LinkAddress a : props.getLinkAddresses()) addresses.add(a.toString());
            for (InetAddress a : props.getDnsServers()) dns.add(a.getHostAddress());
            row.setAddresses(strings(addresses)); row.setDNSServer(strings(dns));
            all.add(row);
        }
        Iterator<io.nekohasekai.libbox.NetworkInterface> it = all.iterator();
        return new NetworkInterfaceIterator() {
            public boolean hasNext() { return it.hasNext(); }
            public io.nekohasekai.libbox.NetworkInterface next() { return it.next(); }
        };
    }
    public LocalDNSTransport localDNSTransport(){ return null; }
    public WIFIState readWIFIState(){ return null; }
    public void clearDNSCache(){}
    public void registerMyInterface(String name){}
    public boolean underNetworkExtension(){ return false; }
    public boolean includeAllNetworks(){ return false; }
    public boolean usePlatformShell(){ return false; }
    public boolean usePlatformBridge(){ return false; }
    public String tailscaleHostname(){ return ""; }
    public void closeNeighborMonitor(NeighborUpdateListener listener){}
    private UnsupportedOperationException unavailable(){ return new UnsupportedOperationException("Unavailable in Ploom"); }
    public ConnectionOwner findConnectionOwner(int p,String s,int sp,String d,int dp){ throw unavailable(); }
    public void checkPlatformShell(){ throw unavailable(); }
    public ShellSession openShellSession(PlatformUser u,String c,StringIterator e,String t,int r,int cols){ throw unavailable(); }
    public PlatformUser lookupUser(String u){ throw unavailable(); }
    public String lookupSFTPServer(){ throw unavailable(); }
    public String readSystemSSHHostKey(){ throw unavailable(); }
    public BridgeSession createBridge(BridgeOptions o){ throw unavailable(); }
    public void startNeighborMonitor(NeighborUpdateListener l){ throw unavailable(); }
    public void sendNotification(io.nekohasekai.libbox.Notification n){ throw unavailable(); }
    public void cancelNotification(String id,int type){ throw unavailable(); }
}
