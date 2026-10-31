"""Check actual pinned JNI signature + reproduce old Java callback incompatibility.
Run AFTER Gradle compileReleaseJavaWithJavac; inspects compiled plugin, not source text.
"""
from pathlib import Path
import subprocess, zipfile, json
root=Path(__file__).resolve().parent.parent
jar=root/'.recovery/sherpa-classes.jar'
jar.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(root/'android/app/libs/sherpa-onnx-1.13.3.aar') as archive:
    jar.write_bytes(archive.read('classes.jar'))
    native=archive.read('jni/arm64-v8a/libsherpa-onnx-jni.so')
    assert b'([F)Ljava/lang/Integer;' in native
    assert b'(Ljava/lang/Object;)Ljava/lang/Object;' not in native
kotlin=next((Path.home()/'.gradle/caches/modules-2/files-2.1/org.jetbrains.kotlin/kotlin-stdlib/1.9.24').rglob('*.jar'))
out=root/'.recovery/jni-contract';out.mkdir(exist_ok=True)
subprocess.run(['javac','-cp',str(kotlin),'-d',str(out),str(root/'tests/native/PiperCallbackContract.java')],check=True)
repro=subprocess.check_output(['java','-cp',str(out)+';'+str(kotlin),'PiperCallbackContract'],text=True).strip()
print(repro)
classes=root/'android/app/build/intermediates/javac/release/compileReleaseJavaWithJavac/classes'
bytecode=subprocess.check_output(['javap','-c','-p','-classpath',str(classes),'cn.cijian.vocabulary.PiperTtsPlugin'],text=True)
assert 'OfflineTts.generate:(Ljava/lang/String;IF)' in bytecode,'compiled plugin must call callback-free inference'
assert 'OfflineTts.generateWithCallback:' not in bytecode,'unsafe callback is still compiled'
assert 'OfflineTts.release:' not in bytecode,'use free() to clear pointer explicitly'
subprocess.run(['javac','-d',str(out),str(root/'android/app/src/main/java/cn/cijian/vocabulary/PiperAudioCache.java'),str(root/'tests/native/PiperAudioCacheTest.java')],check=True)
subprocess.run(['java','-cp',str(out),'cn.cijian.vocabulary.PiperAudioCacheTest'],check=True)
report={'runtime':'1.13.3','oldCallbackIncompatibilityReproduced':True,'compiledPluginUsesCallbackFreeGenerate':True,'boundedPcmCacheTestsPassed':True,'androidDeviceTest':False}
(root/'validation/piper-jni-contract.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
