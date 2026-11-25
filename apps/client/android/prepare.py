"""Install the Ploom updater into the Tauri-generated direct distribution project."""
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
main = root / "src-tauri/gen/android/app/src/main"
for source in ("AndroidUpdateAdapter.kt", "ApkDownload.java", "LibraryKey.kt"):
    shutil.copyfile(root / "android" / source, main / "java" / source)
android = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", android)
key = lambda name: f"{{{android}}}{name}"
manifest = main / "AndroidManifest.xml"
tree = ET.parse(manifest)
doc = tree.getroot()
permission = "android.permission.REQUEST_INSTALL_PACKAGES"
if not any(node.get(key("name")) == permission for node in doc.findall("uses-permission")):
    ET.SubElement(doc, "uses-permission", {key("name"): permission})
app = doc.find("application")
provider = next((node for node in app.findall("provider") if node.get(key("authorities")) == "${applicationId}.updates"), None)
if provider is None:
    provider = ET.SubElement(app, "provider", {key("authorities"): "${applicationId}.updates"})
    ET.SubElement(provider, "meta-data", {key("name"): "android.support.FILE_PROVIDER_PATHS", key("resource"): "@xml/update_paths"})
provider.set(key("name"), "work.itzme.ploom.UpdateFileProvider")
provider.set(key("exported"), "false")
provider.set(key("grantUriPermissions"), "true")
tree.write(manifest, encoding="utf-8", xml_declaration=True)
paths = main / "res/xml/update_paths.xml"
paths.parent.mkdir(exist_ok=True)
paths.write_text('<paths><files-path name="updates" path="updates/"/></paths>')
gradle = main.parents[1] / "build.gradle.kts"
dependency = 'implementation("com.android.tools.build:apksig:8.7.3")'
contents = gradle.read_text()
if dependency not in contents:
    gradle.write_text(contents + "\ndependencies { " + dependency + " }\n")

# android init supplies template launcher resources on each clean build.
shutil.copytree(root / "src-tauri/icons/android", main / "res", dirs_exist_ok=True)

# The connection build supplies the AAR from its pinned source build in the same job.
import os
engine = os.environ.get("PLOOM_LIBBOX_AAR")
if engine:
    libs = main.parents[1] / "libs"
    libs.mkdir(exist_ok=True)
    shutil.copyfile(engine, libs / "libbox.aar")
    for source in (root / "android/vpn").glob("*.java"):
        shutil.copyfile(source, main / "java" / source.name)
    dep = 'implementation(files("libs/libbox.aar"))'
    if dep not in gradle.read_text():
        gradle.write_text(gradle.read_text() + "\ndependencies { " + dep + " }\n")
    for perm in ("FOREGROUND_SERVICE", "FOREGROUND_SERVICE_SYSTEM_EXEMPTED", "ACCESS_NETWORK_STATE"):
        name = "android.permission." + perm
        if not any(node.get(key("name")) == name for node in doc.findall("uses-permission")):
            ET.SubElement(doc, "uses-permission", {key("name"): name})
    if not any(node.get(key("name")) == ".PloomVpnService" for node in app.findall("service")):
        service = ET.SubElement(app, "service", {key("name"): ".PloomVpnService",
            key("permission"): "android.permission.BIND_VPN_SERVICE", key("exported"): "false",
            key("foregroundServiceType"): "systemExempted"})
        ET.SubElement(ET.SubElement(service, "intent-filter"), "action", {key("name"): "android.net.VpnService"})
        ET.SubElement(service, "meta-data", {key("name"): "android.net.VpnService.SUPPORTS_ALWAYS_ON", key("value"): "false"})
    tree.write(manifest, encoding="utf-8", xml_declaration=True)
