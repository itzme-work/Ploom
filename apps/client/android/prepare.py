"""Install the Ploom updater into the Tauri-generated direct distribution project."""
from pathlib import Path
import shutil
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
main = root / "src-tauri/gen/android/app/src/main"
shutil.copyfile(root / "android/AndroidUpdateAdapter.kt", main / "java/AndroidUpdateAdapter.kt")
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
if not any(node.get(key("authorities")) == "${applicationId}.updates" for node in app.findall("provider")):
    provider = ET.SubElement(app, "provider", {key("name"): "androidx.core.content.FileProvider", key("authorities"): "${applicationId}.updates", key("exported"): "false", key("grantUriPermissions"): "true"})
    ET.SubElement(provider, "meta-data", {key("name"): "android.support.FILE_PROVIDER_PATHS", key("resource"): "@xml/update_paths"})
tree.write(manifest, encoding="utf-8", xml_declaration=True)
paths = main / "res/xml/update_paths.xml"
paths.parent.mkdir(exist_ok=True)
paths.write_text('<paths><cache-path name="updates" path="updates/"/></paths>')
gradle = main.parents[1] / "build.gradle.kts"
dependency = 'implementation("com.android.tools.build:apksig:8.7.3")'
contents = gradle.read_text()
if dependency not in contents:
    gradle.write_text(contents + "\ndependencies { " + dependency + " }\n")
