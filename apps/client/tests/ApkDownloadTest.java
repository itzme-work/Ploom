package work.itzme.ploom;

public class ApkDownloadTest {
    private static void rejects(String message, Runnable check) {
        try {
            check.run();
        } catch (RuntimeException e) {
            if (message.equals(e.getMessage())) return;
            throw e;
        }
        throw new AssertionError("Expected rejection: " + message);
    }

    public static void main(String[] args) {
        rejects("Not enough storage", () -> ApkDownload.checkHeader(1024, 1023));
        rejects("Invalid download size", () -> ApkDownload.checkHeader(ApkDownload.LIMIT + 1, Long.MAX_VALUE));
        rejects("Incomplete APK", () -> ApkDownload.checkComplete(999, 1000));
        rejects("Incomplete APK", () -> ApkDownload.checkComplete(0, -1));
        ApkDownload.checkHeader(1024, 1024);
        ApkDownload.checkHeader(-1, 1024);
        ApkDownload.checkComplete(1024, 1024);
        ApkDownload.checkComplete(1024, -1);
    }
}
