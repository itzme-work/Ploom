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
