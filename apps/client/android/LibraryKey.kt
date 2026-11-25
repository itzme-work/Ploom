package work.itzme.ploom

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object LibraryKey {
    @Synchronized fun unlock(context: Context): String {
        val prefs = context.getSharedPreferences("ploom.library.key", Context.MODE_PRIVATE)
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val alias = "work.itzme.ploom.library.v1"
        val saved = prefs.getString("wrapped", null)
        val wrapping = store.getKey(alias, null) as? SecretKey ?: run {
            check(saved == null)
            val generator = KeyGenerator.getInstance("AES", "AndroidKeyStore")
            generator.init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
            generator.generateKey()
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        val secret = if (saved != null) {
            val bytes = Base64.decode(saved, Base64.NO_WRAP)
            cipher.init(Cipher.DECRYPT_MODE, wrapping, GCMParameterSpec(128, bytes.copyOfRange(0,12)))
            cipher.doFinal(bytes.copyOfRange(12,bytes.size))
        } else {
            val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
            cipher.init(Cipher.ENCRYPT_MODE, wrapping)
            val record = Base64.encodeToString(cipher.iv + cipher.doFinal(bytes), Base64.NO_WRAP)
            check(prefs.edit().putString("wrapped",record).commit())
            bytes
        }
        return Base64.encodeToString(secret, Base64.NO_WRAP)
    }
}
