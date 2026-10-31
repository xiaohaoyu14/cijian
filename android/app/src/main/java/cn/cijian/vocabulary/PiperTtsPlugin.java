package cn.cijian.vocabulary;

import android.content.res.AssetManager;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.SystemClock;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.atomic.AtomicLong;
import org.json.JSONObject;

@CapacitorPlugin(name = "PiperTts")
public class PiperTtsPlugin extends Plugin {
    private static final String TAG = "CijianPiper";
    private static final String MODEL = "en_US-lessac-high";
    private static final String ASSETS = "piper/" + MODEL;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicLong generation = new AtomicLong();
    private volatile boolean destroyed;
    private OfflineTts engine;
    private final PiperAudioCache audioCache = new PiperAudioCache(2*1024*1024);
    private volatile AudioTrack currentTrack;

    private static byte[] readBytes(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1)out.write(buffer,0,n);return out.toByteArray();
    }
    private static String sha256(byte[] bytes) throws Exception {
        StringBuilder out = new StringBuilder();
        for(byte b : MessageDigest.getInstance("SHA-256").digest(bytes)) out.append(String.format(java.util.Locale.ROOT,"%02x", b & 255));
        return out.toString();
    }
    // A hash-named directory avoids using an incomplete/old extraction after an app update.
    private File unpackModel() throws Exception {
        AssetManager assets = getContext().getAssets();
        byte[] manifest;
        try(InputStream in=assets.open(ASSETS+"/files.json")){manifest=readBytes(in);}
        String hash=sha256(manifest);
        File root=new File(getContext().getFilesDir(),"piper-"+MODEL+"-"+hash.substring(0,12));
        File complete=new File(root,".complete");
        if(complete.isFile())try(InputStream in=new java.io.FileInputStream(complete)){if(new String(readBytes(in),StandardCharsets.UTF_8).equals(hash))return root;}
        if(!root.isDirectory()&&!root.mkdirs())throw new java.io.IOException("无法创建模型目录");
        JSONObject files=new JSONObject(new String(manifest,StandardCharsets.UTF_8));
        Iterator<String> names=files.keys();
        while(names.hasNext()) {
            if(destroyed)throw new IllegalStateException("引擎已关闭");
            String name=names.next();File target=new File(root,name);
            if(!target.getCanonicalPath().startsWith(root.getCanonicalPath()+File.separator))throw new SecurityException("模型路径无效");
            File parent=target.getParentFile();if(!parent.isDirectory()&&!parent.mkdirs())throw new java.io.IOException("无法创建模型子目录");
            MessageDigest digest=MessageDigest.getInstance("SHA-256");long size=0;
            try(InputStream in=assets.open(ASSETS+"/"+name);FileOutputStream out=new FileOutputStream(target)) {
                byte[] buffer=new byte[65536];int count;
                while((count=in.read(buffer))!=-1){out.write(buffer,0,count);digest.update(buffer,0,count);size+=count;}
            }
            StringBuilder actual=new StringBuilder();for(byte b:digest.digest())actual.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
            JSONObject expected=files.getJSONObject(name);
            if(size!=expected.getLong("bytes")||!actual.toString().equals(expected.getString("sha256")))throw new java.io.IOException("模型文件校验失败");
        }
        try(FileOutputStream out=new FileOutputStream(complete)){out.write(hash.getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
        return root;
    }
    private void ensureEngine() throws Exception {
        if(destroyed)throw new IllegalStateException("引擎已关闭");
        if(engine!=null)return;
        Log.i(TAG,"Loading offline model");
        File root=unpackModel();JSONObject config;
        try(InputStream in=new java.io.FileInputStream(new File(root,"config.json"))){config=new JSONObject(new String(readBytes(in),StandardCharsets.UTF_8));}
        JSONObject inference=config.getJSONObject("inference");
        OfflineTtsVitsModelConfig vits=new OfflineTtsVitsModelConfig();
        vits.setModel(new File(root,MODEL+".onnx").getAbsolutePath());
        vits.setTokens(new File(root,"tokens.txt").getAbsolutePath());
        vits.setDataDir(new File(root,"espeak-ng-data").getAbsolutePath());
        vits.setNoiseScale((float)inference.getDouble("noise_scale"));
        vits.setNoiseScaleW((float)inference.getDouble("noise_w"));
        vits.setLengthScale((float)inference.getDouble("length_scale"));
        OfflineTtsModelConfig model=new OfflineTtsModelConfig();model.setVits(vits);model.setProvider("cpu");model.setNumThreads(Math.min(2,Runtime.getRuntime().availableProcessors()));model.setDebug(false);
        OfflineTtsConfig tts=new OfflineTtsConfig();tts.setModel(model);tts.setMaxNumSentences(1);
        OfflineTts candidate = new OfflineTts(null,tts);
        // The pinned Kotlin wrapper exposes no isValid(): newFromFile can return 0.
        // Its sampleRate() dereferences ptr without checking, so validate BEFORE JNI.
        try {
            java.lang.reflect.Field pointer = OfflineTts.class.getDeclaredField("ptr");
            pointer.setAccessible(true);
            if(pointer.getLong(candidate)==0)throw new IllegalStateException("原生模型初始化失败");
            if(candidate.sampleRate()!=config.getJSONObject("audio").getInt("sample_rate"))
                throw new IllegalStateException("模型采样率与配置不匹配");
            engine=candidate;
        } catch(Exception error) {
            candidate.free();
            throw error;
        }
        Log.i(TAG,"Offline model ready");
    }
    private void enqueue(PluginCall call, Runnable task) {
        if(destroyed){call.reject("语音引擎已关闭，请重新打开页面");return;}
        try { worker.execute(task); }
        catch(RejectedExecutionException error){call.reject("语音引擎已关闭",error);}
    }
    private void fail(PluginCall call, String message, Throwable error) {
        Log.e(TAG,message,error);
        call.reject(message,error instanceof Exception?(Exception)error:new Exception(error));
    }
    @PluginMethod public void initialize(PluginCall call) {
        enqueue(call,()->{
            try {
                ensureEngine();
                if(destroyed){call.reject("引擎已关闭");return;}
                // Allocate inference working buffers before the first user tap, without playback.
                if(Boolean.TRUE.equals(call.getBoolean("warmup",false)))engine.generate("a",0,1.0f);
                JSObject result=new JSObject();
                result.put("model",MODEL);result.put("sampleRate",engine.sampleRate());
                call.resolve(result);
            } catch(Throwable error) {
                fail(call,"Piper 语音引擎加载失败，请检查可用存储空间后重试。",error);
            }
        });
    }
    private long halt() { long value=generation.incrementAndGet();AudioTrack track=currentTrack;if(track!=null)try{track.pause();track.flush();}catch(IllegalStateException ignored){} return value; }
    @PluginMethod public void stop(PluginCall call){halt();call.resolve();}
    @PluginMethod public void speak(PluginCall call) {
        String text=call.getString("text","");
        if(!text.matches("[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ '\u2019\\-]{0,99}")){call.reject("单词内容无效");return;}
        long ticket=halt();
        enqueue(call,()->{
            AudioTrack track=null;
            try{
                if(ticket!=generation.get()||destroyed){call.resolve();return;}
                ensureEngine();
                // Do NOT pass a Java lambda to generateWithCallback: sherpa 1.13.3 JNI
                // looks up invoke(float[]):Integer, but Java lambdas only implement
                // invoke(Object):Object. Pending NoSuchMethodError can abort Android ART.
                // Single-word inference uses the callback-free API. Cancelled results
                // are discarded before any PCM is played; the engine remains serialized.
                long started=SystemClock.elapsedRealtime();
                PiperAudioCache.Clip clip=audioCache.get(text);
                boolean cached=clip!=null;
                if(clip==null) {
                    Log.i(TAG,"Synthesizing word");
                    GeneratedAudio audio=engine.generate(text,0,1.0f);
                    float[] samples=audio.getSamples();
                    if(samples.length==0||samples.length>audio.getSampleRate()*30)throw new IllegalStateException("模型未生成语音");
                    short[] converted=new short[samples.length];
                    for(int i=0;i<samples.length;i++)converted[i]=(short)Math.round(Math.max(-1f,Math.min(1f,samples[i]))*32767f);
                    clip=new PiperAudioCache.Clip(converted,audio.getSampleRate());
                    audioCache.put(text,clip);
                }
                if(ticket!=generation.get()||destroyed){call.resolve();return;}
                short[] pcm=clip.pcm;int rate=clip.rate;
                Log.i(TAG,"PCM ready in "+(SystemClock.elapsedRealtime()-started)+"ms; memory cache="+cached);
                int buffer=Math.max(8192,AudioTrack.getMinBufferSize(rate,AudioFormat.CHANNEL_OUT_MONO,AudioFormat.ENCODING_PCM_16BIT));
                track=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).setAudioFormat(new AudioFormat.Builder().setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build()).setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(buffer).build();
                if(track.getState()!=AudioTrack.STATE_INITIALIZED)throw new IllegalStateException("无法初始化音频输出");
                currentTrack=track;
                if(ticket!=generation.get()||destroyed){call.resolve();return;}
                track.play();int offset=0;
                long deadline=SystemClock.elapsedRealtime()+3000L+pcm.length*1000L/rate;
                while(offset<pcm.length&&ticket==generation.get()&&!destroyed){int written=track.write(pcm,offset,Math.min(4096,pcm.length-offset),AudioTrack.WRITE_BLOCKING);if(written<=0)throw new IllegalStateException("音频输出失败");offset+=written;}
                while(ticket==generation.get()&&!destroyed&&track.getPlaybackHeadPosition()<offset) {
                    if(SystemClock.elapsedRealtime()>deadline)throw new IllegalStateException("音频设备播放超时");
                    Thread.sleep(10);
                }
                Log.i(TAG,"Playback finished");
                JSObject result=new JSObject();result.put("cancelled",ticket!=generation.get());call.resolve(result);
            }catch(Throwable e){if(ticket!=generation.get()||destroyed)call.resolve();else fail(call,"Piper 朗读失败，请检查媒体音量后重试。",e);}
            finally{if(track!=null){if(currentTrack==track)currentTrack=null;try{track.stop();}catch(IllegalStateException ignored){}try{track.release();}catch(IllegalStateException ignored){}}}
        });
    }
    @Override protected void handleOnPause(){halt();}
    @Override protected void handleOnDestroy(){destroyed=true;halt();worker.execute(()->{audioCache.clear();if(engine!=null){engine.free();engine=null;}});worker.shutdown();}
}
