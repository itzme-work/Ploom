package work.itzme.ploom

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import java.io.File
import java.io.IOException
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.HttpsURLConnection

// Android registers providers by component class as well as authority. Tauri already uses FileProvider.
class UpdateFileProvider : FileProvider()

@InvokeArg
class ExportArgs { lateinit var name:String; lateinit var text:String }

@InvokeArg
class BrowserArgs { lateinit var expected: String }

@InvokeArg
class InstallArgs { lateinit var expected: String; lateinit var progress: app.tauri.plugin.Channel }

@InvokeArg
class TunnelArgs { lateinit var config: String }

@TauriPlugin
class AndroidUpdateAdapter(private val host: Activity): Plugin(host) {
    @Command
    fun scanQr(invoke: Invoke) {
        startActivityForResult(invoke,Intent(host,QrScannerActivity::class.java),"qrResult")
    }
    @app.tauri.annotation.ActivityCallback
    fun qrResult(invoke: Invoke,result: androidx.activity.result.ActivityResult) {
        val response=app.tauri.plugin.JSObject()
        response.put("text",if(result.resultCode==Activity.RESULT_OK)result.data?.getStringExtra("qr") else "")
        invoke.resolve(response)
    }
    @Command
    fun trafficSummary(invoke: Invoke){
        val prefs=host.getSharedPreferences("ploom.traffic",android.content.Context.MODE_PRIVATE)
        val sums=LongArray(6)
        val day=java.util.Calendar.getInstance()
        val format=java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.ROOT)
        for(i in 0 until 30){
            val key=format.format(day.time)
            val up=prefs.getLong("$key/up",0);val down=prefs.getLong("$key/down",0)
            if(i==0){sums[0]=up;sums[1]=down}
            if(i<7){sums[2]+=up;sums[3]+=down}
            sums[4]+=up;sums[5]+=down
            day.add(java.util.Calendar.DATE,-1)
        }
        val reply=app.tauri.plugin.JSObject()
        reply.put("bytes",org.json.JSONArray(sums.toList()));invoke.resolve(reply)
    }
    @Command
    fun clearTraffic(invoke: Invoke){
        host.getSharedPreferences("ploom.traffic",android.content.Context.MODE_PRIVATE).edit().clear().apply()
        invoke.resolve()
    }
    private val vpnClass = "work.itzme.ploom.PloomVpnService"
    @Command
    fun tunnelState(invoke: Invoke) {
        val result = app.tauri.plugin.JSObject()
        try {
            val service=Class.forName(vpnClass)
            result.put("state",service.getField("state").get(null))
            val usage=service.getMethod("metrics").invoke(null) as? LongArray
            if(usage!=null)result.put("traffic",org.json.JSONArray(usage.toList()))
        } catch (_: ClassNotFoundException) { result.put("state","unavailable") }
        invoke.resolve(result)
    }
    @Command
    fun tunnelStop(invoke: Invoke) {
        host.stopService(Intent().setClassName(host, vpnClass))
        invoke.resolve()
    }
    @Command
    fun tunnelStart(invoke: Invoke) {
        try {
            Class.forName(vpnClass)
            val consent = android.net.VpnService.prepare(host)
            if (consent == null) startTunnel(invoke)
            else startActivityForResult(invoke, consent, "vpnConsent")
        } catch (_: Exception) { invoke.reject("VPN unavailable") }
    }
    @app.tauri.annotation.ActivityCallback
    fun vpnConsent(invoke: Invoke,result: androidx.activity.result.ActivityResult) {
        if (result.resultCode == Activity.RESULT_OK) startTunnel(invoke)
        else invoke.reject("VPN permission denied")
    }
    private fun startTunnel(invoke: Invoke) {
        try {
            val intent = Intent().setClassName(host,vpnClass).setAction("start")
                .putExtra("config",invoke.parseArgs(TunnelArgs::class.java).config)
            if (Build.VERSION.SDK_INT >= 26) host.startForegroundService(intent) else host.startService(intent)
            invoke.resolve()
        } catch (_: Exception) { invoke.reject("VPN service unavailable") }
    }
    @Command
    fun libraryKey(invoke: Invoke) {
        try {
            val result = app.tauri.plugin.JSObject()
            result.put("key", LibraryKey.unlock(host))
            invoke.resolve(result)
        } catch (e: Exception) { invoke.reject("Secure storage unavailable") }
    }

    @Command
    fun exportDocument(invoke: Invoke) {
        val args=invoke.parseArgs(ExportArgs::class.java)
        val intent=Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType(if(args.name.endsWith(".json")) "application/json" else "text/plain")
            .putExtra(Intent.EXTRA_TITLE,args.name)
        startActivityForResult(invoke,intent,"exportResult")
    }
    @app.tauri.annotation.ActivityCallback
    fun exportResult(invoke: Invoke,result: androidx.activity.result.ActivityResult) {
        val uri=result.data?.data
        if(result.resultCode!=Activity.RESULT_OK || uri==null){invoke.reject("Canceled");return}
        Thread {
            try {
                val bytes=invoke.parseArgs(ExportArgs::class.java).text.toByteArray(Charsets.UTF_8)
                requireNotNull(host.contentResolver.openOutputStream(uri,"wt")).use { it.write(bytes) }
                invoke.resolve()
            } catch(e:Exception){invoke.reject("Export failed")}
        }.start()
    }
    private val busy = AtomicBoolean(false)

    private val lock = Any()
    private var download: AtomicBoolean? = null

    private fun asset(version: String): URL {
        require(Regex("[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?").matches(version))
        return URL("https://github.com/itzme-work/Ploom/releases/download/v$version/Ploom-arm64.apk")
    }

    @Command
    fun openProvider(invoke: Invoke) {
        try {
            val uri=Uri.parse(invoke.parseArgs(BrowserArgs::class.java).expected)
            require(uri.scheme=="https" && uri.host!=null && uri.userInfo==null)
            host.startActivity(Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE))
            invoke.resolve()
        } catch(e:Exception){invoke.reject("Browser unavailable")}
    }

    @Command
    fun openBrowser(invoke: Invoke) {
        try {
            val url = asset(invoke.parseArgs(BrowserArgs::class.java).expected)
            host.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url.toString())).addCategory(Intent.CATEGORY_BROWSABLE))
            invoke.resolve()
        } catch (e: Exception) { invoke.reject(e.message ?: "Browser unavailable") }
    }

    @Command
    fun cancel(invoke: Invoke) {
        synchronized(lock) { download?.set(true) }
        invoke.resolve()
    }

    @Command
    fun install(invoke: Invoke) {
        if (!busy.compareAndSet(false, true)) { invoke.reject("Installation in progress"); return }
        val canceled = AtomicBoolean(false)
        synchronized(lock) { download = canceled }
        Thread {
            try {
                val args = invoke.parseArgs(InstallArgs::class.java)
                val version = args.expected
                val source = asset(version)
                val pm = host.packageManager
                if (pm.getInstallerPackageName(host.packageName) == "com.android.vending") {
                    host.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id="+host.packageName)))
                    invoke.resolve()
                    return@Thread
                }
                require(Build.VERSION.SDK_INT >= 28) { "Direct updates require Android 9 or later" }
                if (!pm.canRequestPackageInstalls()) {
                    host.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:"+host.packageName)))
                    error("Allow installation from Ploom and retry")
                }
                val dir = File(host.filesDir, "updates").apply { mkdirs() }
                val apk = File.createTempFile("ploom-", ".apk", dir)
                var handedOff = false
                try {
                    dir.listFiles()?.filter { it != apk && it.lastModified() < System.currentTimeMillis()-86400000 }?.forEach { it.delete() }
                    fetch(source, apk, args.progress, canceled)
                    synchronized(lock) {
                        check(!canceled.get()) { "Download canceled" }
                        download = null
                    }
                    args.progress.sendObject(listOf("verify", apk.length(), apk.length()))
                    val verification = com.android.apksig.ApkVerifier.Builder(apk).setMinCheckedPlatformVersion(Build.VERSION.SDK_INT).setMaxCheckedPlatformVersion(Build.VERSION.SDK_INT).build().verify()
                    require(verification.isVerified && (verification.isVerifiedUsingV2Scheme || verification.isVerifiedUsingV3Scheme)) { "APK signature verification failed" }
                    val flags = PackageManager.GET_SIGNING_CERTIFICATES
                    val archive = requireNotNull(pm.getPackageArchiveInfo(apk.path, flags)) { "Invalid APK" }
                    val installed = pm.getPackageInfo(host.packageName, flags)
                    require(archive.packageName == host.packageName && archive.versionName == version && archive.longVersionCode > installed.longVersionCode) { "Incompatible APK version" }
                    fun signers(info: android.content.pm.PackageInfo) = requireNotNull(info.signingInfo).apkContentsSigners.map {
                        MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).toList()
                    }.toSet()
                    val trusted = signers(installed)
                    require(trusted.isNotEmpty() && trusted == signers(archive)) { "APK signer rejected" }
                    args.progress.sendObject(listOf("install", apk.length(), apk.length()))
                    val uri = FileProvider.getUriForFile(host, host.packageName+".updates", apk)
                    host.contentResolver.openFileDescriptor(uri, "r").use {
                        check(it != null && it.statSize == apk.length()) { "Installer cannot read APK" }
                    }
                    val intent = Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, "application/vnd.android.package-archive")
                        clipData = ClipData.newRawUri("Ploom APK", uri)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    host.startActivity(intent)
                    handedOff = true
                    invoke.resolve()
                } finally { if (!handedOff) apk.delete() }
            } catch (e: IOException) {
                invoke.reject(if (canceled.get()) "Download canceled" else "Network or file read failed")
            } catch (e: Exception) { invoke.reject(e.message ?: "Update failed") }
            finally { synchronized(lock) { download = null }; busy.set(false) }
        }.start()
    }

    private fun fetch(source: URL, target: File, progress: app.tauri.plugin.Channel, canceled: AtomicBoolean) {
        var url = source
        repeat(5) {
            check(!canceled.get()) { "Download canceled" }
            require(url.protocol == "https" && url.host in setOf("github.com","release-assets.githubusercontent.com") && url.port in setOf(-1,443))
            val connection = url.openConnection() as HttpsURLConnection
            try {
                connection.setRequestProperty("Accept-Encoding", "identity")
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15000
                connection.readTimeout = 30000
                if (connection.responseCode in listOf(301,302,303,307,308)) {
                    url = URL(url, requireNotNull(connection.getHeaderField("Location")))
                } else {
                    require(connection.responseCode == 200) { "Download HTTP "+connection.responseCode }
                    val expected = connection.contentLengthLong
                    ApkDownload.checkHeader(expected, target.parentFile!!.usableSpace)
                    var received = 0L
                    connection.inputStream.use { input -> target.outputStream().use { output ->
                        val buffer = ByteArray(65536)
                        var nextReport = 0L
                        while (true) {
                            check(!canceled.get()) { "Download canceled" }
                            val n = input.read(buffer)
                            if (n == -1) break
                            received += n
                            require(received <= ApkDownload.LIMIT) { "Invalid download size" }
                            try { output.write(buffer,0,n) } catch (e: IOException) {
                                if (target.parentFile!!.usableSpace < n || e.message?.contains("ENOSPC") == true) error("Not enough storage")
                                throw e
                            }
                            if (received >= nextReport) {
                                progress.sendObject(listOf("download", received, expected.takeIf { it > 0 }))
                                nextReport = received + 262144
                            }
                        }
                    } }
                    ApkDownload.checkComplete(received, expected)
                    progress.sendObject(listOf("download", received, received))
                    return
                }
            } finally { connection.disconnect() }
        }
        error("Too many redirects")
    }
}
