package work.itzme.ploom;

/** Bounds for the bytes copied to the private update file. */
final class ApkDownload {
    static final long LIMIT = 256L * 1024 * 1024;

    static void checkHeader(long length, long freeBytes) {
        if (length < -1 || length == 0 || length > LIMIT) {
            throw new IllegalArgumentException("Invalid download size");
        }
        if (length > freeBytes) {
            throw new IllegalStateException("Not enough storage");
        }
    }

    static void checkComplete(long received, long expected) {
        if (received <= 0 || received > LIMIT || (expected >= 0 && expected != received)) {
            throw new IllegalStateException("Incomplete APK");
        }
    }
}
