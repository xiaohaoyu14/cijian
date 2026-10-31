# Piper 模型、配置与目录

当前模型为用户确认选择的 `en_US-lessac-high`，不是不存在于官方表中的 `en_US-amy-high`。模型卡：美式英语、单说话人、high、22,050 Hz。

- 原始 ONNX：[下载](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx)
- 原始配套 JSON：[下载](https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/high/en_US-lessac-high.onnx.json)
- 实际运行使用的 Piper 适配模型包：[下载](https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-high.tar.bz2)
- Android 推理 AAR，锁定 1.13.3：[下载](https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.3/sherpa-onnx-1.13.3.aar)

模型放置：`android/app/src/main/assets/piper/en_US-lessac-high/en_US-lessac-high.onnx`。

配置放置：`android/app/src/main/assets/piper/en_US-lessac-high/config.json`（配套 `en_US-lessac-high.onnx.json` 的相同内容副本）。

完整文件夹：`C:/Users/lbw/Desktop/bcz work/android/app/src/main/assets/piper/en_US-lessac-high/`。必须同时有 `tokens.txt` 和 `espeak-ng-data/`，已随 APK 内置。重新下载与校验见根目录 README 的打包步骤。

运行时使用应用私有 `files/piper-en_US-lessac-high-<manifestHash>/` 目录中的完整副本。首次加载显示提示并校验解包；手机端不下载模型、不使用安卓系统 TTS、不需要谷歌服务，不生成音频文件缓存。实时生成 PCM 后直接播放。
