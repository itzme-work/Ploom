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
class BrowserArgs { lateinit var expected: String }

@InvokeArg
class InstallArgs { lateinit var expected: String; lateinit var progress: app.tauri.plugin.Channel }

@TauriPlugin
class AndroidUpdateAdapter(private val host: Activity): Plugin(host) {
    private val busy = AtomicBoolean(false)

    private val lock = Any()
    private var download: AtomicBoolean? = null

    private fun asset(version: String): URL {
        require(Regex("[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?").matches(version))
        return URL("https://github.com/itzme-work/Ploom/releases/download/v$version/Ploom-arm64.apk")
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
                require(Regex("[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?").matches(version))
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
                    fetch(asset(version), apk, args.progress, canceled)
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
                    val limit = 256L * 1024 * 1024
                    val expected = connection.contentLengthLong
                    require(expected in -1..limit && expected != 0L) { "Invalid download size" }
                    if (expected > target.parentFile!!.usableSpace) error("Not enough storage")
                    var received = 0L
                    connection.inputStream.use { input -> target.outputStream().use { output ->
                        val buffer = ByteArray(65536)
                        var nextReport = 0L
                        while (true) {
                            check(!canceled.get()) { "Download canceled" }
                            val n = input.read(buffer)
                            if (n == -1) break
                            received += n
                            require(received <= limit) { "Invalid download size" }
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
                    check(received > 0 && (expected < 0 || received == expected)) { "Incomplete APK" }
                    progress.sendObject(listOf("download", received, received))
                    return
                }
            } finally { connection.disconnect() }
        }
        error("Too many redirects")
    }
}
