import { Capacitor, registerPlugin } from "@capacitor/core";
export interface PiperEngine {
  initialize(options?: { warmup?: boolean }): Promise<{ model: string; sampleRate: number }>;
  speak(options: { text: string }): Promise<{ cancelled?: boolean }>;
  stop(): Promise<void>;
}
const native = registerPlugin<PiperEngine>("PiperTts");
let initialized: ReturnType<PiperEngine["initialize"]> | undefined;
export function initialize(warmup = false) {
  if (!Capacitor.isNativePlatform())
    return Promise.reject(
      Error("Piper 离线发音在安卓 APK 中运行，电脑预览不调用系统或在线语音"),
    );
  if (!initialized)
    initialized = native.initialize({ warmup }).catch((e) => {
      initialized = undefined;
      throw e;
    });
  return initialized;
}
export const speak = (text: string) => native.speak({ text });
export const stop = () =>
  Capacitor.isNativePlatform() ? native.stop() : Promise.resolve();
