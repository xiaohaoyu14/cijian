package cn.cijian.vocabulary;

public class PiperAudioCacheTest {
    private static PiperAudioCache.Clip clip(int frames) { return new PiperAudioCache.Clip(new short[frames],22050); }
    public static void main(String[] args) {
        PiperAudioCache c=new PiperAudioCache(12);
        PiperAudioCache.Clip a=clip(3),b=clip(3),x=clip(3);
        c.put("a",a);c.put("b",b);
        if(c.get("a")!=a)throw new AssertionError("repeat must reuse generated PCM");
        c.put("c",x);
        if(c.get("b")!=null||c.get("a")!=a||c.get("c")!=x)throw new AssertionError("LRU must evict cold audio within byte budget");
        c.put("a",clip(7));
        if(c.get("a")!=null||c.get("c")!=x)throw new AssertionError("oversized audio must not exceed budget or evict other clips");
        c.clear();if(c.get("c")!=null)throw new AssertionError("destroy must clear clips");
        c=new PiperAudioCache(1000);
        for(int i=0;i<33;i++)c.put("word"+i,clip(1));
        if(c.get("word0")!=null||c.get("word32")==null)throw new AssertionError("entry count must be bounded");
        System.out.println("PASS: PCM reuse, byte cap, LRU, oversized clip, count cap, cleanup");
    }
}
