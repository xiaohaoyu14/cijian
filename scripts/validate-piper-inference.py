"""Host CPU smoke test, not a substitute for Android device validation.
pip install sherpa-onnx==1.13.3 sherpa-onnx-core==1.13.3
"""
from pathlib import Path
import json,time
import sherpa_onnx
assert sherpa_onnx.__version__=='1.13.3', 'This integration pins 1.13.3; 2.x removed its built-in espeak frontend.'
project=Path(__file__).resolve().parent.parent
root=project/'android/app/src/main/assets/piper/en_US-lessac-high'
vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=str(root/'en_US-lessac-high.onnx'),tokens=str(root/'tokens.txt'),data_dir=str(root/'espeak-ng-data'),noise_scale=.667,noise_scale_w=.8,length_scale=1.)
config=sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(vits=vits,num_threads=2,provider='cpu',debug=False),max_num_sentences=1)
assert config.validate()
start=time.perf_counter();tts=sherpa_onnx.OfflineTts(config);ready=time.perf_counter()
audio=tts.generate('heritage',sid=0,speed=1.0);end=time.perf_counter()
assert audio.sample_rate==22050 and len(audio.samples)>2205
assert max(abs(float(x)) for x in audio.samples)>.01
out=project/'validation';out.mkdir(exist_ok=True)
sherpa_onnx.write_wave(str(out/'piper-heritage.wav'),audio.samples,audio.sample_rate)
report={'runtime':sherpa_onnx.__version__,'model':'en_US-lessac-high','platform':'Host CPU, not Android hardware','sampleRate':audio.sample_rate,'samples':len(audio.samples),'durationSeconds':len(audio.samples)/audio.sample_rate,'initializationSeconds':ready-start,'generationSeconds':end-ready}
(out/'inference.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
