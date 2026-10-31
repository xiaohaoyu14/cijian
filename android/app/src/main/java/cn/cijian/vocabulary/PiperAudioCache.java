package cn.cijian.vocabulary;

import java.util.LinkedHashMap;
import java.util.Map;

/** Worker-thread-only, bounded transient PCM; never writes to storage. */
final class PiperAudioCache {
    static final class Clip {
        final short[] pcm;
        final int rate;
        Clip(short[] pcm, int rate) { this.pcm=pcm; this.rate=rate; }
        long bytes() { return pcm.length*2L; }
    }
    private final long limit;
    private long used;
    private final LinkedHashMap<String,Clip> clips=new LinkedHashMap<>(16,.75f,true);
    PiperAudioCache(long limit) { this.limit=limit; }
    Clip get(String word) { return clips.get(word); }
    void put(String word, Clip clip) {
        Clip old=clips.remove(word);
        if(old!=null)used-=old.bytes();
        if(clip.bytes()>limit)return;
        while(!clips.isEmpty()&&(used+clip.bytes()>limit||clips.size()>=32)) {
            Map.Entry<String,Clip> first=clips.entrySet().iterator().next();
            used-=first.getValue().bytes();clips.remove(first.getKey());
        }
        clips.put(word,clip);used+=clip.bytes();
    }
    void clear() { clips.clear();used=0; }
}
